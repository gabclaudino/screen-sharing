import { describe, expect, it } from 'vitest';
import { describeCaptureError } from './useScreenShare';

describe('describeCaptureError', () => {
  it.each([
    ['NotAllowedError', /negada|cancelada/i],
    ['NotFoundError', /nenhuma tela/i],
    ['NotReadableError', /ler a tela/i],
    ['AbortError', /interrompida/i],
  ])('mapeia %s', (name, message) => {
    expect(describeCaptureError(new DOMException('x', name))).toMatch(message);
  });

  it('erros desconhecidos viram mensagem genérica', () => {
    expect(describeCaptureError(new Error('boom'))).toMatch(/não foi possível/i);
    expect(describeCaptureError(undefined)).toMatch(/não foi possível/i);
    expect(describeCaptureError(new DOMException('x', 'OutroErro'))).toMatch(/não foi possível/i);
  });
});
