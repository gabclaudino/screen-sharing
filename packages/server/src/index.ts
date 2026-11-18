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

const shutdown = (signal: string): void => {
  logger.info('shutdown', { signal });
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
