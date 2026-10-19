"use client";

/**
 * The receptionist lab: a phone call, typed (or spoken through the
 * computer's microphone).
 *
 * For getting the receptionist right before it goes on the phone: what it
 * says, which tools it reaches for, the order building up as it goes, and how
 * long the first word takes. It uses the real menu and places real orders,
 * marked TEST on the board.
 */

import { useEffect, useRef, useState } from "react";
import { FlaskConical, PhoneOff, Play, Send, TriangleAlert, Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-fetch";
import { VoiceLab } from "@/components/receptionist/voice-lab";
import { cn } from "@/lib/utils";

type ToolRun = { name: string; input: Record<string, unknown>; result: unknown; isError: boolean };

type Line =
  | { kind: "assistant"; text: string; firstTextMs?: number | null; totalMs?: number; cacheRead?: number }
  | { kind: "caller"; text: string }
  | { kind: "tool"; run: ToolRun }
  | { kind: "note"; text: string };

interface Summary {
  type: string | null;
  lines: Array<{ line: number; quantity: number; code: string | null; name: string; notes?: string; lineTotal: string }>;
  foodTotal: string;
  deliveryFee?: string;
  total: string;
}

const TOOL_LABEL: Record<string, string> = {
  set_order_type: "Collection or delivery",
  set_customer_details: "Saved the caller's details",
  add_items: "Added to the order",
  change_item: "Changed the order",
  set_order_notes: "Note for the kitchen",
  review_order: "Looked at the order so far",
  place_order: "Sent the order to the kitchen",
  check_order_status: "Looked up an order",
  take_message: "Took a message",
};

export default function ReceptionistLabPage() {
  const [callerNumber, setCallerNumber] = useState("07700 900123");
  const [ignoreHours, setIgnoreHours] = useState(true);
  const [mode, setMode] = useState<"type" | "talk">("type");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [order, setOrder] = useState<Summary | null>(null);
  const [placed, setPlaced] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, busy]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/receptionist/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerNumber, ignoreHours }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || "Could not start the call.");
      setSessionId(data.sessionId);
      setModel(data.model);
      setOrder(null);
      setPlaced(null);
      setLines([
        { kind: "note", text: data.callerNumber ? `Call from ${data.callerNumber}` : "Call from a withheld number" },
        { kind: "assistant", text: data.greeting },
      ]);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const hangUp = async () => {
    if (sessionId) await apiFetch(`/api/receptionist/lab?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {});
    setSessionId(null);
    setLines((ls) => [...ls, { kind: "note", text: "Call ended" }]);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !sessionId || busy) return;
    setDraft("");
    setBusy(true);
    setError(null);
    setLines((ls) => [...ls, { kind: "caller", text }]);
    try {
      const res = await apiFetch("/api/receptionist/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "That turn failed.");
        if (res.status === 404) setSessionId(null);
        return;
      }
      setOrder(data.order);
      if (data.placed) setPlaced(data.placed.number);
      setLines((ls) => [
        ...ls,
        ...((data.tools ?? []) as ToolRun[]).map((run) => ({ kind: "tool" as const, run })),
        { kind: "assistant", text: data.reply, firstTextMs: data.firstTextMs, totalMs: data.totalMs, cacheRead: data.usage?.cacheRead },
        ...(data.ended ? [{ kind: "note" as const, text: "The receptionist ended the call" }] : []),
      ]);
      if (data.ended) setSessionId(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Receptionist lab" />

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This uses the real menu. Orders it places go on the board marked TEST (and onto the customer record for the
          number below), so use a test number and cancel them after.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex w-fit gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="How to talk to it">
          {(["type", "talk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={Boolean(sessionId)}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                mode === m ? "bg-card text-foreground shadow-surface" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "type" ? "Type" : "Talk"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ignoreHours} disabled={Boolean(sessionId)} onChange={(e) => setIgnoreHours(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          Take orders even when the shop is closed
        </label>
      </div>

      {mode === "talk" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <VoiceLab callerNumber={callerNumber} ignoreHours={ignoreHours} />
          <Card className="h-fit gap-3">
            <CardContent className="space-y-2">
              <label className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">Calling from</span>
                <Input value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)} placeholder="Withheld" />
              </label>
              <p className="text-xs text-muted-foreground">
                Needs the voice server running (npm run voice) with Deepgram and ElevenLabs keys. Pause when you have
                finished speaking; talk over it to interrupt.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="min-h-[60vh] gap-0 py-0">
            <div className="max-h-[65vh] flex-1 space-y-3 overflow-y-auto px-4 py-5">
              {lines.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FlaskConical className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No call yet</p>
                  <p className="mt-1 max-w-xs text-xs">
                    Set the number the call comes from, then start the call. Use a regular&apos;s number to hear how they are
                    greeted, or leave it blank to test a withheld number.
                  </p>
                </div>
              )}
              {lines.map((line, i) => (
                <LineView key={i} line={line} />
              ))}
              {busy && sessionId && <div className="px-1 text-xs text-muted-foreground">Receptionist is answering…</div>}
              <div ref={endRef} />
            </div>
            <form
              className="flex gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={sessionId ? "What the caller says…" : "Start a call first"}
                disabled={!sessionId}
                className="h-10"
                aria-label="What the caller says"
              />
              <Button type="submit" className="h-10 gap-1.5 px-4" disabled={!sessionId || busy || !draft.trim()}>
                <Send className="h-4 w-4" />
                Say
              </Button>
            </form>
          </Card>

          <div className="space-y-4">
            <Card className="gap-3">
              <CardContent className="space-y-3">
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Calling from</span>
                  <Input value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)} placeholder="Withheld" disabled={Boolean(sessionId)} />
                </label>
                {sessionId ? (
                  <Button variant="outline" className="w-full gap-1.5" onClick={hangUp}>
                    <PhoneOff className="h-4 w-4" />
                    Hang up
                  </Button>
                ) : (
                  <Button className="w-full gap-1.5" onClick={start} disabled={busy}>
                    <Play className="h-4 w-4" />
                    {lines.length ? "Start a new call" : "Start the call"}
                  </Button>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardContent className="space-y-2 text-sm">
                <p className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  The order so far
                  {order?.type && <span className="rounded bg-muted px-1.5 py-0.5 uppercase">{order.type}</span>}
                </p>
                {!order || order.lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing yet.</p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {order.lines.map((l) => (
                        <li key={l.line} className="flex gap-2">
                          <span className="w-6 text-right font-semibold tabular-nums">{l.quantity}×</span>
                          <span className="flex-1">
                            {l.name}
                            {l.notes && <span className="block text-xs text-red-700">→ {l.notes}</span>}
                          </span>
                          <span className="tabular-nums">{l.lineTotal}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-0.5 border-t pt-2 text-xs tabular-nums">
                      {order.deliveryFee && (
                        <p className="flex justify-between text-muted-foreground">
                          <span>Delivery</span>
                          <span>{order.deliveryFee}</span>
                        </p>
                      )}
                      <p className="flex justify-between text-sm font-semibold">
                        <span>Total</span>
                        <span>{order.total}</span>
                      </p>
                    </div>
                  </>
                )}
                {placed && <p className="rounded-md bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800">Placed as order #{placed}</p>}
              </CardContent>
            </Card>

            {model && (
              <Card className="gap-2">
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    Model <span className="font-mono text-foreground">{model}</span>
                  </p>
                  <p>The time under each reply is how long until its first word, then the whole reply. On the phone, the first number is the silence the caller hears.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LineView({ line }: { line: Line }) {
  if (line.kind === "note") return <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">{line.text}</p>;
  if (line.kind === "caller") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[min(75%,52ch)] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{line.text}</p>
      </div>
    );
  }
  if (line.kind === "tool") {
    const { run } = line;
    return (
      <details className="group mx-auto max-w-[90%] rounded-lg border bg-muted/50 px-3 py-1.5 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground">
          <Wrench className={cn("h-3.5 w-3.5", run.isError ? "text-red-600" : "text-primary")} />
          <span className="text-foreground">{TOOL_LABEL[run.name] ?? run.name}</span>
          <span className="font-mono">{run.name}</span>
          {run.isError && <span className="text-red-600">failed</span>}
        </summary>
        <div className="mt-2 grid gap-2">
          <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[11px]">{JSON.stringify(run.input, null, 2)}</pre>
          <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[11px]">{JSON.stringify(run.result, null, 2)}</pre>
        </div>
      </details>
    );
  }
  return (
    <div className="flex flex-col items-start">
      <p className="max-w-[min(75%,52ch)] rounded-2xl rounded-bl-md border bg-card px-4 py-2.5 text-sm">{line.text}</p>
      {line.totalMs !== undefined && (
        <span className="mt-1 px-1 text-[11px] tabular-nums text-muted-foreground">
          {line.firstTextMs != null ? `${(line.firstTextMs / 1000).toFixed(1)}s to first word · ` : ""}
          {(line.totalMs / 1000).toFixed(1)}s total
          {line.cacheRead ? ` · ${line.cacheRead.toLocaleString()} tokens from cache` : ""}
        </span>
      )}
    </div>
  );
}
