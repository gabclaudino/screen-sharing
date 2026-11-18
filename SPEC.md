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
                                                    ├─ GET /            (estáticos do React)
                                                    ├─ GET /api/ice     (iceServers + credenciais TURN)
                                                    └─ WS  /ws          (sinalização)

Mídia: Browser A ◄══ WebRTC P2P (UDP, SRTP) ══► Browser B
                     (fallback: via TURN relay)
```

- O servidor **nunca** toca em mídia; só repassa mensagens de sinalização.
- Cloudflare Tunnel só proxia HTTP/WebSocket. **Não** transporta UDP do WebRTC nem do TURN. Por isso o TURN é um serviço externo (seção 7).
- Mesma origem para estáticos, API e WS: evita CORS e simplifica o tunnel.

## 4. Estrutura do repositório

```
screenshare/
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
   │     └─ security.ts        # origin check, rate limit, auth
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

**Cliente → Servidor**

| `type` | Campos | Descrição |
|---|---|---|
| `join` | `room`, `name`, `password` | Entra na sala (cria se não existir) |
| `signal` | `to`, `data` | Repassa a um peer: `{ description?: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit }` |
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
| `error` | `code`, `message` | `BAD_PASSWORD`, `ROOM_FULL`, `RATE_LIMITED`, `INVALID` |
| `pong` | — | Resposta ao heartbeat |

Regras:
- IDs de peer gerados no servidor (`crypto.randomUUID()`), válidos só durante a conexão.
- `signal` só é repassado se remetente e destinatário estiverem na mesma sala.
- Limite de **6 peers por sala** (configurável).
- Salas vivem só em memória e são removidas quando ficam vazias.

## 6. Fluxo WebRTC (mesh)

1. Ao receber `joined`, o novo cliente cria uma `RTCPeerConnection` para **cada** peer existente. Quem já estava na sala cria a conexão ao receber `peer-joined`.
2. Usar o padrão **Perfect Negotiation** (MDN/W3C) para evitar glare:
   - `polite = selfId < remoteId` (comparação de strings, determinística).
   - Handlers `onnegotiationneeded`, `onicecandidate`, tratamento de colisão de offers com rollback.
3. Cada peer conecta com todos os outros (N·(N−1)/2 conexões). Todos podem receber; só quem está compartilhando envia vídeo.
4. **Iniciar compartilhamento:**
   - `getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true })`.
   - Para cada `RTCPeerConnection`, `addTrack` (dispara renegociação automática).
   - Enviar `sharing { active: true }`.
   - Escutar `track.onended` (usuário clica em "Parar compartilhamento" do navegador) → executar o fluxo de parada.
5. **Parar:** `removeTrack` em cada sender, parar as tracks locais, enviar `sharing { active: false }`.
6. **Qualidade:**
   - `track.contentHint = "detail"` por padrão (texto/código nítidos); opção "movimento" na UI para jogos/vídeo.
   - Limitar bitrate por sender via `RTCRtpSender.setParameters` (`maxBitrate` padrão ~2,5 Mbps, configurável na UI: 1 / 2,5 / 5 Mbps), já que o upload é multiplicado por N−1 destinatários.
   - Preferir codec VP9/H.264 se disponível, via `setCodecPreferences` (opcional, só se simples).
7. **Falhas:**
   - Monitorar `iceConnectionState`/`connectionState`. Em `failed` → `restartIce()`.
   - Em `disconnected` prolongado (>10 s) → recriar a conexão com aquele peer.
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

## 8. Segurança e acesso

Uso privado entre amigos, então sem sistema de contas.

- **Senha compartilhada:** `ACCESS_PASSWORD` no env. Comparação em tempo constante (`crypto.timingSafeEqual`). O cliente a envia no `join`. Salas podem ter senha própria opcional definida pelo primeiro a entrar (v1: usar só a senha global).
- **Token de sessão para `/api/ice`:** `POST /api/login { password }` devolve um token assinado (HMAC com `SESSION_SECRET`, expiração 12 h); usado como `Authorization: Bearer` no `/api/ice` e no query param do WS (`/ws?token=...`). O WS rejeita upgrade sem token válido.
- **Origin check** no upgrade do WebSocket contra `ALLOWED_ORIGIN` (ex.: `https://share.seudominio.com`).
- **Rate limit:** por IP (usar o header `CF-Connecting-IP` quando vier do tunnel) em `/api/login` (ex.: 10 tentativas / 10 min) e limite de mensagens por conexão WS (ex.: 50/s).
- Limite de tamanho de mensagem WS (64 KB) e de tamanho de nome (30 chars).
- Cabeçalhos: `Content-Security-Policy` restritiva, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` permitindo `display-capture` apenas para a própria origem.
- Sem logs de conteúdo de sinalização (SDP contém IPs); logar apenas eventos (join/leave/erro).

## 9. Heartbeat e reconexão

- O Cloudflare Tunnel derruba WebSockets ociosos; cliente envia `ping` a cada 25 s, servidor responde `pong` e encerra conexões sem ping por 60 s.
- O cliente reconecta o WS com backoff exponencial (1 s → 15 s). Ao reconectar, refaz `join`; como o `selfId` muda, as `RTCPeerConnection` antigas são descartadas e recriadas.
- Conexões P2P já estabelecidas **continuam** funcionando durante uma queda curta do WS (a sinalização só é necessária para renegociar).

## 10. Frontend (UX)

Telas:
1. **JoinForm:** nome, sala, senha. Lembra nome e sala em `localStorage`. Deep link `/?room=abc` preenche a sala.
2. **Room:**
   - Grid responsivo com um `VideoTile` por peer que está compartilhando; tile em destaque ao clicar (tela cheia via Fullscreen API).
   - Se ninguém compartilha: estado vazio com a lista de participantes.
   - Barra de controles: **Compartilhar / Parar**, seletor de qualidade (bitrate), toggle "compartilhar áudio do sistema", **Copiar link da sala**, **Sair**.
   - Lista de participantes com nome e badge de conexão (P2P / relay / conectando / falhou).
3. Erros claros: senha errada, sala cheia, permissão de captura negada, navegador sem suporte a `getDisplayMedia`.

Requisitos técnicos:
- `<video autoplay playsinline>`; `muted` no tile local, e para tiles remotos respeitar a política de autoplay (iniciar mudo se bloqueado e oferecer botão de ativar som).
- Sem biblioteca de UI pesada; CSS simples (CSS Modules ou um único arquivo). Sem estado global além de Context/`useReducer`.
- Cleanup rigoroso em `useEffect` (fechar peers, parar tracks, remover listeners).

## 11. Variáveis de ambiente (`.env.example`)

```
PORT=3000
ALLOWED_ORIGIN=https://share.seudominio.com
ACCESS_PASSWORD=troque-isto
SESSION_SECRET=string-aleatoria-longa
MAX_PEERS_PER_ROOM=6
ICE_PROVIDER=cloudflare        # cloudflare | metered | none
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_API_TOKEN=
METERED_APP_NAME=
METERED_API_KEY=
```

`config.ts` valida tudo com `zod` na inicialização e falha rápido com mensagem clara.

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

README deve documentar: `cloudflared tunnel login` → `tunnel create` → `tunnel route dns` → `tunnel run`; e como rodar como serviço no SO do usuário (Windows/Linux/macOS: perguntar qual antes de escrever essa parte). WebSockets funcionam por padrão no tunnel.

## 13. Fases de implementação

1. **Scaffold:** monorepo, tsconfig base, ESLint + Prettier, scripts `dev` (server com `tsx watch` + Vite com proxy de `/api` e `/ws` para `:3000`), `build`, `start`.
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
- **Integração (server):** subir o servidor, conectar 2–3 clientes `ws`, validar `joined`/`peer-joined`/`signal`/`peer-left`, senha errada, sala cheia, origin inválida.
- **Manual (checklist no README):**
  - 2 abas na mesma máquina compartilhando tela.
  - 2 dispositivos na mesma rede.
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

## 16. Decisões em aberto (perguntar ao usuário antes de implementar)

1. Sistema operacional do PC (para instruções do `cloudflared` como serviço).
2. Domínio já está no Cloudflare? Qual subdomínio usar?
3. Provedor TURN preferido (Cloudflare Realtime ou Metered).
4. Áudio do microfone entra no v1 ou fica para depois?

## 17. Diretrizes para o Claude Code

- TypeScript `strict`, sem `any`; tipos do protocolo vêm sempre de `shared`.
- Erros nunca silenciosos: logar e/ou propagar para a UI.
- Comentar apenas lógica não óbvia (perfect negotiation, restart ICE).
- Não adicionar dependências além de: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `ws`, `zod`, `tsx`, `vitest`, `eslint`, `prettier` e seus tipos. Justificar qualquer outra.
- Confirmar com o usuário os itens da seção 16 antes da fase 3.
