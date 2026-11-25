import { randomInt } from 'node:crypto';
import { ROULETTE_MAX_NAMES, ROULETTE_SPIN_MS, type RouletteState } from '@screenshare/shared';

export interface RouletteOptions {
  /** Chamado quando o giro termina (o estado mudou sem ninguém ter pedido). */
  onResolve: () => void;
  /** Sorteia um inteiro em [0, max); injetável nos testes. */
  pick?: (max: number) => number;
  spinMs?: number;
}

interface Spin {
  seq: number;
  index: number;
  endsAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Roleta de times da sala, em memória. Uma pessoa por vez controla; o servidor sorteia, então
 * todos veem o mesmo resultado. Cada método devolve `true` se o estado mudou; pedidos que não
 * valem (sem controle, durante o giro, nome repetido...) são ignorados.
 */
export class Roulette {
  private ownerId: string | null = null;
  private entries: string[] = [];
  private teams: [string[], string[]] = [[], []];
  private spin: Spin | null = null;
  private last: RouletteState['last'] = null;
  private seq = 0;
  private readonly onResolve: () => void;
  private readonly pick: (max: number) => number;
  private readonly spinMs: number;

  constructor(options: RouletteOptions) {
    this.onResolve = options.onResolve;
    this.pick = options.pick ?? ((max) => randomInt(max));
    this.spinMs = options.spinMs ?? ROULETTE_SPIN_MS;
  }

  claim(peerId: string): boolean {
    if (this.ownerId !== null) return false;
    this.ownerId = peerId;
    return true;
  }

  /** Também usado quando a pessoa sai da sala; a lista e os times ficam para quem assumir. */
  release(peerId: string): boolean {
    if (this.ownerId !== peerId) return false;
    this.ownerId = null;
    return true;
  }

  /** Reconexão do mesmo login: o controle acompanha o novo id. */
  handover(fromPeerId: string, toPeerId: string): boolean {
    if (this.ownerId !== fromPeerId) return false;
    this.ownerId = toPeerId;
    return true;
  }

  add(peerId: string, name: string): boolean {
    if (!this.canEdit(peerId)) return false;
    const all = [...this.entries, ...this.teams[0], ...this.teams[1]];
    if (all.length >= ROULETTE_MAX_NAMES) return false;
    const key = name.toLowerCase();
    if (all.some((existing) => existing.toLowerCase() === key)) return false;
    this.entries.push(name);
    return true;
  }

  remove(peerId: string, name: string): boolean {
    if (!this.canEdit(peerId)) return false;
    const index = this.entries.indexOf(name);
    if (index === -1) return false;
    this.entries.splice(index, 1);
    return true;
  }

  /** Começa a girar; a pessoa sorteada só entra no time quando o giro termina. */
  start(peerId: string): boolean {
    if (!this.canEdit(peerId) || this.entries.length === 0) return false;
    this.seq += 1;
    const timer = setTimeout(() => this.resolve(), this.spinMs);
    timer.unref?.();
    this.spin = {
      seq: this.seq,
      index: this.pick(this.entries.length),
      endsAt: Date.now() + this.spinMs,
      timer,
    };
    return true;
  }

  reset(peerId: string, clear: boolean): boolean {
    if (!this.canEdit(peerId)) return false;
    this.entries = clear ? [] : [...this.entries, ...this.teams[0], ...this.teams[1]];
    this.teams = [[], []];
    this.last = null;
    return true;
  }

  /** Sala vazia ou servidor desligando: volta ao zero. */
  clear(): void {
    if (this.spin) clearTimeout(this.spin.timer);
    this.spin = null;
    this.ownerId = null;
    this.entries = [];
    this.teams = [[], []];
    this.last = null;
  }

  toState(): RouletteState {
    return {
      ownerId: this.ownerId,
      entries: [...this.entries],
      teams: [[...this.teams[0]], [...this.teams[1]]],
      spin: this.spin
        ? {
            seq: this.spin.seq,
            index: this.spin.index,
            ms: Math.min(this.spinMs, Math.max(0, this.spin.endsAt - Date.now())),
          }
        : null,
      last: this.last ? { ...this.last } : null,
    };
  }

  private canEdit(peerId: string): boolean {
    return this.ownerId === peerId && this.spin === null;
  }

  private resolve(): void {
    if (!this.spin) return;
    const [name] = this.entries.splice(this.spin.index, 1);
    this.spin = null;
    if (name === undefined) return;
    // Alternado: 1º → TIME 1, 2º → TIME 2, 3º → TIME 1...
    const drawn = this.teams[0].length + this.teams[1].length;
    const team = drawn % 2 === 0 ? 0 : 1;
    this.teams[team].push(name);
    this.last = { name, team };
    this.onResolve();
  }
}
