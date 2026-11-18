import { createServer } from 'node:http';
import { PROTOCOL_VERSION } from '@screenshare/shared';

// Placeholder da fase 1: só confirma que o workspace sobe e resolve @screenshare/shared.
// HTTP/WS reais, config validada com zod e segurança entram na fase 3.
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`screenshare server (protocol v${PROTOCOL_VERSION})\n`);
});

server.listen(port, host, () => {
  console.log(`server listening on http://${host}:${port}`);
});
