import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ configFile: false, publicDir: false, root, build: {
  target: 'node22', outDir: path.join(root, 'desktop/app'), emptyOutDir: false,
  lib: { entry: path.join(root, 'src/data/desktopCore.ts'), formats: ['es'], fileName: () => 'workdeck-core.mjs' },
  minify: false,
} });
