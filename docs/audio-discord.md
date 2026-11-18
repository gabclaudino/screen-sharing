# Compartilhar áudio sem eco quando você está numa call (Discord)

Guia para **Windows 10/11** com **Chrome ou Edge**.

## O problema

O “áudio do sistema” que o navegador captura é **tudo o que toca no seu PC**, inclusive a voz dos
seus amigos vindo do Discord. Essa voz entra no stream, e quem assiste ouve a própria fala de volta,
atrasada. O navegador não consegue separar um programa do resto.

## A solução: tirar o Discord do áudio que é capturado

Usamos o **VB-CABLE**, um dispositivo de áudio virtual gratuito. Ele vira a “saída padrão” do
Windows, e o Discord é mandado direto para o seu fone, por fora dele:

```
Jogo / vídeo / música ──► CABLE Input (saída padrão) ──┬──► Chrome captura (vai para o stream)
                                                       └──► "Ouvir este dispositivo" ──► seu fone

Discord (voz dos amigos) ───────────────────────────────────► seu fone (direto, não é capturado)
```

Resultado: o stream leva o som do jogo/vídeo, e **não** leva a voz dos amigos. Você continua ouvindo
tudo normalmente.

## Passo a passo

### 1. Instalar o VB-CABLE

1. Baixe o **VB-CABLE Driver Pack** em <https://vb-audio.com/Cable/> (gratuito; é “donationware”).
2. Extraia o zip, clique com o botão direito em `VBCABLE_Setup_x64.exe` e escolha **Executar como
   administrador**, depois **Install Driver**.
3. **Reinicie o PC.**

### 2. Definir o CABLE como saída padrão

- **Windows 11:** Configurações → Sistema → Som → **Saída** → selecione **CABLE Input (VB-Audio
  Virtual Cable)**.
- **Windows 10:** Configurações → Sistema → Som → em “Escolha seu dispositivo de saída”, selecione
  **CABLE Input (VB-Audio Virtual Cable)**.

> Daqui até o passo 3 você **não vai ouvir nada**. É normal: o som está indo para o cabo virtual.

### 3. Ouvir o cabo no seu fone

1. Pressione `Win + R`, digite `mmsys.cpl` e dê Enter.
2. Abra a aba **Gravação**.
3. Dê dois cliques em **CABLE Output** para abrir as propriedades.
4. Vá na aba **Escutar**.
5. Marque **Ouvir este dispositivo**.
6. Em **Reproduzir através deste dispositivo**, escolha o seu **fone ou alto-falante real**.
7. Clique em **Aplicar** e **OK**. Você volta a ouvir o som do PC.

### 4. Mandar o Discord direto para o fone

1. No Discord: Configurações de usuário → **Voz e vídeo**.
2. Em **Dispositivo de saída**, escolha o seu **fone real**. **Não deixe em “Padrão”**, porque o
   “Padrão” agora é o CABLE.
3. O **microfone (entrada)** não muda.

Se o Discord já estava aberto, feche e abra de novo para ele assumir a nova saída.

### 5. Compartilhar no ScreenShare

1. Marque **Áudio do sistema**.
2. Clique em **Compartilhar tela**.
3. No seletor do navegador, escolha a aba **Tela inteira** e marque **Compartilhar áudio do
   sistema** (canto inferior esquerdo da janela).

### 6. Testar

Peça a um amigo para assistir enquanto outro fala no Discord e você toca um vídeo:

- ele deve ouvir o vídeo;
- ele **não** deve ouvir a própria voz (nem a de ninguém da call) no stream.

## Dicas e limitações

- **Volume:** o volume do Windows agora controla o volume do CABLE, ou seja, também o que vai no
  stream. Deixe-o em **100%** e ajuste o volume no próprio fone ou no Discord.
- **Tudo, menos o Discord, entra no stream:** Spotify, notificações do Windows, outros programas. Feche
  o que você não quer expor.
- **Latência:** “Ouvir este dispositivo” soma algumas dezenas de milissegundos no que você ouve. Em
  geral não se nota.
- **Janela x tela inteira:** no Windows, o Chrome/Edge normalmente só oferece áudio do sistema ao
  compartilhar a **tela inteira**. Ao compartilhar uma única janela, costuma não haver opção de
  áudio.
- **Só quer mostrar algo que roda no navegador** (YouTube, filme, streaming)? Compartilhe uma **aba**
  em vez da tela. O navegador captura só o áudio daquela aba, então nada disso é necessário.
- **Seu microfone não é compartilhado** pelo app: só o áudio do sistema, e só se você marcar a opção.

## Ainda ouvem eco?

1. Confira se a saída do Discord **não** está em “Padrão”.
2. Abra o **mixer de volume** (clique direito no ícone de som → “Abrir o Mixer de volume”) com o
   Discord falando: a barra dele deve estar sob o seu fone real, não sob o CABLE.
3. Reinicie o Discord depois de mudar a saída.
4. Confirme que você escolheu **Tela inteira** e marcou **Compartilhar áudio do sistema** no seletor.

## Como desfazer

1. Volte a saída padrão do Windows para o seu fone ou alto-falante.
2. Em `mmsys.cpl` → Gravação → CABLE Output → Escutar, desmarque **Ouvir este dispositivo**.
3. No Discord, volte a saída para **Padrão**.

Se quiser, pode desinstalar o VB-CABLE depois pelo “Adicionar ou remover programas”.
