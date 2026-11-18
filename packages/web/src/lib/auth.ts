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

/** POST /api/login. A senha só trafega aqui; o cliente nunca a guarda. */
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

// ---------------------------------------------------------------------------
// Persistência da sessão (só o token; sobrevive a F5 mas não ao fechar a aba)
// ---------------------------------------------------------------------------

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'screenshare.session';

// sessionStorage pode lançar (modo privado, dados bloqueados): tudo é best-effort.
function defaultStorage(): SessionStorageLike | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function storeSession(session: Session, storage = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Sem storage: a sessão vive só em memória e um F5 volta ao login.
  }
}

export function clearStoredSession(storage = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // ignorado
  }
}

/** Devolve a sessão guardada se ainda for válida; descarta e limpa se expirou ou corrompeu. */
export function loadStoredSession(
  now: number = Date.now(),
  storage = defaultStorage(),
): Session | null {
  let raw: string | null | undefined;
  try {
    raw = storage?.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    clearStoredSession(storage);
    return null;
  }
  const parsed = loginResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.expiresAt <= now) {
    clearStoredSession(storage);
    return null;
  }
  return parsed.data;
}
