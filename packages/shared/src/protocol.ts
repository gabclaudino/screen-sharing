import { z } from 'zod';

// Limites do protocolo (SPEC seções 5 e 8). O limite de 64 KB por mensagem é imposto
// pelo servidor via `maxPayload` do `ws`; aqui ficam os limites por campo.
export const PROTOCOL_VERSION = 1;
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;
export const NAME_MAX_LENGTH = 30;
export const SDP_MAX_LENGTH = 32 * 1024;
export const CANDIDATE_MAX_LENGTH = 2 * 1024;
// Reações padrão (ordem = ordem dos botões). O dono troca a lista com REACTION_EMOJIS no .env;
// o servidor informa a lista em uso no `joined`. Ele também limita a frequência.
export const DEFAULT_REACTION_EMOJIS: readonly string[] = ['😂', '🔥', '💀', '👏', '❤️', '😮'];
export const MAX_REACTION_EMOJIS = 12;
const REACTION_MAX_LENGTH = 20;

// ---------------------------------------------------------------------------
// Campos básicos
// ---------------------------------------------------------------------------

// Marcas de direção (U+202A–202E, U+2066–2069) permitiriam escrever o nome "ao contrário" e
// se passar por outra pessoa na lista.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/u;

/**
 * Regras do nome de exibição (valem no cliente e no servidor): 1 a 30 caracteres depois do trim,
 * sem caracteres de controle nem marcas de direção, e pelo menos um caractere visível (um nome
 * só de espaços invisíveis, como U+200B, não identificaria ninguém).
 */
export function isValidName(raw: string): boolean {
  const name = raw.trim();
  return (
    name.length >= 1 &&
    name.length <= NAME_MAX_LENGTH &&
    !/\p{Cc}/u.test(name) &&
    !BIDI_CONTROLS.test(name) &&
    /[^\s\p{Cc}\p{Cf}]/u.test(name)
  );
}

/**
 * Uma reação é um único emoji (um "caractere" visível só, mesmo que composto, como bandeiras ou
 * 👨‍👩‍👧), sem texto: o servidor não repassa texto livre.
 */
export function isValidReactionEmoji(value: string): boolean {
  if (value.length === 0 || value.length > REACTION_MAX_LENGTH) return false;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)) return false;
  return [...new Intl.Segmenter().segment(value)].length === 1;
}

// `trim` roda antes das verificações de tamanho.
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .refine(isValidName, { message: 'invalid display name' });

export const peerIdSchema = z.uuid();

// Foto de perfil: só o *id* de uma foto pré-definida (a lista e os arquivos ficam no cliente);
// nunca uma URL nem um arquivo enviado. Um id que o cliente não conhece vira a imagem padrão.
export const avatarIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

export const peerInfoSchema = z.strictObject({
  id: peerIdSchema,
  name: nameSchema,
  sharing: z.boolean(),
  // Ausente = sem foto de perfil.
  avatar: avatarIdSchema.optional(),
});
export type PeerInfo = z.infer<typeof peerInfoSchema>;

// ---------------------------------------------------------------------------
// Dados de sinalização WebRTC
// ---------------------------------------------------------------------------

// Equivalente a RTCSessionDescriptionInit (`sdp` é opcional em `rollback`).
const descriptionSchema = z.strictObject({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string().max(SDP_MAX_LENGTH).optional(),
});

// Equivalente a RTCIceCandidateInit. `candidate` pode ser "" (fim de candidates).
const candidateSchema = z.strictObject({
  candidate: z.string().max(CANDIDATE_MAX_LENGTH),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

/**
 * Payload de `signal`. `gen` é a geração da conexão com aquele peer: mensagens com `gen`
 * menor que o atual são descartadas, e `reset` pede ao outro lado que recrie a conexão.
 */
export const signalDataSchema = z
  .strictObject({
    gen: z.number().int().min(0).max(1_000_000),
    description: descriptionSchema.optional(),
    candidate: candidateSchema.optional(),
    reset: z.literal(true).optional(),
  })
  .refine((data) => data.description !== undefined || data.candidate !== undefined || data.reset, {
    message: 'signal data must contain description, candidate or reset',
  });
export type SignalData = z.infer<typeof signalDataSchema>;

// ---------------------------------------------------------------------------
// Cliente → Servidor
// ---------------------------------------------------------------------------

// Há uma única sala: `join` não escolhe sala. A autenticação acontece no upgrade do WS
// (token), então também não carrega senha.
export const joinMessageSchema = z.strictObject({
  type: z.literal('join'),
  name: nameSchema,
  // true ao reentrar após reconexão enquanto ainda está compartilhando.
  sharing: z.boolean().optional(),
  // Foto de perfil escolhida (id); sem ela, a pessoa entra sem foto.
  avatar: avatarIdSchema.optional(),
});

export const signalToServerSchema = z.strictObject({
  type: z.literal('signal'),
  to: peerIdSchema,
  data: signalDataSchema,
});

export const sharingMessageSchema = z.strictObject({
  type: z.literal('sharing'),
  active: z.boolean(),
});

// Troca (id) ou remove (null) a própria foto de perfil.
export const avatarMessageSchema = z.strictObject({
  type: z.literal('avatar'),
  avatar: avatarIdSchema.nullable(),
});

// Só emojis da lista: o servidor não repassa texto livre (evita abuso e mensagens grandes).
export const reactionEmojiSchema = z.string().refine(isValidReactionEmoji, {
  message: 'invalid reaction emoji',
});
export type ReactionEmoji = string;

export const reactionToServerSchema = z.strictObject({
  type: z.literal('reaction'),
  emoji: reactionEmojiSchema,
});

export const pingMessageSchema = z.strictObject({ type: z.literal('ping') });
export const leaveMessageSchema = z.strictObject({ type: z.literal('leave') });

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinMessageSchema,
  signalToServerSchema,
  sharingMessageSchema,
  avatarMessageSchema,
  reactionToServerSchema,
  pingMessageSchema,
  leaveMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Servidor → Cliente
// ---------------------------------------------------------------------------

// Senha errada/token inválido recusam o upgrade com HTTP 401, não geram mensagem WS.
export const errorCodeSchema = z.enum([
  'ROOM_FULL',
  'NAME_TAKEN',
  'ALREADY_JOINED',
  // Só uma pessoa compartilha por vez: outra já está transmitindo.
  'SHARE_BUSY',
  'RATE_LIMITED',
  'INVALID',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const joinedMessageSchema = z.strictObject({
  type: z.literal('joined'),
  selfId: peerIdSchema,
  // Nome com que o servidor registrou a pessoa (pode diferir do digitado: apelidos configurados).
  // Opcional só por compatibilidade: um servidor antigo (ainda sem apelidos) não o envia.
  selfName: nameSchema.optional(),
  // Reações em uso nesta sala (REACTION_EMOJIS do servidor). Opcional: servidor antigo não envia.
  reactions: z.array(reactionEmojiSchema).max(MAX_REACTION_EMOJIS).optional(),
  peers: z.array(peerInfoSchema),
});

export const peerJoinedMessageSchema = z.strictObject({
  type: z.literal('peer-joined'),
  peer: peerInfoSchema,
});

export const peerLeftMessageSchema = z.strictObject({
  type: z.literal('peer-left'),
  id: peerIdSchema,
});

export const signalToClientSchema = z.strictObject({
  type: z.literal('signal'),
  from: peerIdSchema,
  data: signalDataSchema,
});

export const peerSharingMessageSchema = z.strictObject({
  type: z.literal('peer-sharing'),
  id: peerIdSchema,
  active: z.boolean(),
});

export const peerAvatarMessageSchema = z.strictObject({
  type: z.literal('peer-avatar'),
  id: peerIdSchema,
  avatar: avatarIdSchema.nullable(),
});

export const reactionToClientSchema = z.strictObject({
  type: z.literal('reaction'),
  from: peerIdSchema,
  emoji: reactionEmojiSchema,
});

export const errorMessageSchema = z.strictObject({
  type: z.literal('error'),
  code: errorCodeSchema,
  message: z.string().max(200),
});

export const pongMessageSchema = z.strictObject({ type: z.literal('pong') });

export const serverMessageSchema = z.discriminatedUnion('type', [
  joinedMessageSchema,
  peerJoinedMessageSchema,
  peerLeftMessageSchema,
  signalToClientSchema,
  peerSharingMessageSchema,
  peerAvatarMessageSchema,
  reactionToClientSchema,
  errorMessageSchema,
  pongMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------------------------------------------------------------------------
// API HTTP: POST /api/login
// ---------------------------------------------------------------------------

export const loginRequestSchema = z.strictObject({
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.strictObject({
  token: z.string().min(1),
  // Epoch em milissegundos em que o token expira.
  expiresAt: z.number().int(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

// ---------------------------------------------------------------------------
// API HTTP: GET /api/ice
// ---------------------------------------------------------------------------

// Equivalente a RTCIceServer (STUN sem credenciais; TURN com username/credential).
export const iceServerSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const iceServersResponseSchema = z.object({
  iceServers: z.array(iceServerSchema),
});
export type IceServersResponse = z.infer<typeof iceServersResponseSchema>;

// ---------------------------------------------------------------------------
// Parsing de mensagens brutas (string JSON recebida no WebSocket)
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; message: T } | { ok: false; reason: string };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map((issue) => issue.message).join('; ') };
  }
  return { ok: true, message: result.data };
}

/** Usado pelo servidor; `ok: false` → fechar a conexão com código 1008. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

/** Usado pelo cliente; mensagens inválidas do servidor devem ser logadas e ignoradas. */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, raw);
}
