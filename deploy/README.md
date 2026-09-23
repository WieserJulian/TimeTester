# Deploy

Image is built by GitHub Actions (`.github/workflows/docker.yml`) and pulled by Watchtower. No git clone on the server.

## Release
```
git tag v2026.09.23 && git push origin v2026.09.23
```
Publishes `ghcr.io/<owner>/<repo>:2026.09.23` and moves `:latest`. Watchtower picks up `:latest` within 5 min.

## One-time setup
1. In `compose.yaml` replace `OWNER/REPO` with your GitHub `user/repo` (lowercase).
2. Create a GitHub PAT (classic) with `read:packages`; on the server: `docker login ghcr.io -u <github-user>`.
3. Copy `compose.yaml` and `.env.example` (as `.env`) to the server. Fill `TUNNEL_TOKEN` if using the tunnel.
4. `docker compose up -d` (add `--profile tunnel` for the Cloudflare Tunnel; needs a Cloudflare Access policy, the app has no login).

## Pin / roll back
Set `TAG=2026.09.23` in `.env`, then `docker compose up -d`. A pinned tag never changes, so Watchtower has nothing to update; unset it to follow `latest` again.

## Data
SQLite lives in `./data` next to `compose.yaml`, mounted into the container. Watchtower only replaces the container, so data survives every redeploy. Don't delete that folder; back it up.
