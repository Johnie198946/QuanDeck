import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Keep all PDF font maps and decoders inside the installed application. */
export function localPdfAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'quandeck-local-pdf-assets',
    generateBundle() {
      for (const folder of folders) for (const name of fs.readdirSync(path.join(root, folder))) {
        const file = path.join(root, folder, name);
        if (fs.statSync(file).isFile()) this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${name}`, source: fs.readFileSync(file) });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/pdfjs\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/.exec((request.url ?? '').split('?')[0]);
        if (!match || !['GET', 'HEAD'].includes(request.method ?? '')) return next();
        const file = path.join(root, match[1], match[2]);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        response.setHeader('Content-Type', match[2].endsWith('.wasm') ? 'application/wasm' : match[2].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        if (request.method === 'HEAD') return response.end();
        fs.createReadStream(file).on('error', next).pipe(response);
      });
    },
  };
}
