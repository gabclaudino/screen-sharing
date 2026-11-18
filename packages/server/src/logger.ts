// Logs só de eventos (join/leave/erro). Nunca logar conteúdo de sinalização (SDP contém IPs)
// nem a URL do upgrade do WS (contém o token).
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createConsoleLogger(): Logger {
  const write = (level: 'info' | 'warn' | 'error', event: string, fields?: LogFields): void => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
