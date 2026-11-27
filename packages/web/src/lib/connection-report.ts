import type { ConnectionReport } from '@screenshare/shared';
import type { Session } from './auth';

/**
 * Manda o relato ao log do servidor. É só diagnóstico: falhas não afetam a sala. `keepalive` deixa
 * o envio terminar mesmo se a página estiver sendo recarregada.
 */
export function sendConnectionReport(
  session: Session | null,
  report: ConnectionReport,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): void {
  if (!session) return;
  fetchImpl('/api/report', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch((error: unknown) => console.warn('[diagnóstico] relato não enviado:', error));
}
