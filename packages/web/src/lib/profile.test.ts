import { describe, expect, it } from 'vitest';
import {
  hasSeenAudioGuide,
  isValidName,
  loadPlayback,
  loadProfile,
  markAudioGuideSeen,
  savePlayback,
  saveProfile,
} from './profile';

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe('validação', () => {
  it('isValidName aplica trim, tamanho e caracteres de controle', () => {
    expect(isValidName('  Ana  ')).toBe(true);
    expect(isValidName('   ')).toBe(false);
    expect(isValidName('a'.repeat(31))).toBe(false);
    expect(isValidName('A\u0000na')).toBe(false);
  });
});

describe('volume e mudo lembrados', () => {
  it('padrão: volume 100 e sem mudo', () => {
    expect(loadPlayback(fakeStorage())).toEqual({ volume: 100, muted: false });
  });

  it('salva e recarrega', () => {
    const storage = fakeStorage();
    savePlayback({ volume: 35, muted: true }, storage);
    expect(loadPlayback(storage)).toEqual({ volume: 35, muted: true });
  });

  it('limita o volume a 0–100 e ignora valores inválidos', () => {
    const storage = fakeStorage();
    storage.setItem('screenshare.playback', JSON.stringify({ volume: 250, muted: 'sim' }));
    expect(loadPlayback(storage)).toEqual({ volume: 100, muted: false });
    storage.setItem('screenshare.playback', JSON.stringify({ volume: -10 }));
    expect(loadPlayback(storage).volume).toBe(0);
    storage.setItem('screenshare.playback', JSON.stringify({ volume: 'alto' }));
    expect(loadPlayback(storage).volume).toBe(100);
    storage.setItem('screenshare.playback', '{nope');
    expect(loadPlayback(storage)).toEqual({ volume: 100, muted: false });
  });

  it('tolera storage ausente ou que lança', () => {
    const throwing = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadPlayback(throwing)).toEqual({ volume: 100, muted: false });
    expect(() => savePlayback({ volume: 10, muted: false }, throwing)).not.toThrow();
    expect(loadPlayback()).toEqual({ volume: 100, muted: false }); // sem localStorage (Node)
  });
});

describe('guia de áudio visto', () => {
  it('começa como não visto e lembra depois de marcado', () => {
    const storage = fakeStorage();
    expect(hasSeenAudioGuide(storage)).toBe(false);
    markAudioGuideSeen(storage);
    expect(hasSeenAudioGuide(storage)).toBe(true);
  });

  it('tolera storage ausente ou que lança', () => {
    const throwing = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(hasSeenAudioGuide(throwing)).toBe(false);
    expect(() => markAudioGuideSeen(throwing)).not.toThrow();
    expect(hasSeenAudioGuide()).toBe(false); // sem localStorage global (Node)
  });
});

describe('perfil lembrado', () => {
  it('salva e recarrega o nome', () => {
    const storage = fakeStorage();
    saveProfile({ name: 'Ana' }, storage);
    expect(loadProfile(storage)).toEqual({ name: 'Ana' });
  });

  it('nunca guarda senha', () => {
    const storage = fakeStorage();
    saveProfile({ name: 'Ana' }, storage);
    expect([...storage.data.values()].join('')).not.toMatch(/senha|password/i);
  });

  it('ignora valores inválidos ou corrompidos', () => {
    const storage = fakeStorage();
    storage.setItem('screenshare.profile', JSON.stringify({ name: '   ' }));
    expect(loadProfile(storage)).toEqual({});
    storage.setItem('screenshare.profile', '{nope');
    expect(loadProfile(storage)).toEqual({});
    expect(loadProfile(fakeStorage())).toEqual({});
  });

  it('tolera storage ausente ou que lança', () => {
    const throwing = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadProfile(throwing)).toEqual({});
    expect(() => saveProfile({ name: 'Ana' }, throwing)).not.toThrow();
    expect(loadProfile()).toEqual({}); // sem localStorage global (Node)
  });
});
