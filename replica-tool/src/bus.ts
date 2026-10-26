import { EventEmitter } from "node:events";

/**
 * Bus in-process per inoltrare in tempo reale al pannello (via SSE) gli eventi
 * generati dalle build e dalle repliche. Un solo processo Node → niente IPC.
 */
export type BusEvent =
  | { kind: "build"; buildId: string; data: unknown }
  | { kind: "session"; replicaId: string; sessionId: string; data: unknown }
  | { kind: "sessions-changed"; data?: unknown };

class Bus extends EventEmitter {
  emitEvent(ev: BusEvent): void {
    this.emit("event", ev);
  }
  onEvent(fn: (ev: BusEvent) => void): () => void {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}

/** Istanza condivisa a livello di processo. */
export const bus = new Bus();
bus.setMaxListeners(0);
