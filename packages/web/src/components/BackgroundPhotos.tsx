import { BACKGROUND_PHOTOS } from '../lib/background-photos';

/**
 * Fotos decorativas espalhadas pelo fundo (atrás do formulário). Não recebem clique e ficam
 * escondidas para leitores de tela. Se um arquivo não existir (as fotos não vão no git), aquela
 * foto some em vez de mostrar uma imagem quebrada.
 */
export function BackgroundPhotos() {
  return (
    <div className="bg-photos" aria-hidden="true">
      {BACKGROUND_PHOTOS.map((photo) => (
        <img
          key={photo.src}
          className={`bg-photo ${photo.className}`}
          src={photo.src}
          alt=""
          decoding="async"
          draggable={false}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ))}
    </div>
  );
}
