import { createContext, useEffect, useState } from 'react';
import { fetchProfilePhotos, type ProfilePhoto } from '../lib/profile-photos';

/** Lista em uso na sala, para os avatares e o seletor. */
export const ProfilePhotosContext = createContext<readonly ProfilePhoto[]>([]);

/**
 * Busca as fotos disponíveis e busca de novo quando `refreshKey` muda. Se a busca falhar, mantém a
 * lista anterior (sem lista, todos aparecem com a imagem padrão).
 */
export function useProfilePhotos(token: string, refreshKey: string): readonly ProfilePhoto[] {
  const [photos, setPhotos] = useState<readonly ProfilePhoto[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchProfilePhotos(token).then(
      (list) => {
        if (!cancelled) setPhotos(list);
      },
      (error: unknown) => console.warn('[fotos] lista indisponível:', error),
    );
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  return photos;
}
