import { z } from 'zod';

// Limites do protocolo (SPEC seções 5 e 8). O limite de 64 KB por mensagem é imposto
// pelo servidor via `maxPayload` do `ws`; aqui ficam os limites por campo.
export const PROTOCOL_VERSION = 1;
export const MAX_WS_MESSAGE_BYTES = 64 * 1024;
export const NAME_MAX_LENGTH = 30;
export const SDP_MAX_LENGTH = 32 * 1024;
export const CANDIDATE_MAX_LENGTH = 2 * 1024;

// ---------------------------------------------------------------------------
// Campos básicos
// ---------------------------------------------------------------------------

// `trim` roda antes das verificações de tamanho; caracteres de controle são proibidos.
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .refine((value) => !/\p{Cc}/u.test(value), { message: 'name contains control characters' });

export const peerIdSchema = z.uuid();

export const peerInfoSchema = z.strictObject({
  id: peerIdSchema,
  name: nameSchema,
  sharing: z.boolean(),
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

export const pingMessageSchema = z.strictObject({ type: z.literal('ping') });
export const leaveMessageSchema = z.strictObject({ type: z.literal('leave') });

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinMessageSchema,
  signalToServerSchema,
  sharingMessageSchema,
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
