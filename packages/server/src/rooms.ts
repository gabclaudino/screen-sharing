import { randomUUID } from 'node:crypto';
import type { PeerInfo } from '@screenshare/shared';

export interface Peer {
  id: string;
  name: string;
  sharing: boolean;
  /** Sessão de login (do token) dona deste peer. */
  sid: string;
  room: string;
}

export type JoinResult =
  | { ok: true; peer: Peer; others: Peer[]; evicted?: Peer }
  | { ok: false; code: 'ROOM_FULL' | 'NAME_TAKEN' };

export const toPeerInfo = (peer: Peer): PeerInfo => ({
  id: peer.id,
  name: peer.name,
  sharing: peer.sharing,
});

/** Estado das salas em memória; não conhece sockets. Salas vazias são removidas. */
export class RoomManager {
  private readonly rooms = new Map<string, Map<string, Peer>>();
  private readonly peers = new Map<string, Peer>();
  private readonly maxPeers: number;

  constructor(maxPeers: number) {
    this.maxPeers = maxPeers;
  }

  join(room: string, input: { name: string; sid: string; sharing?: boolean }): JoinResult {
    const nameKey = input.name.toLowerCase();
    let evicted: Peer | undefined;

    for (const existing of this.peersInRoom(room)) {
      if (existing.name.toLowerCase() !== nameKey) continue;
      // Mesmo login reentrando com o mesmo nome (ex.: reconexão): substitui o antigo.
      if (existing.sid === input.sid) {
        evicted = existing;
      } else {
        return { ok: false, code: 'NAME_TAKEN' };
      }
    }

    const current = this.rooms.get(room)?.size ?? 0;
    if (current - (evicted ? 1 : 0) >= this.maxPeers) {
      return { ok: false, code: 'ROOM_FULL' };
    }

    if (evicted) this.remove(evicted);

    const peer: Peer = {
      id: randomUUID(),
      name: input.name,
      sharing: input.sharing ?? false,
      sid: input.sid,
      room,
    };
    const others = this.peersInRoom(room);
    let members = this.rooms.get(room);
    if (!members) {
      members = new Map();
      this.rooms.set(room, members);
    }
    members.set(peer.id, peer);
    this.peers.set(peer.id, peer);

    return { ok: true, peer, others, ...(evicted ? { evicted } : {}) };
  }

  /** Idempotente: devolve `undefined` se o peer já saiu. */
  leave(peerId: string): Peer | undefined {
    const peer = this.peers.get(peerId);
    if (!peer) return undefined;
    this.remove(peer);
    return peer;
  }

  get(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  setSharing(peerId: string, active: boolean): Peer | undefined {
    const peer = this.peers.get(peerId);
    if (peer) peer.sharing = active;
    return peer;
  }

  peersInRoom(room: string): Peer[] {
    return [...(this.rooms.get(room)?.values() ?? [])];
  }

  sameRoom(peerIdA: string, peerIdB: string): boolean {
    const a = this.peers.get(peerIdA);
    const b = this.peers.get(peerIdB);
    return a !== undefined && b !== undefined && a.room === b.room;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  private remove(peer: Peer): void {
    this.peers.delete(peer.id);
    const members = this.rooms.get(peer.room);
    if (!members) return;
    members.delete(peer.id);
    if (members.size === 0) this.rooms.delete(peer.room);
  }
}
