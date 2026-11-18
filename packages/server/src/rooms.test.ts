import { describe, expect, it } from 'vitest';
import { RoomManager, type Peer } from './rooms';

function mustJoin(rooms: RoomManager, room: string, name: string, sid = `sid-${name}`) {
  const result = rooms.join(room, { name, sid });
  if (!result.ok) throw new Error(`join falhou: ${result.code}`);
  return result;
}

describe('RoomManager', () => {
  it('cria a sala no primeiro join e lista os outros peers', () => {
    const rooms = new RoomManager(6);
    const a = mustJoin(rooms, 'sala', 'Ana');
    expect(a.others).toEqual([]);
    expect(rooms.roomCount).toBe(1);

    const b = mustJoin(rooms, 'sala', 'Bia');
    expect(b.others.map((p: Peer) => p.name)).toEqual(['Ana']);
    expect(rooms.peersInRoom('sala')).toHaveLength(2);
  });

  it('gera ids únicos e guarda sharing', () => {
    const rooms = new RoomManager(6);
    const a = rooms.join('sala', { name: 'Ana', sid: 's1', sharing: true });
    const b = rooms.join('sala', { name: 'Bia', sid: 's2' });
    if (!a.ok || !b.ok) throw new Error('join falhou');
    expect(a.peer.id).not.toBe(b.peer.id);
    expect(a.peer.sharing).toBe(true);
    expect(b.peer.sharing).toBe(false);
  });

  it('respeita o limite de peers por sala', () => {
    const rooms = new RoomManager(2);
    mustJoin(rooms, 'sala', 'Ana');
    mustJoin(rooms, 'sala', 'Bia');
    expect(rooms.join('sala', { name: 'Caio', sid: 's3' })).toEqual({
      ok: false,
      code: 'ROOM_FULL',
    });
    // outra sala não é afetada
    expect(rooms.join('outra', { name: 'Caio', sid: 's3' }).ok).toBe(true);
  });

  it('libera vaga quando alguém sai', () => {
    const rooms = new RoomManager(1);
    const a = mustJoin(rooms, 'sala', 'Ana');
    expect(rooms.join('sala', { name: 'Bia', sid: 's2' }).ok).toBe(false);
    rooms.leave(a.peer.id);
    expect(rooms.join('sala', { name: 'Bia', sid: 's2' }).ok).toBe(true);
  });

  it('remove a sala quando fica vazia', () => {
    const rooms = new RoomManager(6);
    const a = mustJoin(rooms, 'sala', 'Ana');
    const b = mustJoin(rooms, 'sala', 'Bia');
    rooms.leave(a.peer.id);
    expect(rooms.roomCount).toBe(1);
    rooms.leave(b.peer.id);
    expect(rooms.roomCount).toBe(0);
    expect(rooms.peersInRoom('sala')).toEqual([]);
  });

  it('leave é idempotente', () => {
    const rooms = new RoomManager(6);
    const a = mustJoin(rooms, 'sala', 'Ana');
    expect(rooms.leave(a.peer.id)?.name).toBe('Ana');
    expect(rooms.leave(a.peer.id)).toBeUndefined();
    expect(rooms.leave('inexistente')).toBeUndefined();
  });

  it('nome duplicado (sem diferenciar maiúsculas) de outro login → NAME_TAKEN', () => {
    const rooms = new RoomManager(6);
    mustJoin(rooms, 'sala', 'Ana', 's1');
    expect(rooms.join('sala', { name: 'ANA', sid: 's2' })).toEqual({
      ok: false,
      code: 'NAME_TAKEN',
    });
    // mesmo nome em outra sala é permitido
    expect(rooms.join('outra', { name: 'Ana', sid: 's2' }).ok).toBe(true);
  });

  it('mesmo login com o mesmo nome substitui o peer antigo', () => {
    const rooms = new RoomManager(6);
    const first = mustJoin(rooms, 'sala', 'Ana', 's1');
    const second = mustJoin(rooms, 'sala', 'Ana', 's1');
    expect(second.evicted?.id).toBe(first.peer.id);
    expect(rooms.get(first.peer.id)).toBeUndefined();
    expect(rooms.peersInRoom('sala')).toHaveLength(1);
    expect(second.others).toEqual([]);
  });

  it('a substituição funciona com a sala cheia', () => {
    const rooms = new RoomManager(2);
    mustJoin(rooms, 'sala', 'Ana', 's1');
    mustJoin(rooms, 'sala', 'Bia', 's2');
    const again = rooms.join('sala', { name: 'Ana', sid: 's1' });
    expect(again.ok).toBe(true);
    expect(rooms.peersInRoom('sala')).toHaveLength(2);
  });

  it('sameRoom e setSharing', () => {
    const rooms = new RoomManager(6);
    const a = mustJoin(rooms, 'sala', 'Ana');
    const b = mustJoin(rooms, 'sala', 'Bia');
    const c = mustJoin(rooms, 'outra', 'Caio');
    expect(rooms.sameRoom(a.peer.id, b.peer.id)).toBe(true);
    expect(rooms.sameRoom(a.peer.id, c.peer.id)).toBe(false);
    expect(rooms.sameRoom(a.peer.id, 'inexistente')).toBe(false);

    expect(rooms.setSharing(a.peer.id, true)?.sharing).toBe(true);
    expect(rooms.get(a.peer.id)?.sharing).toBe(true);
    expect(rooms.setSharing('inexistente', true)).toBeUndefined();
  });
});
