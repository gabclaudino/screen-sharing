import { describe, expect, it } from 'vitest';
import {
  allPeers,
  createInitialRoomState,
  describeClose,
  describeServerError,
  roomReducer,
  sharingPeers,
  type RoomAction,
  type RoomState,
} from './room-state';

const ID_A = '3f2b8c1e-5a47-4d6b-9c1a-0e7d2f4b6a10';
const ID_B = '9a1d7e52-83c4-4f0b-b6a2-1c5e8d3f7a21';

const run = (actions: RoomAction[], from: RoomState = createInitialRoomState()): RoomState =>
  actions.reduce(roomReducer, from);

const stream = { id: 's' } as unknown as MediaStream;

describe('roomReducer', () => {
  it('começa sem peers, sem join e sem encerramento', () => {
    expect(createInitialRoomState()).toEqual({
      phase: 'idle',
      selfId: null,
      selfName: null,
      reactions: null,
      peers: {},
      everJoined: false,
      iceFallback: false,
      shareRejections: 0,
      lastError: null,
      closed: null,
    });
  });

  it('joined guarda selfId, marca everJoined e cria os peers como connecting', () => {
    const state = run([
      {
        type: 'joined',
        selfId: ID_A,
        selfName: 'Eu',
        reactions: undefined,
        peers: [{ id: ID_B, name: 'Bia', sharing: true }],
      },
    ]);
    expect(state.selfId).toBe(ID_A);
    expect(state.selfName).toBe('Eu');
    expect(state.everJoined).toBe(true);
    expect(state.peers[ID_B]).toEqual({
      id: ID_B,
      name: 'Bia',
      sharing: true,
      status: 'connecting',
      stream: null,
    });
  });

  it('joined sem selfName (servidor antigo) deixa selfName nulo, e a UI usa o nome digitado', () => {
    const state = run([
      { type: 'joined', selfId: ID_A, selfName: undefined, reactions: undefined, peers: [] },
    ]);
    expect(state.selfName).toBeNull();
  });

  it('joined guarda a lista de reações do servidor; sem ela (servidor antigo) fica nula', () => {
    const custom = run([
      { type: 'joined', selfId: ID_A, selfName: 'Eu', reactions: ['🐸', '🍕'], peers: [] },
    ]);
    expect(custom.reactions).toEqual(['🐸', '🍕']);
    const old = run([
      { type: 'joined', selfId: ID_A, selfName: 'Eu', reactions: undefined, peers: [] },
    ]);
    expect(old.reactions).toBeNull();
  });

  it('um novo joined (reconexão) substitui os peers e limpa o erro', () => {
    const state = run([
      {
        type: 'joined',
        selfId: ID_A,
        selfName: 'Eu',
        reactions: undefined,
        peers: [{ id: ID_B, name: 'Bia', sharing: false }],
      },
      { type: 'peer-stream', id: ID_B, stream },
      { type: 'error', code: 'INVALID' },
      { type: 'joined', selfId: ID_B, selfName: 'Eu', reactions: undefined, peers: [] },
    ]);
    expect(state.selfId).toBe(ID_B);
    expect(state.peers).toEqual({});
    expect(state.lastError).toBeNull();
  });

  it('peer-joined, peer-sharing, peer-status e peer-stream atualizam o peer', () => {
    const state = run([
      { type: 'peer-joined', peer: { id: ID_B, name: 'Bia', sharing: false } },
      { type: 'peer-sharing', id: ID_B, active: true },
      { type: 'peer-status', id: ID_B, status: 'relay' },
      { type: 'peer-stream', id: ID_B, stream },
    ]);
    expect(state.peers[ID_B]).toMatchObject({ sharing: true, status: 'relay', stream });
  });

  it('peer-left remove o peer; eventos tardios de quem saiu são ignorados', () => {
    const joined = run([{ type: 'peer-joined', peer: { id: ID_B, name: 'Bia', sharing: true } }]);
    const left = roomReducer(joined, { type: 'peer-left', id: ID_B });
    expect(left.peers).toEqual({});

    expect(roomReducer(left, { type: 'peer-stream', id: ID_B, stream })).toBe(left);
    expect(roomReducer(left, { type: 'peer-status', id: ID_B, status: 'p2p' })).toBe(left);
    expect(roomReducer(left, { type: 'peer-sharing', id: ID_B, active: true })).toBe(left);
    expect(roomReducer(left, { type: 'peer-left', id: ID_B })).toBe(left);
  });

  it('phase, error e closed', () => {
    const state = run([
      { type: 'phase', phase: 'reconnecting' },
      { type: 'error', code: 'ROOM_FULL' },
      { type: 'closed', reason: 'rejected' },
    ]);
    expect(state).toMatchObject({
      phase: 'reconnecting',
      lastError: 'ROOM_FULL',
      closed: 'rejected',
    });
  });

  it('ice-fallback liga e desliga o aviso de relay indisponível', () => {
    expect(run([{ type: 'ice-fallback', fallback: true }]).iceFallback).toBe(true);
    const recovered = run([
      { type: 'ice-fallback', fallback: true },
      { type: 'ice-fallback', fallback: false },
    ]);
    expect(recovered.iceFallback).toBe(false);
  });

  it('share-rejected conta cada recusa do servidor', () => {
    const state = run([{ type: 'share-rejected' }, { type: 'share-rejected' }]);
    expect(state.shareRejections).toBe(2);
  });

  it('não muta o estado anterior', () => {
    const before = createInitialRoomState();
    const snapshot = JSON.stringify(before);
    roomReducer(before, { type: 'peer-joined', peer: { id: ID_B, name: 'Bia', sharing: false } });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('seletores', () => {
  it('sharingPeers inclui quem compartilha ou ainda tem stream', () => {
    const state = run([
      { type: 'peer-joined', peer: { id: ID_A, name: 'Ana', sharing: true } },
      { type: 'peer-joined', peer: { id: ID_B, name: 'Bia', sharing: false } },
    ]);
    expect(sharingPeers(state).map((p) => p.name)).toEqual(['Ana']);

    // parou de compartilhar mas o stream ainda não foi liberado: o tile some só com o `null`
    const stopped = run(
      [
        { type: 'peer-stream', id: ID_B, stream },
        { type: 'peer-sharing', id: ID_A, active: false },
      ],
      state,
    );
    expect(sharingPeers(stopped).map((p) => p.name)).toEqual(['Bia']);
  });

  it('allPeers ordena por nome', () => {
    const state = run([
      { type: 'peer-joined', peer: { id: ID_B, name: 'Bia', sharing: false } },
      { type: 'peer-joined', peer: { id: ID_A, name: 'Ana', sharing: false } },
    ]);
    expect(allPeers(state).map((p) => p.name)).toEqual(['Ana', 'Bia']);
  });
});

describe('mensagens', () => {
  it('describeServerError cobre todos os códigos', () => {
    for (const code of [
      'ROOM_FULL',
      'NAME_TAKEN',
      'ALREADY_JOINED',
      'SHARE_BUSY',
      'RATE_LIMITED',
      'INVALID',
    ] as const) {
      expect(describeServerError(code).length).toBeGreaterThan(5);
    }
    expect(describeServerError('SHARE_BUSY')).toMatch(/compartilhando/i);
    expect(describeServerError('ROOM_FULL')).toMatch(/cheia/i);
    expect(describeServerError('NAME_TAKEN')).toMatch(/nome/i);
  });

  it('describeClose explica cada motivo; saída normal não gera aviso', () => {
    expect(describeClose('disconnect', null)).toBeNull();
    expect(describeClose('auth-expired', null)).toMatch(/sessão/i);
    expect(describeClose('rejected', 'ROOM_FULL')).toMatch(/cheia/i);
    expect(describeClose('rejected', null)).toMatch(/não foi possível/i);
    expect(describeClose('replaced', null)).toMatch(/outro lugar/i);
    expect(describeClose('policy', null)).toBeTruthy();
  });
});
