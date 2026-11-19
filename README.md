# ScreenShare Mesh

Compartilhamento de tela entre amigos, direto de navegador para navegador (WebRTC), numa **única
sala** protegida por uma senha. Custo ~zero e hospedado no seu próprio PC.

- **Uma pessoa compartilha por vez**; até 6 pessoas na sala.
- **Reações:** botões de emoji (😂 🔥 💀 👏 ❤️ 😮) que sobem pela tela de todo mundo.
- O servidor só repassa a sinalização: **o vídeo nunca passa por ele**.
- Conexão direta (P2P) quando possível; **relay TURN** (Cloudflare) para quem está em 4G/5G, empresa
  ou faculdade.
- HTTPS pelo **Cloudflare Tunnel**: nenhuma porta é aberta no roteador.

> Não faz parte do escopo: gravação, chat, contas de usuário, mais de ~6 pessoas, SFU. Celulares só
> assistem (iOS não consegue compartilhar a tela).

## Sumário

1. [Requisitos](#1-requisitos)
2. [Instalação e desenvolvimento](#2-instalação-e-desenvolvimento)
3. [Configuração (`.env`)](#3-configuração-env)
4. [Rodar em produção na sua máquina](#4-rodar-em-produção-na-sua-máquina)
5. [Publicar na internet (Cloudflare Tunnel)](#5-publicar-na-internet-cloudflare-tunnel)
6. [Ligar e desligar o servidor](#6-ligar-e-desligar-o-servidor)
7. [Relay TURN (4G, empresa, faculdade)](#7-relay-turn-4g-empresa-faculdade)
8. [Áudio do sistema sem eco (Discord)](#8-áudio-do-sistema-sem-eco-discord)
9. [Checklist de testes manuais](#9-checklist-de-testes-manuais)
10. [Solução de problemas](#10-solução-de-problemas)
11. [Segurança](#11-segurança)
12. [Estrutura do projeto e comandos](#12-estrutura-do-projeto-e-comandos)

---

## 1. Requisitos

- **Node.js 20.6 ou mais novo** (desenvolvido e testado no 22). O servidor lê o `.env` com a opção
  nativa `--env-file`.
- **Windows** (as instruções de serviço abaixo são para Windows; o app em si roda em qualquer SO).
- Navegador para **compartilhar**: Chrome ou Edge no desktop. Firefox e Safari compartilham vídeo,
  mas o **áudio do sistema só existe no Chrome/Edge (Windows)**. Quem só assiste pode usar qualquer
  navegador recente, inclusive no celular.
- Uma conta gratuita no Cloudflare e, para o endereço fixo, um domínio (seção 5).

> **Dica:** mantenha o projeto **fora do OneDrive** (por exemplo `C:\apps\screenshare`). A pasta
> `node_modules` tem milhares de arquivos que o OneDrive tenta sincronizar, e programas rodando em
> segundo plano nem sempre enxergam arquivos que ele "liberou" só na nuvem.

## 2. Instalação e desenvolvimento

```powershell
npm install
copy .env.example .env
```

Edite o `.env` (seção 3). Para desenvolver:

```powershell
npm run dev
```

Isso sobe dois servidores:

| Endereço                | O que é                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `http://localhost:5173` | Vite, com atualização instantânea ao editar o código               |
| `http://localhost:3000` | O servidor do app (API, WebSocket e o build compilado, se existir) |

Use o `:5173` enquanto edita. O `:3000` serve a pasta `packages/web/dist`, que só muda com
`npm run build`.

Em `localhost` o navegador libera o compartilhamento de tela mesmo sem HTTPS. **Em outros
endereços (por exemplo `http://192.168.0.10:3000` no celular) ele não libera**: para testar com
outros dispositivos use o domínio com HTTPS (seção 5).

## 3. Configuração (`.env`)

O servidor **recusa subir** com valores de exemplo ou inválidos e diz exatamente o que corrigir.

Gere um segredo de sessão com:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variável                    | Padrão              | Descrição                                                                                                                                                                                                                  |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`        | `production` ou `development`. Em `development` o servidor também aceita a origem do Vite (`:5173`).                                                                                                                       |
| `HOST`                      | `127.0.0.1`         | Onde o servidor escuta. **Deixe assim**: só o `cloudflared` (na mesma máquina) precisa alcançá-lo.                                                                                                                         |
| `PORT`                      | `3000`              | Porta do servidor.                                                                                                                                                                                                         |
| `ALLOWED_ORIGIN`            | (obrigatória)       | O endereço público exato, sem barra final: `https://share.seudominio.com`. Em teste local: `http://localhost:3000`.                                                                                                        |
| `ACCESS_PASSWORD`           | (obrigatória)       | **A senha que você compartilha com os amigos.** Mínimo 8 caracteres.                                                                                                                                                       |
| `SESSION_SECRET`            | (obrigatória)       | Segredo que assina os tokens de login. Mínimo 32 caracteres, aleatório.                                                                                                                                                    |
| `SESSION_TTL_HOURS`         | `12`                | Por quanto tempo o login vale **enquanto você está dentro da sala** (serve só para reconectar após uma queda de rede). Para entrar na sala a senha é **sempre** pedida: ao sair ou recarregar a página, digita-se de novo. |
| `MAX_PEERS_PER_ROOM`        | `6`                 | Máximo de pessoas na sala.                                                                                                                                                                                                 |
| `LOGIN_RATE_MAX`            | `10`                | Tentativas de login por IP em cada janela.                                                                                                                                                                                 |
| `LOGIN_RATE_WINDOW_MIN`     | `10`                | Duração da janela, em minutos.                                                                                                                                                                                             |
| `WS_MSG_RATE_PER_SEC`       | `50`                | Mensagens por segundo permitidas por conexão.                                                                                                                                                                              |
| `STATIC_DIR`                | `packages/web/dist` | Onde está o front compilado (relativo à raiz do projeto).                                                                                                                                                                  |
| `ICE_PROVIDER`              | `none`              | `cloudflare`, `metered` ou `none` (só STUN: não funciona para quem está em 4G ou rede restrita).                                                                                                                           |
| `ICE_CREDENTIAL_TTL_SEC`    | `86400`             | Validade das credenciais TURN. **Precisa ser maior que a sessão mais longa** (o Cloudflare aceita até 48 h).                                                                                                               |
| `CLOUDFLARE_TURN_KEY_ID`    | —                   | Obrigatória se `ICE_PROVIDER=cloudflare` (seção 7).                                                                                                                                                                        |
| `CLOUDFLARE_TURN_API_TOKEN` | —                   | Obrigatória se `ICE_PROVIDER=cloudflare`.                                                                                                                                                                                  |
| `METERED_APP_NAME`          | —                   | Obrigatória se `ICE_PROVIDER=metered`.                                                                                                                                                                                     |
| `REACTION_EMOJIS`           | 😂 🔥 💀 👏 ❤️ 😮   | **Emojis dos botões de reação**, separados por espaço ou vírgula (1 a 12, um emoji cada). Reinicie o servidor para valer.                                                                                                  |
| `NAME_ALIASES`              | (vazio)             | **Apelidos forçados pelo servidor**, em JSON: `{"nome digitado":"nome exibido"}`. Veja abaixo.                                                                                                                             |
| `METERED_API_KEY`           | —                   | Obrigatória se `ICE_PROVIDER=metered`.                                                                                                                                                                                     |

**Apelidos (`NAME_ALIASES`).** Quem entra com um dos nomes configurados aparece para **todos** (e para si mesmo) com o apelido. A comparação ignora maiúsculas, acentos, espaços e `_` `-` `.`, então `Stan God`, `STAN_GOD` e `stangod` valem o mesmo nome, mas só a igualdade exata conta (`stanley` não vira o apelido de `stan`). Se duas pessoas caírem no mesmo apelido, a segunda recebe "nome já em uso". Exemplo no `.env`:

```env
NAME_ALIASES='{"fulano":"Apelido","fulano2":"Apelido"}'
```

Por ficar no `.env`, os nomes e apelidos **não vão para o repositório público**. Depois de mudar, reinicie o servidor (`DESLIGAR.bat` e `LIGAR.bat`).

> O arquivo `.env` **nunca** deve ir para o git (já está no `.gitignore`).

## 4. Rodar em produção na sua máquina

```powershell
npm run build
npm start
```

Tudo sobe **numa porta só** (a `PORT`, padrão 3000): o site, a API (`/api/login`, `/api/ice`) e o
WebSocket (`/ws`). Abra `http://localhost:3000` para conferir.

O servidor executa direto do TypeScript (via `tsx`), então não há etapa de compilação do servidor:
só o front precisa de `npm run build`. **Depois de mexer no front, rode o build de novo.**

## 5. Publicar na internet (Cloudflare Tunnel)

O Cloudflare Tunnel liga o seu PC à internet **sem abrir portas no roteador** e entrega HTTPS pronto.
O programa `cloudflared`, instalado no seu PC, faz uma conexão de saída até o Cloudflare e recebe por
ela os acessos ao seu domínio.

```
Navegador ──HTTPS/WSS──► Cloudflare ──(túnel)──► cloudflared ──► http://localhost:3000 (este app)
```

> O Tunnel só transporta HTTP e WebSocket. **Não** transporta o vídeo (UDP): ele vai direto entre os
> navegadores, ou pelo TURN (seção 7).

### 5.1 Testar rápido, sem domínio (URL temporária)

Serve para experimentar com os amigos antes de comprar um domínio. **Não é para uso contínuo**: a URL
muda a cada execução.

1. Instale o `cloudflared`: `winget install --id Cloudflare.cloudflared` (ou baixe em
   <https://github.com/cloudflare/cloudflared/releases>) e abra um terminal novo.
2. Com o app rodando (`npm start`), em outro terminal:

   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

3. Ele imprime uma URL `https://alguma-coisa.trycloudflare.com`. **Coloque exatamente essa origem em
   `ALLOWED_ORIGIN` no `.env` e reinicie o servidor** (senão o login e o WebSocket são recusados com
   403). A cada nova execução do `cloudflared` a URL muda, e é preciso repetir isso.

### 5.2 Endereço fixo, passo a passo

#### a) Conseguir um domínio

Você precisa ter um domínio para o endereço fixo (por exemplo `share.seudominio.com`). O caminho mais
simples é **registrar pelo próprio Cloudflare**, que cobra o preço de custo do registro, sem margem:

1. Crie a conta gratuita em <https://dash.cloudflare.com/sign-up> e confirme o e-mail.
2. No painel: **Domain Registration → Register Domains**, procure um nome, adicione ao carrinho e
   finalize. Confira no checkout o preço de **registro e de renovação** (a renovação de algumas
   extensões custa mais que o primeiro ano).
3. Domínio comprado no Cloudflare já fica configurado nele: não é preciso mexer em nameservers.

Já tem um domínio em outro registrador? No painel, **Add a domain** e siga o assistente, que no fim
pede para trocar os _nameservers_ no registrador pelos que o Cloudflare indicar. A propagação pode levar
de minutos a algumas horas.

O subdomínio (`share`, por exemplo) **não precisa ser criado antes**: o Cloudflare cria o registro DNS
quando você publica o tunnel.

#### b) Criar o tunnel pelo painel (recomendado no Windows)

1. No painel do Cloudflare, abra **Networking → Tunnels → Create a tunnel**, escolha o conector
   **Cloudflared** e dê um nome (por exemplo `screenshare`). O Cloudflare pode pedir um método de
   pagamento ao ativar o produto; o plano gratuito do Tunnel não é cobrado.
2. Na tela seguinte, escolha **Windows** e copie o comando de instalação que ele mostra. Ele traz um
   **token** (a parte que começa com `eyJ…`). **Trate esse token como uma senha**: não o envie nem o
   versione.
3. Abra o **PowerShell como administrador** e rode o comando (a forma é esta, com o seu token):

   ```powershell
   cloudflared.exe service install <TOKEN>
   ```

   Isso instala o `cloudflared` como **serviço do Windows**: ele sobe sozinho com o PC e reconecta se
   a rede cair. O `cloudflared` não precisa de mais nada (a seção 6 trata só do servidor do app).

4. De volta ao painel, adicione a rota pública (**Published application** / _Public hostname_):
   - **Subdomain:** `share` (ou o que preferir) e **Domain:** o seu domínio;
   - **Service:** tipo `HTTP`, endereço `localhost:3000` (`http://localhost:3000`).

   O Cloudflare cria o registro DNS sozinho.

5. Se a sua rede for muito restritiva, o `cloudflared` precisa alcançar o Cloudflare na porta de
   saída **7844**.

#### c) Ajustar o `.env` e subir

```env
NODE_ENV=production
ALLOWED_ORIGIN=https://share.seudominio.com
ACCESS_PASSWORD=<a senha que você vai passar aos amigos>
SESSION_SECRET=<o segredo aleatório de 64 caracteres>
```

```powershell
npm run build
npm start
```

Abra `https://share.seudominio.com`: deve aparecer o formulário (nome e senha). WebSocket funciona por
padrão no tunnel.

> Trocou `ACCESS_PASSWORD` ou `SESSION_SECRET`? Reinicie o servidor. A troca do `SESSION_SECRET`
> invalida os logins existentes (todos precisam entrar de novo).

#### Alternativa: tunnel com arquivo de configuração (CLI)

Se preferir gerenciar o tunnel por linha de comando em vez do painel:

```powershell
cloudflared tunnel login                                   # abre o navegador para autorizar o domínio
cloudflared tunnel create screenshare                      # gera o arquivo de credenciais (.json)
cloudflared tunnel route dns screenshare share.seudominio.com
copy cloudflared\config.example.yml cloudflared\config.yml # edite: tunnel, credentials-file, hostname
cloudflared tunnel --config cloudflared\config.yml run screenshare
```

Para rodar como serviço do Windows nesse modo, siga o guia oficial
([Run as a service on Windows](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/)):
o serviço roda como conta do sistema, então ele precisa dos arquivos de credenciais e do `cert.pem` na
pasta `.cloudflared` dessa conta. **Não misture** os dois métodos (painel com token e arquivo de
configuração) no mesmo tunnel. O arquivo `<TUNNEL_ID>.json` é secreto e já está no `.gitignore`.

## 6. Ligar e desligar o servidor

Como o app só é usado **na hora de compartilhar a tela**, ele não precisa ficar ligado o tempo todo.
Na pasta do projeto há três atalhos de **duplo clique**:

| Arquivo        | O que faz                                                                             |
| -------------- | ------------------------------------------------------------------------------------- |
| `LIGAR.bat`    | Liga o servidor e abre o navegador no endereço do app.                                |
| `DESLIGAR.bat` | Desliga o servidor. Quem estava na sala é desconectado.                               |
| `STATUS.bat`   | Mostra se o servidor está ligado, o endereço e se o túnel do Cloudflare está rodando. |

O que o `LIGAR.bat` faz por você:

- confere o `.env` e se o Node está instalado;
- **atualiza o site (build) sozinho se você mexeu no código** desde a última vez, então depois de
  editar o front basta desligar e ligar de novo;
- avisa se a porta já está em uso por **outro programa** (e nesse caso não mexe nele; o
  `DESLIGAR.bat` também só encerra o servidor deste projeto);
- espera o servidor subir e mostra o endereço. Os eventos ficam em `logs\server.log` (só entradas,
  saídas e erros, **nunca** o conteúdo da sinalização).

Dicas:

- **Atalho na área de trabalho:** clique com o botão direito em `LIGAR.bat` → _Mostrar mais opções_ →
  _Enviar para_ → _Área de trabalho (criar atalho)_. Faça o mesmo com o `DESLIGAR.bat`.
- **O túnel continua ligado**, como serviço do Windows (seção 5.2b), e gasta quase nada. Com o app
  desligado, quem abrir o endereço vê uma página de erro **502** do Cloudflare: é o esperado. Se quiser
  desligar o túnel também (PowerShell como administrador): `Stop-Service cloudflared`, e
  `Start-Service cloudflared` para religar.
- **Enquanto compartilha, o PC não pode suspender.** Para impedir a suspensão na tomada:
  `powercfg /change standby-timeout-ac 0` (e para voltar ao normal, o tempo que você quiser, em minutos).
- **Pelo terminal:** os atalhos chamam `powershell -File scripts\servidor.ps1 ligar|desligar|status`
  (`-SemNavegador` liga sem abrir o navegador).

### Opcional: ligar sozinho quando o Windows iniciar

Só faz sentido se você quiser o site sempre no ar. Esta tarefa agendada roda o servidor sempre que você
fizer login e tenta de novo (até 5 vezes, a cada minuto) se ele cair. Ajuste o caminho e rode no
PowerShell:

```powershell
$projeto = "C:\apps\tela-dos-guri"
New-Item -ItemType Directory -Force "$projeto\logs" | Out-Null

$acao = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -Command `"Set-Location '$projeto'; npm start *>> logs\server.log`""
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$config = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName "Tela dos Guri" -Action $acao -Trigger $gatilho -Settings $config
Start-ScheduledTask -TaskName "Tela dos Guri"
```

Para remover: `Unregister-ScheduledTask -TaskName "Tela dos Guri" -Confirm:$false`.

> A tarefa roda **como você** (não como SYSTEM): assim ela enxerga as suas variáveis de ambiente, como a
> `NODE_EXTRA_CA_CERTS` da seção 10. Os atalhos `LIGAR.bat`/`DESLIGAR.bat` também herdam as suas
> variáveis de ambiente.

## 7. Relay TURN (4G, empresa, faculdade)

Sem o TURN, só funciona quem está numa rede que permite conexão direta entre os navegadores. Quem está
em **4G/5G, rede de empresa/faculdade ou atrás de CGNAT** precisa do relay.

1. Crie a conta no Cloudflare (seção 5.2a).
2. No painel: **Realtime → TURN Server** e ative o serviço. **O Cloudflare pede um cartão para ativar.**
   Pela tela de ativação: nada é cobrado agora (US$ 0/mês) e há **1.000 GB por mês incluídos** (o
   excedente custa US$ 0,05 por GB). Um espectador em relay a 2,5 Mbps consome cerca de 1,1 GB por
   hora, e só quem não consegue conexão direta usa o relay.
3. Crie uma **TURN key** e anote o **Key ID** e o **API Token** (o token costuma aparecer uma só vez).
4. No `.env`:

   ```env
   ICE_PROVIDER=cloudflare
   CLOUDFLARE_TURN_KEY_ID=<Key ID>
   CLOUDFLARE_TURN_API_TOKEN=<API Token>
   ICE_CREDENTIAL_TTL_SEC=86400
   ```

5. Reinicie o servidor e confira: a tela mostra um badge **"via relay (TURN)"** ao lado de quem está
   conectado por relay.

Sugestões para não ter surpresa: use uma **senha de acesso forte** (ela é a única barreira para o
`/api/ice`, que entrega as credenciais do relay) e, se o painel oferecer, crie um alerta de uso/cobrança.

> `ICE_PROVIDER=metered` também é suportado (`METERED_APP_NAME` e `METERED_API_KEY`).

Sem TURN configurado, o app funciona entre redes comuns e avisa na tela quando não consegue obter os
servidores de relay.

## 8. Áudio do sistema sem eco (Discord)

O "áudio do sistema" leva o que toca no **dispositivo padrão** do Windows. Se a voz dos amigos no Discord
sair pelo mesmo caminho, quem assiste ouve a própria voz de volta. A opção "Áudio do sistema" vem
**desligada** por padrão e, ao ligá-la, o app abre um **guia passo a passo** que também pode ser reaberto
pelo link "Ver guia para evitar o eco". A versão escrita está em
[`docs/audio-discord.md`](docs/audio-discord.md).

**A regra:** o que sai pelo dispositivo padrão é compartilhado, então o Discord precisa sair por **outro**
dispositivo. Mandar o Discord "para o fone" **só adianta se o dispositivo padrão do Windows não for o
próprio fone**. O que fazer depende do seu caso (clique no ícone de som da barra de tarefas: o dispositivo
mostrado é o padrão):

- **Caso A, o padrão já é virtual (FxSound, CABLE, Voicemeeter):** não precisa instalar nada. Deixe-o
  como padrão e configure o Discord com saída direto no seu fone real (Voz e vídeo → Dispositivo de
  saída). Quem usa **FxSound** cai aqui.
- **Caso B, o padrão é o seu fone (Windows comum):** é preciso criar um dispositivo padrão separado com
  o **VB-CABLE** (passo a passo no guia). O VB-CABLE **não convive** com o FxSound, que impede trocar o
  dispositivo padrão.
- Sem configurar nada: compartilhe uma **aba** do Chrome/Edge em vez da tela. O navegador captura só o
  áudio daquela aba.

## 9. Checklist de testes manuais

Faça depois de publicar. Os itens com 📱 precisam de um segundo dispositivo.

- [ ] Abrir `https://share.seudominio.com`, entrar com nome e senha, e ver a sala vazia.
- [ ] Senha errada mostra "Senha incorreta"; nome repetido mostra o aviso de nome em uso.
- [ ] **2 abas** na mesma máquina: uma compartilha a tela, a outra vê (badge "direto (P2P)").
- [ ] 📱 Outro dispositivo na **mesma rede** (pelo domínio com HTTPS, nunca por `http://IP`).
- [ ] 📱 Celular em **4G** (Wi-Fi desligado): vê a tela e o badge mostra **"via relay (TURN)"**.
- [ ] Parar o compartilhamento pelo **botão nativo do navegador** ("Parar compartilhamento"): a outra
      pessoa vê a tela sumir e a vez fica livre.
- [ ] Entrar na sala **depois** de alguém já estar compartilhando e ver a tela.
- [ ] Com alguém compartilhando, o botão dos outros fica bloqueado com "Fulano está compartilhando".
- [ ] Fechar a aba e reabrir; desligar o Wi-Fi por alguns segundos e religar: a sala reconecta sozinha.
- [ ] Reiniciar o servidor: os clientes reconectam sozinhos.
- [ ] Clique direito na transmissão: silenciar e volume (arrastando); ícone de tela cheia e de sair.
- [ ] Áudio do sistema ligado, com a call do Discord configurada pelo guia: quem assiste **não** ouve a
      própria voz.
- [ ] 4 pessoas: um compartilha, e ao parar, outro assume a vez.

## 10. Solução de problemas

| Sintoma                                                                            | Causa provável e o que fazer                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O servidor não sobe e lista variáveis                                              | O `.env` está incompleto ou com valor de exemplo. Leia a mensagem: ela diz qual variável corrigir.                                                                                                                                                                                                                                                                                                               |
| `ERR_CONNECTION_REFUSED` em `localhost:5173` ou `:3000`                            | O servidor não está rodando. Rode `npm run dev` (ou `npm start`) e espere a linha `listening`.                                                                                                                                                                                                                                                                                                                   |
| Login ou conexão falham no endereço público ("403")                                | `ALLOWED_ORIGIN` não é **exatamente** o endereço que você abriu (esquema, domínio, sem barra final). Corrija e reinicie.                                                                                                                                                                                                                                                                                         |
| "Sua sessão expirou" ao voltar                                                     | O login vale `SESSION_TTL_HOURS`, ou o `SESSION_SECRET` mudou. Entre de novo com a senha.                                                                                                                                                                                                                                                                                                                        |
| Não consigo compartilhar a tela em outro dispositivo                               | O navegador só libera o compartilhamento em HTTPS ou `localhost`. Use o domínio com HTTPS.                                                                                                                                                                                                                                                                                                                       |
| Só aparece "direto (P2P)" e quem está em 4G não conecta                            | TURN não configurado ou fora do ar. Confira a seção 7 e o aviso "Não foi possível obter os servidores de relay".                                                                                                                                                                                                                                                                                                 |
| Nos logs: `ice_provider_failed`, com `"cause":"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"` | Um **antivírus que inspeciona o HTTPS** (como o AVG) usa um certificado próprio que o Node não conhece. Aponte a variável de ambiente `NODE_EXTRA_CA_CERTS` para o certificado do antivírus (`setx NODE_EXTRA_CA_CERTS "C:\caminho\certificado.pem"`), **faça logout/login** e reinicie o servidor. O mesmo problema causa o erro de SSL do `git push` (`git config --global http.sslBackend schannel` resolve). |
| `EADDRINUSE` / porta ocupada                                                       | Já há um servidor rodando na porta. Encerre o processo `node` antigo ou mude a `PORT` (e a rota pública no Cloudflare).                                                                                                                                                                                                                                                                                          |
| Compartilhar a tela deixa um "espelho infinito"                                    | Você está compartilhando a tela inteira com a prévia ("Ver minha tela") ligada. Desligue a prévia ou compartilhe uma janela/aba.                                                                                                                                                                                                                                                                                 |
| Quem assiste ouve a própria voz                                                    | O áudio do sistema inclui a call. Veja a seção 8.                                                                                                                                                                                                                                                                                                                                                                |
| Sem som ao assistir                                                                | O navegador pode ter bloqueado o autoplay com som: clique em "Ativar som" no vídeo. Confira também o volume/silenciar (clique direito na transmissão).                                                                                                                                                                                                                                                           |

## 11. Segurança

- A **senha de acesso** é a única barreira: escolha uma forte e compartilhe só com os amigos. Para
  trocá-la, edite `ACCESS_PASSWORD` e reinicie.
- **Nunca versione** o `.env`, o token do tunnel, o arquivo `<TUNNEL_ID>.json` nem as chaves do TURN.
  Se algum vazar, gere outro (outro token do tunnel, outra TURN key) e troque.
- O servidor escuta só em `127.0.0.1`: o único caminho de fora é o `cloudflared`.
- Há limite de tentativas de login por IP, token de sessão assinado, verificação de origem no
  WebSocket, limite de conexões, cabeçalhos de segurança (CSP restritiva, HSTS em HTTPS, etc.).
- Os logs registram só eventos (entrou, saiu, erro), nunca o conteúdo da sinalização, que contém IPs.
- A sala vive só na memória: ao reiniciar o servidor ela volta vazia e os clientes reconectam.

## 12. Estrutura do projeto e comandos

```
packages/
  shared/   protocolo (schemas zod e tipos) usado pelo servidor e pelo front
  server/   Node: HTTP + WebSocket, login/token, sala, /api/ice, estáticos
  web/      React + Vite: formulário, sala, PeerManager (WebRTC mesh)
cloudflared/config.example.yml   exemplo de tunnel com arquivo de configuração
docs/audio-discord.md            guia do áudio sem eco
```

| Comando             | O que faz                                                  |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Servidor (`:3000`) + Vite (`:5173`) com recarga automática |
| `npm run build`     | Confere os tipos e compila o front em `packages/web/dist`  |
| `npm start`         | Sobe o servidor de produção (uma porta só)                 |
| `npm test`          | Testes (Vitest)                                            |
| `npm run typecheck` | `tsc --noEmit` em todos os pacotes                         |
| `npm run lint`      | ESLint                                                     |
| `npm run format`    | Prettier                                                   |

### Personalizar a tela de entrada

- O título ("Tela dos Guri") e a frase abaixo dele estão em `packages/web/src/components/JoinForm.tsx`; o título da aba do navegador, em `packages/web/index.html`.
- As **fotos do fundo** ficam em `packages/web/public/fotos/` (`guri-1.jpg` a `guri-6.jpg`, com o `guri-2` em `.webp`), e a posição de cada uma em `packages/web/src/styles.css` (`.bg-photo-1` a `.bg-photo-6`). Para trocar uma foto, substitua o arquivo (de preferência com no máximo ~400 px, para a página carregar rápido) e rode `npm run build`.
- **Essa pasta não vai para o git** (está no `.gitignore`), porque o repositório é público e as fotos são de pessoas. Num clone novo as fotos simplesmente não aparecem. Lembre que a tela de entrada é visível para **qualquer pessoa que souber o endereço**, mesmo sem a senha; o site pede aos buscadores para não indexá-lo (`noindex` e `robots.txt`).

A especificação completa do projeto está em [`SPEC.md`](SPEC.md).
