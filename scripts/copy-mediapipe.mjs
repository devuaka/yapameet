// Copies MediaPipe's WebAssembly runtime into public/ so the site serves it itself
// (runs automatically before `npm run dev` and `npm run build`).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dest = 'public/mediapipe';
mkdirSync(dest, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const from = join(src, f);
  const to = join(dest, f);
  if (!existsSync(from)) {
    console.warn(`copy-mediapipe: missing ${from} (run npm install)`);
    continue;
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  console.log(`copy-mediapipe: ${f}`);
}
