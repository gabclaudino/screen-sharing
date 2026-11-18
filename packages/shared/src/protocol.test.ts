import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_MAX_LENGTH,
  NAME_MAX_LENGTH,
  SDP_MAX_LENGTH,
  parseClientMessage,
  parseServerMessage,
  signalDataSchema,
} from './protocol';

const ID_A = '3f2b8c1e-5a47-4d6b-9c1a-0e7d2f4b6a10';
const ID_B = '9a1d7e52-83c4-4f0b-b6a2-1c5e8d3f7a21';

describe('parseClientMessage', () => {
  it('aceita join válido e aplica trim no nome', () => {
    const result = parseClientMessage(JSON.stringify({ type: 'join', name: '  Ana  ' }));
    expect(result).toEqual({ ok: true, message: { type: 'join', name: 'Ana' } });
  });

  it('aceita join com sharing', () => {
    const result = parseClientMessage(JSON.stringify({ type: 'join', name: 'Ana', sharing: true }));
    expect(result.ok).toBe(true);
  });

  it.each([
    ['nome vazio após trim', { type: 'join', name: '   ' }],
    ['nome longo demais', { type: 'join', name: 'a'.repeat(NAME_MAX_LENGTH + 1) }],
    ['nome com caractere de controle', { type: 'join', name: 'A\u0000na' }],
    ['sem nome', { type: 'join' }],
    ['campo room (sala única)', { type: 'join', room: 'abc', name: 'Ana' }],
    ['campo desconhecido (inclui password)', { type: 'join', name: 'Ana', password: 'x' }],
    ['type desconhecido', { type: 'hack' }],
  ])('rejeita %s', (_label, payload) => {
    expect(parseClientMessage(JSON.stringify(payload)).ok).toBe(false);
  });

  it('rejeita JSON inválido e valores que não são objeto', () => {
    expect(parseClientMessage('{nope')).toEqual({ ok: false, reason: 'invalid JSON' });
    expect(parseClientMessage('42').ok).toBe(false);
    expect(parseClientMessage('null').ok).toBe(false);
  });

  it('aceita ping, leave e sharing', () => {
    expect(parseClientMessage('{"type":"ping"}').ok).toBe(true);
    expect(parseClientMessage('{"type":"leave"}').ok).toBe(true);
    expect(parseClientMessage('{"type":"sharing","active":false}').ok).toBe(true);
    expect(parseClientMessage('{"type":"sharing","active":"yes"}').ok).toBe(false);
  });

  it('exige `to` como UUID no signal', () => {
    const data = { gen: 0, reset: true };
    expect(parseClientMessage(JSON.stringify({ type: 'signal', to: ID_A, data })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'signal', to: 'x', data })).ok).toBe(false);
  });
});

describe('signalDataSchema', () => {
  it('aceita offer, candidate e reset', () => {
    expect(
      signalDataSchema.safeParse({ gen: 0, description: { type: 'offer', sdp: 'v=0' } }).success,
    ).toBe(true);
    expect(
      signalDataSchema.safeParse({
        gen: 2,
        candidate: {
          candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      }).success,
    ).toBe(true);
    expect(signalDataSchema.safeParse({ gen: 1, reset: true }).success).toBe(true);
  });

  it('aceita rollback sem sdp e candidate vazio (fim de candidates)', () => {
    expect(signalDataSchema.safeParse({ gen: 0, description: { type: 'rollback' } }).success).toBe(
      true,
    );
    expect(signalDataSchema.safeParse({ gen: 0, candidate: { candidate: '' } }).success).toBe(true);
  });

  it('rejeita payload sem description, candidate ou reset', () => {
    expect(signalDataSchema.safeParse({ gen: 0 }).success).toBe(false);
  });

  it('exige gen inteiro não negativo', () => {
    expect(signalDataSchema.safeParse({ reset: true }).success).toBe(false);
    expect(signalDataSchema.safeParse({ gen: -1, reset: true }).success).toBe(false);
    expect(signalDataSchema.safeParse({ gen: 1.5, reset: true }).success).toBe(false);
  });

  it('rejeita reset diferente de true', () => {
    expect(signalDataSchema.safeParse({ gen: 0, reset: false }).success).toBe(false);
  });

  it('respeita os limites de tamanho de sdp e candidate', () => {
    const bigSdp = { gen: 0, description: { type: 'offer', sdp: 'a'.repeat(SDP_MAX_LENGTH + 1) } };
    const bigCandidate = { gen: 0, candidate: { candidate: 'a'.repeat(CANDIDATE_MAX_LENGTH + 1) } };
    expect(signalDataSchema.safeParse(bigSdp).success).toBe(false);
    expect(signalDataSchema.safeParse(bigCandidate).success).toBe(false);
  });

  it('rejeita tipo de description inválido e chaves desconhecidas', () => {
    expect(signalDataSchema.safeParse({ gen: 0, description: { type: 'nope' } }).success).toBe(
      false,
    );
    expect(signalDataSchema.safeParse({ gen: 0, reset: true, extra: 1 }).success).toBe(false);
  });
});

describe('parseServerMessage', () => {
  it('aceita joined com lista de peers', () => {
    const msg = {
      type: 'joined',
      selfId: ID_A,
      peers: [{ id: ID_B, name: 'Bia', sharing: true }],
    };
    expect(parseServerMessage(JSON.stringify(msg))).toEqual({ ok: true, message: msg });
  });

  it('aceita peer-joined, peer-left, peer-sharing, signal e pong', () => {
    const messages = [
      { type: 'peer-joined', peer: { id: ID_B, name: 'Bia', sharing: false } },
      { type: 'peer-left', id: ID_B },
      { type: 'peer-sharing', id: ID_B, active: true },
      { type: 'signal', from: ID_B, data: { gen: 0, reset: true } },
      { type: 'pong' },
    ];
    for (const msg of messages) {
      expect(parseServerMessage(JSON.stringify(msg)).ok).toBe(true);
    }
  });

  it('aceita apenas os códigos de erro definidos', () => {
    const base = { type: 'error', message: 'x' };
    for (const code of [
      'ROOM_FULL',
      'NAME_TAKEN',
      'ALREADY_JOINED',
      'SHARE_BUSY',
      'RATE_LIMITED',
      'INVALID',
    ]) {
      expect(parseServerMessage(JSON.stringify({ ...base, code })).ok).toBe(true);
    }
    expect(parseServerMessage(JSON.stringify({ ...base, code: 'BAD_PASSWORD' })).ok).toBe(false);
  });

  it('rejeita mensagens malformadas', () => {
    expect(parseServerMessage('oops').ok).toBe(false);
    expect(parseServerMessage('{"type":"peer-left","id":"não-uuid"}').ok).toBe(false);
  });
});
