import { profilePhotosResponseSchema } from '@screenshare/shared';

/**
 * Fotos de perfil que a pessoa pode escolher (clicando no próprio ícone na lista de participantes).
 * São os arquivos `perfil-N.jpg|jpeg|png|webp` de `public/fotos/` (fora do git: o repositório é
 * público e as fotos são de pessoas); o servidor lista a pasta em `/api/photos`.
 */
export interface ProfilePhoto {
  /** `perfil-N`: o que vai para o servidor e para os outros. */
  id: string;
  src: string;
  /** Texto alternativo / nome da opção no seletor. */
  label: string;
}

/** Formato de um id de foto (descarta lixo guardado no navegador, que o servidor recusaria). */
export const isProfilePhotoId = (id: string | null): id is string =>
  id !== null && /^perfil-\d{1,4}$/.test(id);

/** GET /api/photos com o token de sessão. Lança se a resposta não for utilizável. */
export async function fetchProfilePhotos(
  token: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<ProfilePhoto[]> {
  const response = await fetchImpl('/api/photos', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`/api/photos respondeu HTTP ${response.status}`);
  const parsed = profilePhotosResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('/api/photos devolveu um formato inesperado');
  return parsed.data.photos.map(({ id, file }) => ({
    id,
    src: `/fotos/${file}`,
    label: `Foto ${id.slice('perfil-'.length)}`,
  }));
}

/** A foto de um id; `undefined` para sem id ou um id que não está na lista. */
export function findProfilePhoto(
  id: string | null | undefined,
  photos: readonly ProfilePhoto[],
): ProfilePhoto | undefined {
  return id ? photos.find((photo) => photo.id === id) : undefined;
}
