import { readdir } from 'node:fs/promises';
import { MAX_PROFILE_PHOTOS, PROFILE_PHOTO_FILE } from '@screenshare/shared';

export interface PhotoFile {
  /** `perfil-N`: o que os navegadores trocam entre si. */
  id: string;
  file: string;
}

/**
 * As fotos de perfil da pasta (`perfil-N.jpg|jpeg|png|webp`), em ordem de número. Com dois arquivos
 * para o mesmo número, vale o primeiro em ordem alfabética. Pasta ausente = nenhuma foto.
 */
export async function listProfilePhotos(dir: string): Promise<PhotoFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const byNumber = new Map<number, string>();
  for (const name of names.sort()) {
    const number = PROFILE_PHOTO_FILE.exec(name)?.[1];
    if (number === undefined || byNumber.has(Number(number))) continue;
    byNumber.set(Number(number), name);
  }
  return [...byNumber]
    .sort(([a], [b]) => a - b)
    .slice(0, MAX_PROFILE_PHOTOS)
    .map(([number, file]) => ({ id: `perfil-${number}`, file }));
}
