import { useState } from 'react';
import { findProfilePhoto } from '../lib/profile-photos';
import { NoPhotoIcon } from './icons';

interface Props {
  /** Id da foto de perfil; `null`/desconhecido = imagem padrão "sem foto". */
  photoId: string | null;
  /** Só para a foto: o nome de quem é. Vazio = imagem decorativa (o botão em volta já tem rótulo). */
  name: string;
  /** Lado do círculo em px. */
  size?: number;
}

/** Foto de perfil redonda. Cai na imagem padrão se não há foto, o id é desconhecido ou o arquivo falta. */
export function Avatar({ photoId, name, size = 32 }: Props) {
  const photo = findProfilePhoto(photoId);
  // Arquivo que não carregou (as fotos não vão no git): mostra o padrão em vez de imagem quebrada.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = photo !== undefined && photo.src !== failedSrc;

  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {showPhoto ? (
        <img
          src={photo.src}
          alt={name === '' ? '' : `Foto de perfil de ${name}`}
          draggable={false}
          decoding="async"
          onError={() => setFailedSrc(photo.src)}
        />
      ) : (
        <NoPhotoIcon />
      )}
    </span>
  );
}
