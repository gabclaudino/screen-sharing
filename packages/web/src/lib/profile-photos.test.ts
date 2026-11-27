import { describe, expect, it, vi } from 'vitest';
import { fetchProfilePhotos, findProfilePhoto, isProfilePhotoId } from './profile-photos';

const respond = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('fetchProfilePhotos', () => {
  it('monta endereço e rótulo a partir da lista do servidor, com o token', async () => {
    const fetchImpl = respond({ photos: [{ id: 'perfil-19', file: 'perfil-19.JPG' }] });
    expect(await fetchProfilePhotos('abc', fetchImpl)).toEqual([
      { id: 'perfil-19', src: '/fotos/perfil-19.JPG', label: 'Foto 19' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/photos', {
      headers: { Authorization: 'Bearer abc' },
    });
  });

  it('lança com erro HTTP ou arquivo que não é foto de perfil', async () => {
    await expect(fetchProfilePhotos('abc', respond({}, 401))).rejects.toThrow('401');
    const outside = respond({ photos: [{ id: 'perfil-1', file: '../segredo.png' }] });
    await expect(fetchProfilePhotos('abc', outside)).rejects.toThrow('formato');
  });
});

describe('ids', () => {
  const photos = [{ id: 'perfil-1', src: '/fotos/perfil-1.png', label: 'Foto 1' }];

  it('acha pelo id; sem id ou fora da lista devolve undefined (imagem padrão)', () => {
    expect(findProfilePhoto('perfil-1', photos)?.src).toBe('/fotos/perfil-1.png');
    expect(findProfilePhoto('perfil-2', photos)).toBeUndefined();
    expect(findProfilePhoto(null, photos)).toBeUndefined();
  });

  it('só perfil-N vale como foto escolhida; as do fundo da tela de login não', () => {
    expect(isProfilePhotoId('perfil-18')).toBe(true);
    for (const id of [null, '', 'guri-1', 'perfil-', 'Perfil-1', 'perfil-1.png']) {
      expect(isProfilePhotoId(id)).toBe(false);
    }
  });
});
