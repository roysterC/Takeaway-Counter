/**
 * What a call to our receptionist came to, for the call log.
 *
 * No recording, transcript or summary is kept: a call is logged only as its
 * outcomes, read from what the receptionist actually did, never from what it
 * said. An order counts only if place_order succeeded.
 */

import type { TurnResult } from "./engine";

export const CALL_OUTCOMES = ["ordered", "order_status", "message", "enquiry", "hung_up"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

function succeeded(name: string, result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const r = result as { success?: unknown; found?: unknown };
  if (name === "check_order_status") return r.found !== undefined;
  return r.success === true;
}

const DONE: Record<string, CallOutcome> = {
  place_order: "ordered",
  check_order_status: "order_status",
  take_message: "message",
};

/**
 * Everything the call did, in a fixed order. With nothing done, it was an
 * enquiry if the receptionist said goodbye (the caller's questions were
 * answered), and a hang-up if the caller put the phone down first.
 */
export function callOutcomes(turns: TurnResult[], endedByReceptionist: boolean): CallOutcome[] {
  const done = new Set<CallOutcome>();
  for (const turn of turns) {
    for (const tool of turn.tools) {
      const outcome = DONE[tool.name];
      if (outcome && !tool.isError && succeeded(tool.name, tool.result)) done.add(outcome);
    }
  }
  if (done.size === 0) return [endedByReceptionist ? "enquiry" : "hung_up"];
  return CALL_OUTCOMES.filter((o) => done.has(o));
}
