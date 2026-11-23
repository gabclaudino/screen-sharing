import { describe, expect, it } from 'vitest';
import { Room, toPeerInfo } from './rooms';

function mustJoin(room: Room, name: string, sid = `sid-${name}`) {
  const result = room.join({ name, sid });
  if (!result.ok) throw new Error(`join falhou: ${result.code}`);
  return result;
}

describe('Room (sala única)', () => {
  it('o primeiro join entra sozinho e os seguintes veem quem já está', () => {
    const room = new Room(6);
    expect(mustJoin(room, 'Ana').others).toEqual([]);
    const b = mustJoin(room, 'Bia');
    expect(b.others.map((p) => p.name)).toEqual(['Ana']);
    expect(room.size).toBe(2);
  });

  it('gera ids únicos e guarda sharing', () => {
    const room = new Room(6);
    const a = room.join({ name: 'Ana', sid: 's1', sharing: true });
    const b = room.join({ name: 'Bia', sid: 's2' });
    if (!a.ok || !b.ok) throw new Error('join falhou');
    expect(a.peer.id).not.toBe(b.peer.id);
    expect(a.peer.sharing).toBe(true);
    expect(b.peer.sharing).toBe(false);
  });

  it('guarda a foto de perfil, a entrega a quem entra depois e permite trocar e remover', () => {
    const room = new Room(6);
    const a = room.join({ name: 'Ana', sid: 's1', avatar: 'guri-1' });
    if (!a.ok) throw new Error('join falhou');
    expect(a.peer.avatar).toBe('guri-1');
    expect(toPeerInfo(a.peer)).toEqual({
      id: a.peer.id,
      name: 'Ana',
      sharing: false,
      avatar: 'guri-1',
    });

    expect(room.setAvatar(a.peer.id, 'guri-2')?.avatar).toBe('guri-2');
    expect(mustJoin(room, 'Bia').others[0]?.avatar).toBe('guri-2');
    const removed = room.setAvatar(a.peer.id, null);
    expect(removed?.avatar).toBeUndefined();
    expect(removed ? 'avatar' in toPeerInfo(removed) : true).toBe(false); // sem foto: campo ausente
    expect(room.setAvatar('nao-existe', 'guri-1')).toBeUndefined();
  });

  it('respeita o limite de peers', () => {
    const room = new Room(2);
    mustJoin(room, 'Ana');
    mustJoin(room, 'Bia');
    expect(room.join({ name: 'Caio', sid: 's3' })).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('libera vaga quando alguém sai', () => {
    const room = new Room(1);
    const a = mustJoin(room, 'Ana');
    expect(room.join({ name: 'Bia', sid: 's2' }).ok).toBe(false);
    room.leave(a.peer.id);
    expect(room.join({ name: 'Bia', sid: 's2' }).ok).toBe(true);
  });

  it('leave é idempotente', () => {
    const room = new Room(6);
    const a = mustJoin(room, 'Ana');
    expect(room.leave(a.peer.id)?.name).toBe('Ana');
    expect(room.leave(a.peer.id)).toBeUndefined();
    expect(room.leave('inexistente')).toBeUndefined();
    expect(room.size).toBe(0);
  });

  it('nome duplicado (sem diferenciar maiúsculas) de outro login → NAME_TAKEN', () => {
    const room = new Room(6);
    mustJoin(room, 'Ana', 's1');
    expect(room.join({ name: 'ANA', sid: 's2' })).toEqual({ ok: false, code: 'NAME_TAKEN' });
  });

  it('mesmo login com o mesmo nome substitui o peer antigo', () => {
    const room = new Room(6);
    const first = mustJoin(room, 'Ana', 's1');
    const second = mustJoin(room, 'Ana', 's1');
    expect(second.evicted?.id).toBe(first.peer.id);
    expect(room.get(first.peer.id)).toBeUndefined();
    expect(room.size).toBe(1);
    expect(second.others).toEqual([]);
  });

  it('a substituição funciona com a sala cheia', () => {
    const room = new Room(2);
    mustJoin(room, 'Ana', 's1');
    mustJoin(room, 'Bia', 's2');
    expect(room.join({ name: 'Ana', sid: 's1' }).ok).toBe(true);
    expect(room.size).toBe(2);
  });

  it('sharer devolve quem está compartilhando, ignorando a própria sessão', () => {
    const room = new Room(6);
    const a = mustJoin(room, 'Ana', 's1');
    const b = mustJoin(room, 'Bia', 's2');
    expect(room.sharer()).toBeUndefined();

    room.setSharing(a.peer.id, true);
    expect(room.sharer()?.name).toBe('Ana');
    expect(room.sharer('s1')).toBeUndefined(); // a própria Ana não conta contra ela mesma
    expect(room.sharer('s2')?.name).toBe('Ana');

    room.setSharing(a.peer.id, false);
    room.setSharing(b.peer.id, true);
    expect(room.sharer('s1')?.name).toBe('Bia');
  });

  it('setSharing atualiza o peer', () => {
    const room = new Room(6);
    const a = mustJoin(room, 'Ana');
    expect(room.setSharing(a.peer.id, true)?.sharing).toBe(true);
    expect(room.get(a.peer.id)?.sharing).toBe(true);
    expect(room.setSharing('inexistente', true)).toBeUndefined();
  });
});
