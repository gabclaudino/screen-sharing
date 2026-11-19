import { createApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { createConsoleLogger } from './logger';

const logger = createConsoleLogger();

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const app = createApp(config, { logger });

app.server.on('error', (error: NodeJS.ErrnoException) => {
  logger.error('server_error', { code: error.code, message: error.message });
  process.exit(1);
});

app.server.listen(config.port, config.host, () => {
  logger.info('listening', { host: config.host, port: config.port, env: config.nodeEnv });
});

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown', { signal });
  // Se o encerramento travar (conexão que não fecha), não deixa o processo pendurado.
  setTimeout(() => process.exit(1), 5_000).unref();
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Promise rejeitada sem tratamento: registra e segue (um peer com problema não derruba a sala).
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

// Exceção não capturada deixa o processo num estado desconhecido: registra e sai com erro,
// para o gerenciador do serviço (NSSM, tarefa agendada...) subir uma instância limpa.
process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { message: error.message });
  process.exit(1);
});
