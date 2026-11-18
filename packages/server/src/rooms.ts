import { randomUUID } from 'node:crypto';
import type { PeerInfo } from '@screenshare/shared';

export interface Peer {
  id: string;
  name: string;
  sharing: boolean;
  /** Sessão de login (do token) dona deste peer. */
  sid: string;
}

export type JoinResult =
  | { ok: true; peer: Peer; others: Peer[]; evicted?: Peer }
  | { ok: false; code: 'ROOM_FULL' | 'NAME_TAKEN' };

export const toPeerInfo = (peer: Peer): PeerInfo => ({
  id: peer.id,
  name: peer.name,
  sharing: peer.sharing,
});

/** A única sala do app, em memória; não conhece sockets. */
export class Room {
  private readonly peers = new Map<string, Peer>();
  private readonly maxPeers: number;

  constructor(maxPeers: number) {
    this.maxPeers = maxPeers;
  }

  join(input: { name: string; sid: string; sharing?: boolean }): JoinResult {
    const nameKey = input.name.toLowerCase();
    let evicted: Peer | undefined;

    for (const existing of this.peers.values()) {
      if (existing.name.toLowerCase() !== nameKey) continue;
      // Mesmo login reentrando com o mesmo nome (ex.: reconexão): substitui o antigo.
      if (existing.sid === input.sid) {
        evicted = existing;
      } else {
        return { ok: false, code: 'NAME_TAKEN' };
      }
    }

    if (this.peers.size - (evicted ? 1 : 0) >= this.maxPeers) {
      return { ok: false, code: 'ROOM_FULL' };
    }
    if (evicted) this.peers.delete(evicted.id);

    const others = this.all();
    const peer: Peer = {
      id: randomUUID(),
      name: input.name,
      sharing: input.sharing ?? false,
      sid: input.sid,
    };
    this.peers.set(peer.id, peer);

    return { ok: true, peer, others, ...(evicted ? { evicted } : {}) };
  }

  /** Idempotente: devolve `undefined` se o peer já saiu. */
  leave(peerId: string): Peer | undefined {
    const peer = this.peers.get(peerId);
    if (peer) this.peers.delete(peerId);
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

  /** Quem está compartilhando, ignorando as sessões em `exceptSid` (o próprio usuário). */
  sharer(exceptSid?: string): Peer | undefined {
    return this.all().find((peer) => peer.sharing && peer.sid !== exceptSid);
  }

  all(): Peer[] {
    return [...this.peers.values()];
  }

  get size(): number {
    return this.peers.size;
  }
}
