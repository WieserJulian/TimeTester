// CSS custom properties passed through style={{ ... }}: --c = a project's color, --pensum = pensum line in the forecast.
import 'react';
declare module 'react' {
  interface CSSProperties { '--c'?: string; '--pensum'?: string }
}
