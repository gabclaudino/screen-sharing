# Projeto: ScreenShare Mesh (compartilhamento de tela entre amigos)

> Documento de especificação para execução em sessão do Claude Code. Implementar conforme as fases da seção 13. Não adicionar escopo além do descrito.

## 1. Objetivo

Aplicação web para um grupo pequeno de amigos (2–5 pessoas) compartilharem a tela em salas, estilo Google Meet, com custo ~zero e hospedada no PC do dono.

**Não-objetivos (v1):** gravação, chat, login com contas, escala acima de ~6 pessoas por sala, mobile como emissor de tela (iOS não suporta `getDisplayMedia`), SFU.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18+, TypeScript (strict), Vite |
| Backend | Node 20+, TypeScript, `ws` (WebSocket puro), `zod` para validação |
| Mídia | WebRTC, topologia **mesh** (P2P) |
| NAT traversal | STUN público + TURN (provedor gerenciado, ver seção 7) |
| HTTPS | Terminado pela Cloudflare via **Cloudflare Tunnel** (`cloudflared`) |
| Hospedagem | PC do dono, Node servindo estáticos + WebSocket na mesma origem |
| Pacotes | npm workspaces (monorepo) |

## 3. Arquitetura

```
Browser A ──┐                         ┌── Browser B
            │  WSS (sinalização)      │
            ▼                         ▼
     Cloudflare Edge ──(tunnel)──► cloudflared ──► Node (localhost:3000)
                                                    ├─ GET  /            (estáticos do React, fallback SPA)
                                                    ├─ POST /api/login   (senha → token de sessão)
                                                    ├─ GET  /api/ice     (iceServers + credenciais TURN; exige token)
                                                    └─ WS   /ws?token=   (sinalização; exige token)

Mídia: Browser A ◄══ WebRTC P2P (UDP, SRTP) ══► Browser B
                     (fallback: via TURN relay)
```

- O servidor **nunca** toca em mídia; só repassa mensagens de sinalização.
- Cloudflare Tunnel só proxia HTTP/WebSocket. **Não** transporta UDP do WebRTC nem do TURN. Por isso o TURN é um serviço externo (seção 7).
- Mesma origem para estáticos, API e WS: evita CORS e simplifica o tunnel.
- O servidor HTTP usa o módulo `node:http` (sem Express). Roteamento e servir estáticos (MIME types, fallback SPA para `index.html`, `Cache-Control` longo para assets com hash e `no-cache` para `index.html`, proteção contra path traversal) são implementados à mão em `static.ts`.
- O servidor escuta apenas em `127.0.0.1` (variável `HOST`); a única entrada externa é o `cloudflared`.
- **Requisito de contexto seguro:** `getDisplayMedia` só funciona em HTTPS ou `localhost`. Acessar por `http://<ip-da-lan>` não funciona para compartilhar; testes com outros dispositivos devem passar pelo tunnel.

## 4. Estrutura do repositório

A estrutura abaixo é criada **na raiz do repositório atual** (`tela-dos-guri`), sem subpasta `screenshare/`. Recomenda-se manter o projeto fora do OneDrive (ou excluir `node_modules` da sincronização), pois `node_modules` gera milhares de arquivos.

```
./
├─ package.json                # workspaces: ["packages/*"]
├─ tsconfig.base.json
├─ .env.example
├─ README.md
├─ cloudflared/
│  └─ config.example.yml
└─ packages/
   ├─ shared/                  # tipos e schemas zod do protocolo
   │  └─ src/protocol.ts
   ├─ server/
   │  └─ src/
   │     ├─ index.ts           # http + ws bootstrap
   │     ├─ config.ts          # leitura/validação de env
   │     ├─ rooms.ts           # estado das salas em memória
   │     ├─ signaling.ts       # handlers de mensagens
   │     ├─ ice.ts             # endpoint /api/ice
   │     ├─ static.ts          # servir estáticos do build (SPA)
   │     └─ security.ts        # origin check, rate limit, auth, headers
   └─ web/
      └─ src/
         ├─ main.tsx
         ├─ App.tsx
         ├─ lib/
         │  ├─ signaling-client.ts   # WS com reconexão + heartbeat
         │  ├─ peer-manager.ts       # gerencia RTCPeerConnections (mesh)
         │  └─ ice.ts                # busca iceServers
         ├─ hooks/
         │  ├─ useRoom.ts
         │  └─ useScreenShare.ts
         └─ components/
            ├─ JoinForm.tsx
            ├─ Room.tsx
            ├─ VideoTile.tsx
            └─ Controls.tsx
```

`PeerManager` é uma classe TS pura (sem React) para ser testável; os hooks apenas a conectam à UI.

## 5. Protocolo de sinalização

Mensagens JSON sobre WebSocket, definidas em `shared/src/protocol.ts` com schemas `zod` e tipos inferidos. Toda mensagem recebida pelo servidor é validada; inválida → fecha a conexão com código 1008.

A autenticação acontece **antes** do WS: o token do `/api/login` (seção 8) é validado no upgrade. Por isso o `join` **não carrega senha**.

Validação de campos: `room` casa `^[a-zA-Z0-9_-]{1,40}$` (case-sensitive); `name` tem 1–30 chars após `trim`, sem caracteres de controle.

**Cliente → Servidor**

| `type` | Campos | Descrição |
|---|---|---|
| `join` | `room`, `name`, `sharing?: boolean` | Entra na sala (cria se não existir). `sharing` é `true` ao reentrar após reconexão enquanto ainda compartilha |
| `signal` | `to`, `data` | Repassa a um peer: `{ gen: number, description?: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit, reset?: true }`. `sdp` limitado a 32 KB e `candidate` a 2 KB (validado no schema) |
| `sharing` | `active: boolean` | Informa que começou/parou de compartilhar |
| `ping` | — | Heartbeat |
| `leave` | — | Sai da sala |

**Servidor → Cliente**

| `type` | Campos | Descrição |
|---|---|---|
| `joined` | `selfId`, `peers: {id, name, sharing}[]` | Confirmação + lista de quem já está na sala |
| `peer-joined` | `peer: {id, name, sharing}` | Novo participante |
| `peer-left` | `id` | Participante saiu |
| `signal` | `from`, `data` | Repasse de sinalização |
| `peer-sharing` | `id`, `active` | Estado de compartilhamento de um peer |
| `error` | `code`, `message` | `ROOM_FULL`, `NAME_TAKEN`, `ALREADY_JOINED`, `RATE_LIMITED`, `INVALID` |
| `pong` | — | Resposta ao heartbeat |

Regras:
- Senha errada ou token ausente/expirado **não** gera mensagem WS: o upgrade é recusado com HTTP 401 e o cliente, que não enxerga o corpo da resposta de um upgrade falho, trata a falha de conexão tentando `POST /api/login` de novo (ver seção 9).
- Após `error` com `ROOM_FULL` ou `NAME_TAKEN` o servidor mantém a conexão aberta (o cliente pode tentar outra sala/nome). `ALREADY_JOINED` ocorre se `join` chegar com a conexão já em uma sala (ignorado, sem efeito). `RATE_LIMITED` fecha a conexão.
- Nomes são únicos por sala (comparação case-insensitive); duplicado → `NAME_TAKEN`.
- IDs de peer gerados no servidor (`crypto.randomUUID()`), válidos só durante a conexão.
- `signal` só é repassado se remetente e destinatário estiverem na mesma sala.
- Limite de **6 peers por sala** (configurável).
- Salas vivem só em memória e são removidas quando ficam vazias.

## 6. Fluxo WebRTC (mesh)

0. **Antes de criar qualquer conexão**, o cliente busca `/api/ice` (seção 7) e guarda os `iceServers`; se falhar, cai para STUN público e mostra aviso na UI ("conexão via relay indisponível"). Renovar `iceServers` quando faltar menos de 10 min para o TTL expirar (só afeta conexões novas).
1. Ao receber `joined`, o novo cliente cria uma `RTCPeerConnection` para **cada** peer existente. Quem já estava na sala cria a conexão ao receber `peer-joined`.
2. Usar o padrão **Perfect Negotiation** (MDN/W3C) para evitar glare:
   - `polite = selfId < remoteId` (comparação de strings, determinística).
   - Handlers `onnegotiationneeded`, `onicecandidate`, tratamento de colisão de offers com rollback.
   - **Disparo da negociação inicial:** uma conexão sem tracks nem data channel nunca dispara `onnegotiationneeded`. Por isso, ao criar cada `RTCPeerConnection`, ambos os lados criam um data channel **pré-negociado** (`createDataChannel("ctrl", { negotiated: true, id: 0 })`), sem uso de mensagens em v1. Assim a conexão (e os stats P2P/relay) sobe assim que o par se conhece, e não só no primeiro compartilhamento. Além disso, cada lado adiciona um transceiver `recvonly` de vídeo para que a primeira offer já inclua m-line de vídeo e o áudio seja negociado conforme necessário.
   - Todo `signal` carrega `gen` (número da geração da conexão com aquele peer, começa em 0). Mensagens com `gen` menor que o atual são ignoradas.
3. Cada peer conecta com todos os outros (N·(N−1)/2 conexões). Todos podem receber; só quem está compartilhando envia vídeo.
4. **Iniciar compartilhamento:**
   - `getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: <valor do toggle "compartilhar áudio do sistema"> })`. O toggle é lido **antes** da captura (não dá para ligar depois).
   - Para cada `RTCPeerConnection`, `addTrack` (dispara renegociação automática). O `PeerManager` guarda o stream local e **também** o adiciona a toda conexão criada depois (novos `peer-joined`, recriações, reconexões), para que quem entra tarde receba a tela.
   - Enviar `sharing { active: true }`.
   - Escutar `track.onended` (usuário clica em "Parar compartilhamento" do navegador) → executar o fluxo de parada. Cada usuário compartilha no máximo **uma** tela por vez (um stream: vídeo + áudio opcional).
   - O tile local mostra uma prévia da própria tela (`muted`) **recolhida por padrão** para evitar efeito de espelho infinito ao compartilhar a tela inteira.
5. **Parar:** `removeTrack` em cada sender, parar as tracks locais, enviar `sharing { active: false }`.
6. **Qualidade:**
   - `track.contentHint = "detail"` por padrão (texto/código nítidos); opção "movimento" na UI para jogos/vídeo.
   - Limitar bitrate por sender via `RTCRtpSender.setParameters` (`maxBitrate` padrão ~2,5 Mbps, configurável na UI: 1 / 2,5 / 5 Mbps), já que o upload é multiplicado por N−1 destinatários. Atenção: `encodings` só existe depois da negociação; o `PeerManager` aplica o bitrate após `addTrack` ao término da negociação (ou no primeiro `connectionState === "connected"`) e reaplica em **todos** os senders quando o usuário troca a opção durante o compartilhamento.
   - Preferir codec VP9/H.264 se disponível, via `setCodecPreferences` (opcional, só se simples).
   - Mostrar na UI quantos destinatários simultâneos o upload atende (ex.: "enviando para 4 pessoas ≈ 10 Mbps").
7. **Falhas:**
   - Monitorar `iceConnectionState`/`connectionState`. Em `failed` → `restartIce()`.
   - Em `disconnected` prolongado (>10 s) ou `failed` persistente → **recriar** a conexão: o lado que detecta fecha a conexão atual, incrementa `gen`, cria nova `RTCPeerConnection` e envia `signal { gen, reset: true }` ao peer. Ao receber `reset` com `gen` maior que o seu, o outro lado descarta sua conexão antiga e cria uma nova com aquele `gen` (também re-adicionando seu stream local, se estiver compartilhando). Se ambos detectarem ao mesmo tempo, vence o maior `gen`; em empate, o lado **impolite** (selfId maior) prevalece e o polite recria.
   - Mostrar indicador por peer: `conectando`, `direto (P2P)`, `via relay (TURN)`, `falhou` (obter via `getStats()` → par de candidates selecionado, `candidateType === "relay"`).
8. Ao receber `peer-left`, fechar e descartar a conexão correspondente e liberar o stream.

## 7. STUN e TURN

- **STUN:** `stun:stun.l.google.com:19302` (e opcionalmente `stun:stun1.l.google.com:19302`).
- **TURN:** necessário para redes com NAT simétrico (4G/5G, faculdade, empresas). Como o Cloudflare Tunnel não transporta UDP, usar um provedor gerenciado com tier gratuito:
  - Opção A (preferida): **Cloudflare Realtime TURN** (credenciais efêmeras via API).
  - Opção B: **Metered.ca** (tier gratuito, via API de credenciais).
  - Opção C (fora do v1): `coturn` no PC com port-forward de UDP no roteador.
  - Verificar os limites vigentes do tier gratuito do provedor escolhido antes de implementar; o design não deve depender de números específicos.
- **Abstração:** o backend expõe `GET /api/ice` que devolve `{ iceServers: RTCIceServer[] }`. A chave/segredo do provedor TURN fica **apenas no servidor** (env), nunca no bundle do frontend. O endpoint gera credenciais de curta duração (TTL ~1 h) chamando a API do provedor, com cache em memória por alguns minutos.
- Interface `IceProvider` em `server/src/ice.ts` com implementações `CloudflareIceProvider` e `MeteredIceProvider`, selecionadas por `ICE_PROVIDER` no env. Se não configurado, devolve só STUN (dev local).
- O endpoint exige o mesmo token de acesso da sala (ver seção 8) para não expor TURN a terceiros.
- Falha ao falar com o provedor TURN: `/api/ice` loga o erro e responde apenas com STUN (HTTP 200), nunca 500, para que a sala continue funcionando entre quem consegue P2P direto.

## 8. Segurança e acesso

Uso privado entre amigos, então sem sistema de contas.

- **Senha compartilhada:** `ACCESS_PASSWORD` no env. Comparação em tempo constante (`crypto.timingSafeEqual`, comparando hashes SHA-256 de mesmo tamanho para não vazar comprimento). A senha é enviada **só** no `POST /api/login`; o WS e o `join` não a carregam (a posse do token é a prova). Salas com senha própria ficam fora do v1.
- **Fluxo de login (cliente):** JoinForm → `POST /api/login { password }` → em caso de 200, guarda o token **em memória** (e em `sessionStorage` para sobreviver a F5) → abre `/ws?token=...` → envia `join`. Senha errada → HTTP 401 e mensagem "senha incorreta" na UI.
- **Token de sessão:** `POST /api/login` devolve `{ token, expiresAt }`, assinado com HMAC (`SESSION_SECRET`, expiração 12 h), usado como `Authorization: Bearer` no `/api/ice` e como query param do WS (`/ws?token=...`). O WS rejeita upgrade sem token válido (HTTP 401). O token no query string é aceito por limitação da API de WebSocket do navegador; por isso **não logar a URL do upgrade**.
- **Token expirado:** se o upgrade falhar com 401 ou o token estiver a menos de 5 min de expirar ao reconectar, o cliente descarta o token e volta ao JoinForm com a senha pré-solicitada ("sessão expirou"). A senha **não** é guardada pelo cliente.
- **Origin check** no upgrade do WebSocket contra `ALLOWED_ORIGIN` (ex.: `https://share.seudominio.com`). Em desenvolvimento (`NODE_ENV=development`) é aceita também a origem do Vite (`http://localhost:5173`).
- **IP do cliente:** o header `CF-Connecting-IP` só é considerado quando o socket remoto é loopback (`127.0.0.1`/`::1`, i.e., o `cloudflared`); caso contrário usa-se o IP do socket. Do contrário seria spoofável.
- **Rate limit:** por IP em `/api/login` (padrão 10 tentativas / 10 min, configurável) e limite de mensagens por conexão WS (padrão 50/s; excesso → `RATE_LIMITED` e fecha).
- Limite de tamanho de mensagem WS (64 KB) e de tamanho de nome (30 chars).
- Cabeçalhos: `Content-Security-Policy` restritiva (base: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss://<host de ALLOWED_ORIGIN>; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` — listar `wss://` explicitamente porque alguns navegadores não tratam `'self'` como cobrindo WS), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: display-capture=(self)`.
- Sem logs de conteúdo de sinalização (SDP contém IPs); logar apenas eventos (join/leave/erro).

## 9. Heartbeat e reconexão

- O Cloudflare Tunnel derruba WebSockets ociosos; cliente envia `ping` a cada 25 s, servidor responde `pong` e encerra conexões sem ping por 60 s.
- O cliente reconecta o WS com backoff exponencial (1 s → 15 s). Ao reconectar, refaz `join` (com `sharing: true` se ainda estiver compartilhando); como o `selfId` muda, as `RTCPeerConnection` antigas são descartadas e recriadas com `gen` 0, e o stream local (se houver) é re-adicionado às novas conexões. Para os demais peers, o `peer-left` do id antigo (disparado quando o servidor detecta o fechamento do socket ou o timeout de 60 s) remove o "fantasma"; a UI deve tolerar brevemente dois participantes com o mesmo nome (o antigo é removido ao chegar o `peer-left`) — por isso o servidor, ao receber `join` com nome já usado **pelo mesmo token** (mesma sessão), expulsa a conexão antiga em vez de responder `NAME_TAKEN`.
- Falhas de reconexão por 401 (token expirado/inválido) não entram no backoff: seguem o fluxo da seção 8 (voltar ao login).
- Conexões P2P já estabelecidas **continuam** funcionando durante uma queda curta do WS (a sinalização só é necessária para renegociar).

## 10. Frontend (UX)

Telas:
1. **JoinForm:** nome, sala, senha. Lembra nome e sala em `localStorage`. Deep link `/?room=abc` preenche a sala.
2. **Room:**
   - Grid responsivo com um `VideoTile` por peer que está compartilhando; tile em destaque ao clicar (tela cheia via Fullscreen API).
   - Se ninguém compartilha: estado vazio com a lista de participantes.
   - Barra de controles: **Compartilhar / Parar**, seletor de qualidade (bitrate), toggle "compartilhar áudio do sistema", **Copiar link da sala**, **Sair**.
   - Lista de participantes com nome e badge de conexão (P2P / relay / conectando / falhou).
3. Erros claros: senha errada, sala cheia, nome em uso, sessão expirada, permissão de captura negada, navegador sem suporte a `getDisplayMedia`.

**Navegadores suportados (v1):** Chrome e Edge recentes (desktop) são o alvo principal; Firefox e Safari desktop recentes funcionam para compartilhar vídeo, mas **áudio do sistema só é capturado no Chrome/Edge** (Windows/ChromeOS; no macOS/Linux só áudio de aba). A UI desabilita/avisa o toggle de áudio quando não suportado. Mobile apenas assiste.

**Áudio:** v1 compartilha somente o áudio vindo de `getDisplayMedia`. Microfone fica fora do v1 (decisão confirmada na seção 16, item 4).

Requisitos técnicos:
- `<video autoplay playsinline>`; `muted` no tile local, e para tiles remotos respeitar a política de autoplay (iniciar mudo se bloqueado e oferecer botão de ativar som).
- Sem biblioteca de UI pesada; CSS simples (CSS Modules ou um único arquivo). Sem estado global além de Context/`useReducer`.
- Cleanup rigoroso em `useEffect` (fechar peers, parar tracks, remover listeners).

## 11. Variáveis de ambiente (`.env.example`)

```
NODE_ENV=production            # production | development
HOST=127.0.0.1
PORT=3000
ALLOWED_ORIGIN=https://share.seudominio.com
ACCESS_PASSWORD=troque-isto
SESSION_SECRET=string-aleatoria-longa
SESSION_TTL_HOURS=12
MAX_PEERS_PER_ROOM=6
LOGIN_RATE_MAX=10              # tentativas de login por janela
LOGIN_RATE_WINDOW_MIN=10
WS_MSG_RATE_PER_SEC=50
STATIC_DIR=packages/web/dist
ICE_PROVIDER=cloudflare        # cloudflare | metered | none
ICE_CREDENTIAL_TTL_SEC=3600
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_API_TOKEN=
METERED_APP_NAME=
METERED_API_KEY=
```

`config.ts` valida tudo com `zod` na inicialização e falha rápido com mensagem clara. Regras de validação:
- `ACCESS_PASSWORD` e `SESSION_SECRET` rejeitam os valores de exemplo (`troque-isto`, `string-aleatoria-longa`); `SESSION_SECRET` exige ≥ 32 caracteres e `ACCESS_PASSWORD` ≥ 8.
- Variáveis do provedor são **obrigatórias condicionalmente**: `cloudflare` exige `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN`; `metered` exige `METERED_APP_NAME` e `METERED_API_KEY`; `none` não exige nenhuma.
- `ALLOWED_ORIGIN` deve ser uma origem válida (sem path).
- Carregamento do `.env`: usar `node --env-file=.env` (Node ≥ 20.6) nos scripts `start`/`dev`, sem adicionar `dotenv`. Requer Node ≥ 20.6 (documentar no README e em `engines`).

## 12. Cloudflare Tunnel

`cloudflared/config.example.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /caminho/para/<TUNNEL_ID>.json
ingress:
  - hostname: share.seudominio.com
    service: http://localhost:3000
  - service: http_status:404
```

README deve documentar: o guia de domínio (seção 16, item 2), `cloudflared tunnel login` → `tunnel create` → `tunnel route dns` → `tunnel run`, e como rodar como serviço no **Windows** (`cloudflared service install`). Também documentar o modo de teste com quick tunnel (sem domínio). WebSockets funcionam por padrão no tunnel.

## 13. Fases de implementação

1. **Scaffold:** monorepo, tsconfig base, ESLint + Prettier, scripts `dev` (server com `tsx watch` + Vite com proxy de `/api` e `/ws` para `:3000`), `build`, `start`. O `dev` precisa rodar server e Vite em paralelo **no Windows**; usar `npm-run-all2` (`run-p`) ou `concurrently` como devDependency justificada (única exceção à lista da seção 17), pois `&` não é portável.
2. **Protocolo compartilhado:** `shared/protocol.ts` com schemas e tipos.
3. **Servidor:** config, auth/token, rooms, signaling, origin check, rate limit, heartbeat, servir estáticos do build em produção.
4. **Cliente de sinalização:** `signaling-client.ts` com reconexão e heartbeat.
5. **PeerManager:** perfect negotiation, add/remove tracks, restart ICE, stats de tipo de conexão.
6. **UI:** JoinForm, Room, VideoTile, Controls, `useScreenShare`.
7. **ICE/TURN:** `IceProvider`, `/api/ice`, integração no cliente.
8. **Hardening:** CSP, headers, limites, tratamento de erros, cleanup.
9. **Deploy:** README com passo a passo do Cloudflare Tunnel, `.env.example`, script `start` de produção.

Cada fase termina com o projeto compilando (`tsc --noEmit`) e lint limpo.

## 14. Testes

- **Unitários (Vitest):** schemas do protocolo, `rooms.ts` (join/leave/limite/sala vazia), comparação de senha, geração/validação de token, rate limiter.
- **Integração (server):** subir o servidor, conectar 2–3 clientes `ws`, validar `joined`/`peer-joined`/`signal`/`peer-left`, senha errada (401 no login), upgrade sem token/token expirado (401), sala cheia, nome duplicado, `join` duplicado, origin inválida, `signal` entre salas diferentes (bloqueado).
- **Unitário (PeerManager):** com `RTCPeerConnection` mockada, validar polite/impolite, descarte de `signal` com `gen` antigo, fluxo de `reset`, e `addTrack` do stream local em conexões criadas depois do início do compartilhamento.
- **Manual (checklist no README):**
  - 2 abas na mesma máquina compartilhando tela.
  - 2 dispositivos (outro PC/celular) **via o domínio do tunnel (HTTPS)**, nunca por `http://<ip-da-lan>` (sem contexto seguro não há `getDisplayMedia`).
  - Entrar na sala **depois** de alguém já estar compartilhando e ver a tela.
  - 1 dispositivo em 4G (força TURN; confirmar badge "relay").
  - Parar compartilhamento pelo botão nativo do navegador.
  - Fechar aba e reabrir; queda e retorno do Wi-Fi.
  - 4 pessoas, 2 compartilhando ao mesmo tempo.

## 15. Critérios de aceite

- Acessar `https://share.seudominio.com`, entrar com senha e sala, e ver a tela de outro participante com latência perceptivelmente baixa.
- Funciona com participantes atrás de NAT diferentes (inclusive 4G) graças ao TURN.
- Parar compartilhamento pelo navegador atualiza todos os participantes.
- Sem credenciais TURN no bundle do frontend; `/api/ice` e `/ws` rejeitam requisições sem token.
- Servidor reinicia sem estado persistido e clientes reconectam sozinhos.
- `npm run build && npm start` sobe tudo em uma porta só.

## 16. Decisões tomadas

1. **SO do PC:** Windows. O README documenta o `cloudflared` como serviço do Windows (`cloudflared service install`) e o servidor Node em segundo plano (ex.: serviço via NSSM ou tarefa agendada na inicialização), além de evitar suspensão do PC.
2. **Domínio:** o usuário **ainda não tem domínio** e precisa aprender a obter e configurar um. O README inclui um guia passo a passo: comprar um domínio barato (registrar direto no Cloudflare Registrar ou em outro registrador), criar conta gratuita no Cloudflare, adicionar o domínio e apontar os nameservers, escolher o subdomínio (ex.: `share.<dominio>`). Verificar preços e disponibilidade vigentes na hora. Enquanto não houver domínio, usar para desenvolvimento/testes um **quick tunnel** (`cloudflared tunnel --url http://localhost:3000`), que dá uma URL `*.trycloudflare.com` aleatória, sem conta nem domínio; como a URL muda a cada execução, `ALLOWED_ORIGIN` deve ser atualizada a cada vez, e esse modo não é indicado para uso contínuo. O Tunnel nomeado e estável (seção 12) exige domínio.
3. **Provedor TURN:** Cloudflare Realtime TURN (`ICE_PROVIDER=cloudflare`). `MeteredIceProvider` continua previsto na interface, mas fica como opção secundária.
4. **Microfone:** fora do v1; só áudio do sistema/aba via `getDisplayMedia`.

Não há mais decisões em aberto antes da fase 3. A conta Cloudflare (TURN key e tunnel) será criada pelo usuário; o Claude Code nunca deve pedir nem armazenar credenciais em chat, apenas documentar onde colocá-las no `.env`.

## 17. Diretrizes para o Claude Code

- TypeScript `strict`, sem `any`; tipos do protocolo vêm sempre de `shared`.
- Erros nunca silenciosos: logar e/ou propagar para a UI.
- Comentar apenas lógica não óbvia (perfect negotiation, restart ICE).
- Não adicionar dependências além de: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `ws`, `zod`, `tsx`, `vitest`, `typescript`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier` e seus tipos (`@types/*`), mais `npm-run-all2` (ou `concurrently`) para o script `dev` no Windows. Justificar qualquer outra. Sem Express nem `dotenv` (usar `node:http` e `--env-file`).
- As decisões da seção 16 já foram tomadas; não é necessário perguntar de novo antes da fase 3.
