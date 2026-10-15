import { cp, mkdir } from 'node:fs/promises';
import './create-icon.mjs';
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await mkdir(`public/pdf/${folder}`, { recursive: true });
  await cp(`node_modules/pdfjs-dist/${folder}`, `public/pdf/${folder}`, { recursive: true });
}
