import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Guia passo a passo (Windows + Chrome/Edge) para o áudio do sistema não levar a voz da call
 * de volta aos espectadores. Usa o <dialog> nativo: Esc fecha, foco preso, fundo escurecido.
 */
export function AudioGuideDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="guide"
      aria-labelledby="guide-title"
      onClose={onClose}
      // Clique no fundo (o próprio <dialog>, fora do conteúdo) fecha.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="guide-body">
        <h2 id="guide-title">Compartilhar áudio sem eco (Windows)</h2>

        <p>
          O “áudio do sistema” leva <strong>tudo</strong> que toca no PC, inclusive a voz dos amigos
          no Discord. Quem assiste ouviria a própria voz de volta. A solução é mandar o Discord
          direto para o fone, <strong>fora</strong> do áudio que o navegador captura, usando o
          VB-CABLE (um dispositivo de áudio virtual gratuito).
        </p>

        <pre className="guide-diagram" aria-label="Caminho do áudio">
          {`Jogo / vídeo ──► CABLE Input ──┬──► navegador captura (vai pro stream)
                               └──► "Ouvir este dispositivo" ──► seu fone
Discord (amigos) ─────────────────────────────────────────► seu fone (direto)`}
        </pre>

        <ol className="guide-steps">
          <li>
            <strong>Instale o VB-CABLE.</strong> Baixe em <code>vb-audio.com/Cable</code>, extraia,
            execute <code>VBCABLE_Setup_x64.exe</code> como administrador e{' '}
            <strong>reinicie</strong> o PC.
          </li>
          <li>
            <strong>Saída padrão do Windows = “CABLE Input”.</strong> Configurações → Sistema → Som
            → Saída. Você vai ficar sem som até o próximo passo.
          </li>
          <li>
            <strong>Ouça o cabo no seu fone.</strong> Pressione <code>Win + R</code>, digite{' '}
            <code>mmsys.cpl</code> → aba <em>Gravação</em> → dois cliques em <em>CABLE Output</em> →
            aba <em>Escutar</em> → marque <em>Ouvir este dispositivo</em> e escolha o seu fone real
            em “Reproduzir através deste dispositivo”.
          </li>
          <li>
            <strong>Discord direto para o fone.</strong> Configurações de usuário → Voz e vídeo →{' '}
            <em>Dispositivo de saída</em> = seu fone real (<strong>não</strong> “Padrão”). Se o
            Discord já estava aberto, feche e abra de novo.
          </li>
          <li>
            <strong>Compartilhe a tela inteira.</strong> Aqui no app, com “Áudio do sistema”
            marcado, clique em <em>Compartilhar tela</em>. No seletor do navegador, escolha a aba{' '}
            <em>Tela inteira</em> e marque <em>Compartilhar áudio do sistema</em>.
          </li>
          <li>
            <strong>Teste.</strong> Peça a um amigo para assistir e outro falar no Discord: ele deve
            ouvir o vídeo e <strong>não</strong> a própria voz.
          </li>
        </ol>

        <details>
          <summary>Dicas e limitações</summary>
          <ul>
            <li>
              O volume do Windows agora controla o que vai no stream: deixe em 100% e ajuste pelo
              fone ou pelo Discord.
            </li>
            <li>
              Tudo, menos o Discord, entra no stream (Spotify, notificações...). Feche o que você
              não quer expor.
            </li>
            <li>
              Ao compartilhar só uma <em>janela</em>, o Chrome/Edge no Windows costuma não oferecer
              áudio. Use a tela inteira.
            </li>
            <li>
              Só quer mostrar algo do navegador (YouTube, filme)? Compartilhe uma <em>aba</em>: o
              navegador captura só o áudio dela e nada disso é necessário.
            </li>
          </ul>
        </details>

        <details>
          <summary>Ainda ouvem eco?</summary>
          <ul>
            <li>
              Confira se a saída do Discord <strong>não</strong> está em “Padrão”.
            </li>
            <li>
              No mixer de volume do Windows (clique direito no ícone de som), com o Discord falando,
              a barra dele deve estar sob o seu fone real, não sob o CABLE.
            </li>
            <li>
              Confirme que escolheu <em>Tela inteira</em> e marcou{' '}
              <em>Compartilhar áudio do sistema</em> no seletor.
            </li>
          </ul>
        </details>

        <details>
          <summary>Como desfazer</summary>
          <ul>
            <li>Volte a saída padrão do Windows para o seu fone ou alto-falante.</li>
            <li>
              Em <code>mmsys.cpl</code> → Gravação → CABLE Output → Escutar, desmarque{' '}
              <em>Ouvir este dispositivo</em>.
            </li>
            <li>No Discord, volte a saída para “Padrão”.</li>
          </ul>
        </details>

        <div className="guide-actions">
          <button type="button" className="primary" onClick={onClose}>
            Entendi
          </button>
        </div>
      </div>
    </dialog>
  );
}
