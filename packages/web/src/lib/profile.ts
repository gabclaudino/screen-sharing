import { avatarIdSchema, isValidName } from '@screenshare/shared';

// A regra do nome é a mesma do servidor (fica em @screenshare/shared).
export { isValidName };

export interface Profile {
  name: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const PROFILE_KEY = 'screenshare.profile';

// localStorage pode lançar (modo privado, dados bloqueados): tudo é best-effort.
function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Lembra o nome (nunca a senha) entre visitas. */
export function loadProfile(storage = defaultStorage()): Partial<Profile> {
  try {
    const raw = storage?.getItem(PROFILE_KEY);
    if (!raw) return {};
    const json = JSON.parse(raw) as Record<string, unknown>;
    const profile: Partial<Profile> = {};
    if (typeof json.name === 'string' && isValidName(json.name)) profile.name = json.name.trim();
    return profile;
  } catch {
    return {};
  }
}

/** Volume (0–100) e mudo de quem assiste; vale para qualquer transmissão. */
export interface Playback {
  volume: number;
  muted: boolean;
}

export const DEFAULT_PLAYBACK: Playback = { volume: 100, muted: false };

const PLAYBACK_KEY = 'screenshare.playback';

export function loadPlayback(storage = defaultStorage()): Playback {
  try {
    const raw = storage?.getItem(PLAYBACK_KEY);
    if (!raw) return DEFAULT_PLAYBACK;
    const json = JSON.parse(raw) as Record<string, unknown>;
    const volume = json.volume;
    return {
      volume:
        typeof volume === 'number' && Number.isFinite(volume)
          ? Math.min(100, Math.max(0, Math.round(volume)))
          : DEFAULT_PLAYBACK.volume,
      muted: json.muted === true,
    };
  } catch {
    return DEFAULT_PLAYBACK;
  }
}

export function savePlayback(playback: Playback, storage = defaultStorage()): void {
  try {
    storage?.setItem(PLAYBACK_KEY, JSON.stringify(playback));
  } catch {
    // sem storage: o ajuste só não é lembrado na próxima visita
  }
}

const GUIDE_SEEN_KEY = 'screenshare.audioGuideSeen';

/** O guia de áudio abre sozinho na primeira vez que o áudio do sistema é ligado. */
export function hasSeenAudioGuide(storage = defaultStorage()): boolean {
  try {
    return storage?.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markAudioGuideSeen(storage = defaultStorage()): void {
  try {
    storage?.setItem(GUIDE_SEEN_KEY, '1');
  } catch {
    // sem storage: o guia pode abrir sozinho de novo, sem prejuízo
  }
}

const AVATAR_KEY = 'screenshare.avatar';

/** Foto de perfil escolhida (só o id), lembrada entre visitas; `null` = sem foto. */
export function loadAvatar(storage = defaultStorage()): string | null {
  try {
    const value = storage?.getItem(AVATAR_KEY);
    return avatarIdSchema.safeParse(value).success ? (value as string) : null;
  } catch {
    return null;
  }
}

export function saveAvatar(avatar: string | null, storage = defaultStorage()): void {
  try {
    if (avatar === null) storage?.setItem(AVATAR_KEY, '');
    else storage?.setItem(AVATAR_KEY, avatar);
  } catch {
    // sem storage: a foto só não é lembrada na próxima visita
  }
}

export function saveProfile(profile: Profile, storage = defaultStorage()): void {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // sem storage: só não lembramos na próxima vez
  }
}
