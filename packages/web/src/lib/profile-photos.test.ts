import { avatarIdSchema } from '@screenshare/shared';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_PHOTOS } from './background-photos';
import { findProfilePhoto, PROFILE_PHOTOS } from './profile-photos';

describe('PROFILE_PHOTOS', () => {
  it('ids únicos e válidos para o servidor, arquivos vindos de /fotos/', () => {
    expect(new Set(PROFILE_PHOTOS.map((p) => p.id)).size).toBe(PROFILE_PHOTOS.length);
    for (const photo of PROFILE_PHOTOS) {
      expect(avatarIdSchema.safeParse(photo.id).success).toBe(true);
      expect(photo.src).toMatch(/^\/fotos\/[\w.-]+\.(jpg|jpeg|png|webp)$/);
      expect(photo.label.length).toBeGreaterThan(0);
    }
  });
});

describe('fotos escolhíveis', () => {
  it('são as 18 enviadas (perfil-1 a perfil-18), na ordem', () => {
    expect(PROFILE_PHOTOS.map((p) => p.id)).toEqual(
      Array.from({ length: 18 }, (_, i) => `perfil-${i + 1}`),
    );
  });

  it('as fotos do fundo da tela de login não podem ser escolhidas como perfil', () => {
    const backgroundFiles = new Set(BACKGROUND_PHOTOS.map((p) => p.src));
    for (const photo of PROFILE_PHOTOS) expect(backgroundFiles.has(photo.src)).toBe(false);
    expect(findProfilePhoto('guri-1')).toBeUndefined();
  });
});

describe('findProfilePhoto', () => {
  it('acha pelo id; sem id ou id desconhecido devolve undefined (imagem padrão)', () => {
    expect(findProfilePhoto('perfil-1')?.src).toBe('/fotos/perfil-1.png');
    expect(findProfilePhoto('perfil-2')?.src).toBe('/fotos/perfil-2.webp');
    expect(findProfilePhoto(null)).toBeUndefined();
    expect(findProfilePhoto(undefined)).toBeUndefined();
    expect(findProfilePhoto('nao-existe')).toBeUndefined();
  });
});
