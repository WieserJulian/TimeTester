// Service worker, built by Vite to /sw.js (see vite.config.ts). Type-checked with tsconfig.sw.json.
//  - App shell: network first so updates show up; cache is the offline fallback.
//  - GET /api/state: network first, last good copy when offline.
//  - Writes (POST/PUT/DELETE /api/*) that fail for lack of network are queued and replayed in order
//    when the connection is back (Background Sync where supported, otherwise on the next app load/online event).
import type { SwMessage } from './types.ts';

declare const self: ServiceWorkerGlobalScope;

const CACHE = 'timetester-v4';
const QUEUE_CACHE = 'timetester-queue'; // survives CACHE version bumps
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

type Queued = { method: string; url: string; body: string };

// ---------- queue, stored as one JSON response in the Cache API ----------
const readQueue = async (): Promise<Queued[]> => (await (await caches.open(QUEUE_CACHE)).match('/queue'))?.json() ?? [];
async function writeQueue(q: Queued[]) {
  await (await caches.open(QUEUE_CACHE)).put('/queue', Response.json(q));
  broadcast({ type: 'queue', size: q.length });
}
// Every queue read-modify-write runs one at a time.
let lock: Promise<unknown> = Promise.resolve();
const locked = <T>(fn: () => Promise<T>): Promise<T> => { const p = lock.then(fn); lock = p.catch(() => {}); return p; };

async function broadcast(msg: SwMessage) {
  for (const c of await self.clients.matchAll()) c.postMessage(msg);
}

const enqueue = (item: Queued) => locked(async () => { await writeQueue([...(await readQueue()), item]); });

// Replays in order. A network error or 5xx stops (try again later); a 4xx is dropped and reported.
// ponytail: a write that reached the server but lost its response is replayed twice; add request ids if that bites.
const flush = () => locked(async () => {
  const q = await readQueue();
  if (!q.length) return;
  let sent = 0;
  const failed: string[] = [];
  while (q.length) {
    const { method, url, body } = q[0];
    let res: Response;
    try { res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body || undefined }); } catch { break; }
    if (res.status >= 500) break;
    q.shift();
    if (res.ok) sent++;
    else failed.push((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  }
  await writeQueue(q);
  if (sent || failed.length) broadcast({ type: 'synced', sent, failed });
});

const queued = () => Response.json({ queued: true }, { status: 202 });
type SyncRegistration = ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };

async function write(req: Request) {
  const item = { method: req.method, url: req.url, body: await req.clone().text() };
  // Something is already waiting: queue behind it so writes keep their order.
  if ((await readQueue()).length) { await enqueue(item); flush(); return queued(); }
  try { return await fetch(req); } catch {
    await enqueue(item);
    await (self.registration as SyncRegistration).sync?.register('flush').catch(() => {});
    return queued();
  }
}

async function state(req: Request) {
  await flush(); // queued writes first, so the fresh state includes them
  try {
    const res = await fetch(req);
    if (res.ok) await (await caches.open(CACHE)).put('/api/state', res.clone());
    return res;
  } catch {
    return (await caches.match('/api/state')) ?? Response.json({ error: 'offline and nothing cached yet' }, { status: 503 });
  }
}

// ---------- events ----------
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== QUEUE_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('sync', ((e: ExtendableEvent & { tag: string }) => { if (e.tag === 'flush') e.waitUntil(flush()); }) as EventListener);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/state') e.respondWith(state(e.request));
    // import replaces everything, so it's never queued; exports and other reads go straight to the network
    else if (e.request.method !== 'GET' && url.pathname !== '/api/import') e.respondWith(write(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/')) as Promise<Response>)
  );
});
