# Compartilhar áudio sem eco quando você está numa call (Discord)

Guia para **Windows 10/11** com **Chrome ou Edge**. O mesmo texto aparece dentro do app, na janela
que abre ao marcar "Áudio do sistema".

## O problema

O "áudio do sistema" que o navegador captura é o que toca no **dispositivo padrão** do Windows. Se a
voz dos seus amigos (Discord) sair por ele, ela entra no stream, e quem assiste ouve a própria fala
de volta, atrasada. Para o Discord ficar de fora, ele precisa sair por **outro** dispositivo.

> **Atenção:** mandar o Discord "para o fone" só adianta se o dispositivo padrão do Windows for
> **outro** (como o FxSound ou o VB-CABLE). Se o padrão já é o seu fone, os dois saem pelo mesmo
> lugar e a voz continua indo para o stream.

```
Jogo / vídeo ──► dispositivo padrão (virtual) ──┬──► navegador captura (stream)
                                                └──► seu fone
Discord (amigos) ───────────────────────────────► seu fone (direto, fora do stream)
```

## Qual é o seu caso?

Clique no ícone de som da barra de tarefas: o dispositivo mostrado é o **padrão**.

- Se for **virtual** (FxSound Audio Enhancer, CABLE Input, Voicemeeter...): **Caso A**.
- Se for o **seu fone ou alto-falante** de verdade: **Caso B**.

## Caso A: o padrão já é virtual (FxSound, CABLE, Voicemeeter)

Não precisa instalar nada. Vale para quem usa o **FxSound**, que já se coloca como dispositivo
padrão.

1. **Mande o Discord direto para o fone.** Configurações de usuário → **Voz e vídeo** →
   **Dispositivo de saída** = o seu fone real (**não** "Padrão" e não o FxSound). Se o Discord já
   estava aberto, feche e abra de novo.
2. **Deixe a saída padrão do Windows como está** (FxSound ligado, por exemplo). O equalizador
   continua valendo para o som do jogo/vídeo; a voz do Discord vai direto ao fone, sem passar por
   ele.
3. **Compartilhe a tela inteira.** No app, com "Áudio do sistema" marcado, clique em **Compartilhar
   tela**. No seletor do navegador, escolha a aba **Tela inteira** e marque **Compartilhar áudio do
   sistema**.

## Caso B: o padrão é o seu fone (Windows comum)

Aqui é preciso criar o dispositivo padrão separado, com o **VB-CABLE**, um dispositivo de áudio
virtual gratuito.

1. Baixe o **VB-CABLE Driver Pack** em <https://vb-audio.com/Cable/>, execute
   `VBCABLE_Setup_x64.exe` **como administrador** e **reinicie** o PC.
2. Saída padrão do Windows = **CABLE Input** (Configurações → Sistema → Som → Saída). Você fica sem
   som até o próximo passo.
3. `Win + R` → `mmsys.cpl` → aba **Gravação** → dois cliques em **CABLE Output** → aba **Escutar** →
   marque **Ouvir este dispositivo** e escolha o seu fone real em "Reproduzir através deste
   dispositivo".
4. **Discord direto para o fone** (passo 1 do Caso A) e compartilhe a tela inteira com o áudio
   (passo 3 do Caso A).

## Teste (nos dois casos)

No Discord, em Voz e vídeo, ligue o **Teste de microfone** (ele devolve a sua voz no fone) e veja
pelo celular, ou peça a um amigo para falar. Quem assiste deve ouvir o vídeo e **não** a voz da call.

## Dicas e limitações

- **Tudo que toca no dispositivo padrão entra no stream** (Spotify, notificações...). Para tirar um
  programa do stream, mande-o direto ao fone: Configurações → Sistema → Som → **Mixer de volume** (ou
  **Preferências de volume do aplicativo**) → Saída do programa = o seu fone real.
- **No Caso B** o volume do Windows passa a controlar o que vai no stream: deixe em 100% e ajuste
  pelo fone ou pelo Discord.
- **FxSound e VB-CABLE não convivem como padrão:** o FxSound impede trocar o dispositivo padrão. Quem
  usa FxSound segue o Caso A e não precisa do VB-CABLE.
- **Janela x tela inteira:** no Windows, o Chrome/Edge normalmente só oferece áudio do sistema ao
  compartilhar a **tela inteira**. Ao compartilhar uma única janela, costuma não haver opção de áudio.
- **Só quer mostrar algo do navegador** (YouTube, filme, streaming)? Compartilhe uma **aba**: o
  navegador captura só o áudio dela, e nada disso é necessário.
- **Seu microfone não é compartilhado** pelo app: só o áudio do sistema, e só se você marcar a opção.

## Ainda ouvem eco?

1. Confira se o dispositivo padrão do Windows é **diferente** do que o Discord usa (veja o aviso no
   topo).
2. Confira se a saída do Discord **não** está em "Padrão" nem no FxSound/CABLE, e reinicie o Discord
   depois de trocar.
3. Abra o **Mixer de volume** (clique direito no ícone de som) com o Discord falando: a barra dele
   deve estar sob o seu fone real.
4. Confirme que escolheu **Tela inteira** e marcou **Compartilhar áudio do sistema** no seletor.
5. Se continuar, compartilhe uma **aba** do navegador em vez da tela.

## Como desfazer (Caso B)

1. Volte a saída padrão do Windows ao seu fone ou alto-falante.
2. Em `mmsys.cpl` → Gravação → CABLE Output → Escutar, desmarque **Ouvir este dispositivo**.
3. No Discord, volte a saída para "Padrão".
4. Se quiser, desinstale em Configurações → Aplicativos → "VBCABLE, The Virtual Audio Cable" (botão
   **Remove Driver**) e reinicie.
