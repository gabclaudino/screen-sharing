import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Guia passo a passo (Windows + Chrome/Edge) para o áudio do sistema não levar a voz da call
 * de volta aos espectadores. Usa o <dialog> nativo: Esc fecha, foco preso, fundo escurecido.
 *
 * A ideia central: o navegador captura o que sai pelo dispositivo PADRÃO do Windows. Para o
 * Discord ficar de fora ele precisa sair por OUTRO dispositivo. Se o padrão já for o próprio fone,
 * apontar o Discord para o fone não muda nada (os dois saem pelo mesmo lugar), e é aí que entra
 * um dispositivo virtual como padrão: o FxSound (que se impõe sozinho) ou o VB-CABLE.
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
          O “áudio do sistema” leva o que toca no <strong>dispositivo padrão</strong> do Windows. Se
          a voz dos amigos (Discord) sair por ele, quem assiste ouve a própria voz de volta. Para o
          Discord ficar de fora, ele precisa sair por <strong>outro</strong> dispositivo.
        </p>

        <p className="guide-warning" role="note">
          <strong>Atenção:</strong> mandar o Discord “para o fone” só adianta se o dispositivo
          padrão do Windows for <strong>outro</strong> (como o FxSound ou o VB-CABLE). Se o padrão
          já é o seu fone, os dois saem pelo mesmo lugar e a voz continua indo para o stream.
        </p>

        <h3 className="guide-subtitle">Qual é o seu caso?</h3>
        <p className="guide-note">
          Clique no ícone de som da barra de tarefas: o dispositivo mostrado é o padrão.
        </p>

        <pre className="guide-diagram" aria-label="Caminho do áudio">
          {`Jogo / vídeo ──► padrão (virtual) ──┬──► navegador captura (stream)
                                     └──► seu fone
Discord (amigos) ───────────────────────► seu fone (direto, fora do stream)`}
        </pre>

        <h3 className="guide-subtitle">
          Caso A: o padrão já é virtual (FxSound, CABLE, Voicemeeter)
        </h3>
        <p className="guide-note">
          Não precisa instalar nada. Vale para quem usa o <strong>FxSound</strong>: ele já se coloca
          como dispositivo padrão.
        </p>
        <ol className="guide-steps">
          <li>
            <strong>Mande o Discord direto para o fone.</strong> Configurações de usuário → Voz e
            vídeo → <em>Dispositivo de saída</em> = o seu fone real (<strong>não</strong> “Padrão” e
            não o FxSound). Se o Discord já estava aberto, feche e abra de novo.
          </li>
          <li>
            <strong>Deixe a saída padrão do Windows como está</strong> (FxSound ligado, por
            exemplo). O equalizador continua valendo para o som do jogo/vídeo; a voz do Discord vai
            direto ao fone, sem passar por ele.
          </li>
          <li>
            <strong>Compartilhe a tela inteira.</strong> Aqui no app, com “Áudio do sistema”
            marcado, clique em <em>Compartilhar tela</em>. No seletor do navegador, escolha a aba{' '}
            <em>Tela inteira</em> e marque <em>Compartilhar áudio do sistema</em>.
          </li>
        </ol>

        <h3 className="guide-subtitle">Caso B: o padrão é o seu fone (Windows comum)</h3>
        <p className="guide-note">
          Aqui é preciso criar o dispositivo padrão separado, com o <strong>VB-CABLE</strong> (um
          dispositivo de áudio virtual gratuito).
        </p>
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
            <strong>Discord direto para o fone</strong>, como no passo 1 do Caso A. Depois,
            compartilhe a tela inteira com o áudio, como no passo 3.
          </li>
        </ol>

        <p>
          <strong>Teste (nos dois casos):</strong> no Discord, em Voz e vídeo, ligue o{' '}
          <em>Teste de microfone</em> (ele devolve a sua voz no fone) e veja pelo celular, ou peça a
          um amigo para falar. Quem assiste deve ouvir o vídeo e <strong>não</strong> a voz da call.
        </p>

        <details>
          <summary>Dicas e limitações</summary>
          <ul>
            <li>
              Tudo que toca no dispositivo padrão entra no stream (Spotify, notificações...). Para
              tirar um programa do stream, mande-o direto ao fone: Configurações → Sistema → Som →{' '}
              <em>Mixer de volume</em> (ou <em>Preferências de volume do aplicativo</em>) → Saída do
              programa = o seu fone real.
            </li>
            <li>
              No Caso B o volume do Windows passa a controlar o que vai no stream: deixe em 100% e
              ajuste pelo fone ou pelo Discord.
            </li>
            <li>
              O FxSound não deixa escolher o CABLE como padrão: quem usa FxSound segue o Caso A e
              não precisa do VB-CABLE.
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
              Confira se o dispositivo padrão do Windows é <strong>diferente</strong> do que o
              Discord usa (veja o aviso no topo).
            </li>
            <li>
              Confira se a saída do Discord <strong>não</strong> está em “Padrão” nem no
              FxSound/CABLE, e reinicie o Discord depois de trocar.
            </li>
            <li>
              Abra o <em>Mixer de volume</em> (clique direito no ícone de som) com o Discord
              falando: a barra dele deve estar sob o seu fone real.
            </li>
            <li>
              Confirme que escolheu <em>Tela inteira</em> e marcou{' '}
              <em>Compartilhar áudio do sistema</em> no seletor.
            </li>
            <li>Se continuar, compartilhe uma aba do navegador em vez da tela.</li>
          </ul>
        </details>

        <details>
          <summary>Como desfazer (Caso B)</summary>
          <ul>
            <li>Volte a saída padrão do Windows para o seu fone ou alto-falante.</li>
            <li>
              Em <code>mmsys.cpl</code> → Gravação → CABLE Output → Escutar, desmarque{' '}
              <em>Ouvir este dispositivo</em>.
            </li>
            <li>No Discord, volte a saída para “Padrão”.</li>
            <li>
              Se quiser, desinstale o VB-CABLE em Configurações → Aplicativos (“VBCABLE, The Virtual
              Audio Cable”) e reinicie.
            </li>
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
