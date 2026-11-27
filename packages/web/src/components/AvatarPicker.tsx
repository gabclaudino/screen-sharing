import { useContext, useEffect, useRef } from 'react';
import { ProfilePhotosContext } from '../hooks/useProfilePhotos';
import { Avatar } from './Avatar';

interface Props {
  open: boolean;
  /** Foto atual (id) ou `null` se não há. */
  current: string | null;
  onSelect: (photoId: string | null) => void;
  onClose: () => void;
}

/** Seletor da foto de perfil, num <dialog> nativo (Esc ou clique fora fecham). */
export function AvatarPicker({ open, current, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const photos = useContext(ProfilePhotosContext);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function choose(photoId: string | null) {
    onSelect(photoId);
    onClose();
  }

  return (
    <dialog
      ref={ref}
      className="avatar-picker"
      aria-labelledby="avatar-picker-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <h2 id="avatar-picker-title">Escolha sua foto de perfil</h2>
      {open ? (
        <ul className="avatar-options">
          <li>
            <button
              type="button"
              className="avatar-option"
              aria-pressed={current === null}
              aria-label="Sem foto"
              onClick={() => choose(null)}
            >
              <Avatar photoId={null} name="" size={72} />
              <span>Sem foto</span>
            </button>
          </li>
          {photos.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                className="avatar-option"
                aria-pressed={current === photo.id}
                aria-label={photo.label}
                onClick={() => choose(photo.id)}
              >
                <Avatar photoId={photo.id} name="" size={72} />
                <span>{photo.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="avatar-picker-close" onClick={onClose}>
        Cancelar
      </button>
    </dialog>
  );
}
