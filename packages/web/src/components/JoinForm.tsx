import { useMemo, useState, type FormEvent } from 'react';
import { NAME_MAX_LENGTH } from '@screenshare/shared';
import { loadStoredSession, login, LoginError, storeSession, type Session } from '../lib/auth';
import { isValidName, loadProfile, saveProfile } from '../lib/profile';

export interface JoinParams {
  name: string;
  session: Session;
}

interface Props {
  /** Aviso vindo da sala anterior (sessão expirada, sala cheia...). */
  notice?: string | null;
  onJoin: (params: JoinParams) => void;
}

export function JoinForm({ notice, onJoin }: Props) {
  const initial = useMemo(() => {
    const profile = loadProfile();
    return {
      name: profile.name ?? '',
      stored: loadStoredSession(),
    };
  }, []);

  const [name, setName] = useState(initial.name);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!isValidName(trimmedName)) {
      setError(`Digite um nome de 1 a ${NAME_MAX_LENGTH} caracteres.`);
      return;
    }

    setBusy(true);
    try {
      let session = initial.stored;
      if (password !== '') {
        session = await login(password);
        storeSession(session);
      }
      if (!session) {
        setError('Digite a senha de acesso.');
        return;
      }
      saveProfile({ name: trimmedName });
      onJoin({ name: trimmedName, session });
    } catch (loginError) {
      setError(loginError instanceof LoginError ? loginError.message : 'Erro inesperado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="join">
      <form className="card join-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1>ScreenShare Mesh</h1>
        <p className="muted">
          Compartilhe sua tela com os amigos, direto de navegador para navegador.
        </p>

        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}

        <label>
          Seu nome
          <input
            type="text"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>

        <label>
          Senha de acesso
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder={initial.stored ? 'Sessão ativa: senha opcional' : ''}
          />
        </label>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar na sala'}
        </button>
      </form>
    </main>
  );
}
