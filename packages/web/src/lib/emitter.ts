type Handler<Payload> = (payload: Payload) => void;

/** Emissor de eventos tipado, sem dependências. Um handler que lança não afeta os demais. */
export class TypedEmitter<Events extends object> {
  // O tipo do Set depende da chave; `handlersFor` concentra o cast num único lugar.
  private readonly handlers = new Map<keyof Events, Set<unknown>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const set = this.handlersFor(event);
    set.add(handler);
    return () => set.delete(handler);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of [...this.handlersFor(event)]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[emitter] handler de "${String(event)}" lançou:`, error);
      }
    }
  }

  private handlersFor<K extends keyof Events>(event: K): Set<Handler<Events[K]>> {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    return set as Set<Handler<Events[K]>>;
  }
}
