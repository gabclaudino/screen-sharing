import { loginResponseSchema } from '@screenshare/shared';

export interface Session {
  token: string;
  /** Epoch em ms em que o token expira. */
  expiresAt: number;
}

export type LoginErrorCode = 'BAD_PASSWORD' | 'RATE_LIMITED' | 'NETWORK' | 'SERVER';

export class LoginError extends Error {
  readonly code: LoginErrorCode;

  constructor(code: LoginErrorCode, message: string) {
    super(message);
    this.name = 'LoginError';
    this.code = code;
  }
}

/**
 * POST /api/login. A senha só trafega aqui; o cliente nunca a guarda. O token devolvido fica só
 * em memória (nada em sessionStorage): recarregar a página ou sair da sala exige a senha de novo.
 */
export async function login(
  password: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<Session> {
  let response: Response;
  try {
    response = await fetchImpl('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new LoginError('NETWORK', 'Não foi possível falar com o servidor');
  }

  if (response.status === 401) throw new LoginError('BAD_PASSWORD', 'Senha incorreta');
  if (response.status === 429) {
    throw new LoginError('RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos');
  }
  if (!response.ok) throw new LoginError('SERVER', `Erro do servidor (${response.status})`);

  const parsed = loginResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new LoginError('SERVER', 'Resposta inesperada do servidor');
  return parsed.data;
}
