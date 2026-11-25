// Ambiente de desenvolvimento isolado, para acompanhar mudanças no navegador sem encostar no
// servidor de verdade: portas próprias, sem o .env, sem TURN e só em localhost.
// Abra http://localhost:5199 e entre com a senha de teste abaixo.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = '3101';
const WEB_PORT = '5199';

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: API_PORT,
  DEV_API_PORT: API_PORT,
  ALLOWED_ORIGIN: `http://localhost:${WEB_PORT}`,
  // Valores descartáveis, válidos só neste ambiente local.
  ACCESS_PASSWORD: 'senha-de-teste-123',
  SESSION_SECRET: 'segredo-descartavel-somente-para-desenvolvimento-local',
  ICE_PROVIDER: 'none',
  MAX_PEERS_PER_ROOM: '12',
  LOGIN_RATE_MAX: '100',
};

const bin = (...parts) => path.join(root, 'node_modules', ...parts);

// Cada processo ganha a própria entrada: no Windows, dois processos dividindo a mesma entrada
// travam um ao outro na partida (o Vite nunca abre a porta), e o Vite encerra se ela fechar.
const run = (cwd, args) =>
  spawn(process.execPath, args, {
    cwd: path.join(root, cwd),
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

const children = [
  run('packages/server', [bin('tsx', 'dist', 'cli.mjs'), 'watch', 'src/index.ts']),
  run('packages/web', [bin('vite', 'bin', 'vite.js'), '--port', WEB_PORT, '--strictPort']),
];

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
};
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
