/**
 * Typed test conversations with the receptionist, held in memory.
 *
 * A lab conversation is a stand-in for a phone call: it lives for as long as
 * someone is testing and is thrown away after. Memory is the right store for
 * that — one server process, a handful of testers — and it keeps unfinished
 * experiments out of the database. A restart simply ends them.
 */

import { randomUUID } from "crypto";
import type { ReceptionistSession } from "./session";

interface LabEntry {
  session: ReceptionistSession;
  organizationId: string;
  userId: string;
  lastUsed: number;
  /** One turn at a time: a second message while the first runs is refused. */
  busy: boolean;
}

const IDLE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50;

// Kept on globalThis so dev-mode module reloads do not drop live sessions.
const g = globalThis as unknown as { __receptionistLab?: Map<string, LabEntry> };
const store: Map<string, LabEntry> = (g.__receptionistLab ??= new Map());

/**
 * A lab call is over, however it ended: hung up, the receptionist said
 * goodbye, or left idle. An order the caller agreed goes to the board then,
 * as a phone order does when the line goes down.
 */
function drop(id: string) {
  const e = store.get(id);
  store.delete(id);
  return e ? e.session.finish() : Promise.resolve(null);
}

function sweep(now: number) {
  for (const [id, e] of store) {
    if (now - e.lastUsed > IDLE_MS) void drop(id).catch(() => {});
  }
  // Oldest first, if someone opens far more than anyone needs.
  while (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    void drop(oldest[0]).catch(() => {});
  }
}

export function putLabSession(
  session: ReceptionistSession,
  organizationId: string,
  userId: string
): string {
  const now = Date.now();
  sweep(now);
  const id = randomUUID();
  store.set(id, { session, organizationId, userId, lastUsed: now, busy: false });
  return id;
}

/** The session, only for the person and shop that started it. */
export function getLabSession(id: string, organizationId: string, userId: string): LabEntry | null {
  const e = store.get(id);
  if (!e || e.organizationId !== organizationId || e.userId !== userId) return null;
  if (Date.now() - e.lastUsed > IDLE_MS) {
    void drop(id).catch(() => {});
    return null;
  }
  e.lastUsed = Date.now();
  return e;
}

/** End a lab call; resolves to the order it sent to the board, if any. */
export function endLabSession(id: string) {
  return drop(id);
}
