import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function fileStats(target: string) {
  try {
    const stats = await stat(target);
    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serve o build do React: arquivos com hash em /assets/ ficam em cache longo, o resto
 * (incluindo index.html) não é cacheado. Rotas sem extensão caem no index.html (SPA).
 */
export function createStaticHandler(rootDir: string) {
  const root = path.resolve(rootDir);

  return async (req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendText(res, 400, 'Bad Request');
      return;
    }
    if (decoded.includes('\0')) {
      sendText(res, 400, 'Bad Request');
      return;
    }

    const relative = decoded.replace(/^[/\\]+/, '');
    let target = path.resolve(root, relative);
    // Barreira contra path traversal (inclui `..\` no Windows).
    if (target !== root && !target.startsWith(root + path.sep)) {
      sendText(res, 404, 'Not Found');
      return;
    }

    let stats = await fileStats(target);
    if (!stats) {
      if (path.extname(relative) !== '') {
        sendText(res, 404, 'Not Found');
        return;
      }
      target = path.join(root, 'index.html');
      stats = await fileStats(target);
      if (!stats) {
        sendText(res, 404, 'Frontend não encontrado: rode `npm run build` (ou use o Vite em dev).');
        return;
      }
    }

    const isImmutable = path.relative(root, target).split(path.sep)[0] === 'assets';
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(target)
      .on('error', () => res.destroy())
      .pipe(res);
  };
}
