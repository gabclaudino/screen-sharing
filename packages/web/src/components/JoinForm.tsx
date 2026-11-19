import { useState, type FormEvent } from 'react';
import { NAME_MAX_LENGTH } from '@screenshare/shared';
import { login, LoginError, type Session } from '../lib/auth';
import { validateJoin } from '../lib/join-validation';
import { loadProfile, saveProfile } from '../lib/profile';
import { isRoomSupported } from '../lib/support';
import { BackgroundPhotos } from './BackgroundPhotos';

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
  // Só o nome é lembrado entre visitas; a senha nunca.
  const [name, setName] = useState(() => loadProfile().name ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Sem WebRTC não há como assistir nem compartilhar: avisa antes de pedir a senha.
    if (!isRoomSupported()) {
      setError(
        'Este navegador não suporta WebRTC. Use uma versão recente do Chrome, Edge, Firefox ou Safari.',
      );
      return;
    }

    // A senha é exigida SEMPRE, há ou não alguém na sala, e a cada vez que se entra.
    const invalid = validateJoin(name, password);
    if (invalid) {
      setError(invalid);
      return;
    }
    const trimmedName = name.trim();

    setBusy(true);
    try {
      const session = await login(password);
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
      <BackgroundPhotos />
      <form className="card join-form" onSubmit={(event) => void handleSubmit(event)}>
        <h1>Tela dos Guri</h1>
        <p className="muted">Se Liga Fi !</p>

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
            required
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
