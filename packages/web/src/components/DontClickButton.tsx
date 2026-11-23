import { useEffect, useRef, useState } from 'react';

// Fica em public/fotos/ (fora do git, como as outras fotos de pessoas): num clone novo o arquivo
// não existe e o diálogo mostra só o aviso em texto.
const IMAGE_SRC = '/fotos/nao-clique.png';

/** Botão "Não clique" que abre uma imagem num <dialog> nativo (Esc ou clique fora fecham). */
export function DontClickButton() {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button type="button" className="dont-click" onClick={() => setOpen(true)}>
        Não clique
      </button>
      <dialog
        ref={ref}
        className="meme"
        aria-label="Eu avisei"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        {missing ? (
          <p className="meme-missing">Eu avisei.</p>
        ) : (
          <img
            src={IMAGE_SRC}
            alt="Um homem comendo um cachorro-quente na rua, à noite"
            draggable={false}
            onError={() => setMissing(true)}
          />
        )}
        <button type="button" className="meme-close" onClick={() => setOpen(false)}>
          Fechar
        </button>
      </dialog>
    </>
  );
}
