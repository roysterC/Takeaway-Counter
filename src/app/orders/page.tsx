"use client";

/**
 * Tonight's orders. The live board is the counter's main screen: every order
 * still in the kitchen or on the road, in columns by how far along it is,
 * refreshed every few seconds so a phone order appears without anyone
 * touching anything (with a chime, if sound is on). History is any day's
 * orders, searchable, with the day's takings.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, BellOff, ClipboardList, Minus, Pause, Play, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { OrderCard, StatusBadge, TypeBadge, SourceBadge } from "@/components/orders/order-card";
import { OrderSheet } from "@/components/orders/order-sheet";
import { NewOrderSheet } from "@/components/orders/new-order-sheet";
import { apiFetch } from "@/lib/api-fetch";
import { usePoll } from "@/lib/use-poll";
import { clock, formatPence, phone } from "@/lib/format";
import type { OrderStatus } from "@/lib/order-status";
import type { OrderView } from "@/lib/order-view";
import { cn } from "@/lib/utils";

interface LiveData {
  orders: OrderView[];
  tonight: { orders: number; takingsPence: number; byPhone: number };
  shop: {
    acceptingOrders: boolean;
    voiceEnabled: boolean;
    collectionMinutes: number;
    deliveryMinutes: number;
    open: boolean;
    hoursNote: string;
  };
}

interface HistoryData {
  date: string;
  orders: OrderView[];
  totals: { orders: number; takingsPence: number; deliveries: number; collections: number };
}

const COLUMNS: Array<{ status: OrderStatus; title: string }> = [
  { status: "new", title: "New" },
  { status: "preparing", title: "Cooking" },
  { status: "ready", title: "Ready" },
  { status: "out_for_delivery", title: "Out for delivery" },
];

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") === "history" ? "history" : "live";
  const [creating, setCreating] = useState(false);
  const { notify } = useDialogs();

  const setView = (v: "live" | "history") => {
    const next = new URLSearchParams(params);
    if (v === "live") next.delete("view");
    else next.set("view", v);
    router.replace(`/orders${next.size ? `?${next}` : ""}`);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        actions={
          <>
            <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
              {(["live", "history"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    view === v ? "bg-card text-foreground shadow-surface" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {v === "live" ? "Live" : "History"}
                </button>
              ))}
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New order
            </Button>
          </>
        }
      />
      {view === "live" ? <LiveBoard /> : <History />}
      <NewOrderSheet
        open={creating}
        onClose={() => setCreating(false)}
        onPlaced={(n) => {
          notify(`Order #${n} is on the board.`);
          window.dispatchEvent(new Event("orders-changed"));
        }}
      />
    </div>
  );
}

function useStatusChange(reload: () => void) {
  const { notify } = useDialogs();
  const [busy, setBusy] = useState<string | null>(null);
  const change = useCallback(
    async (order: OrderView, status: OrderStatus) => {
      setBusy(order.id);
      try {
        const res = await apiFetch(`/api/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) notify((await res.json().catch(() => null))?.error ?? "Couldn't update the order.");
      } catch {
        notify("Couldn't reach the server.");
      } finally {
        setBusy(null);
        reload();
      }
    },
    [notify, reload]
  );
  return { busy, change };
}

function LiveBoard() {
  const { data, error, reload } = usePoll<LiveData>("/api/orders?view=live", 5000);
  const { busy, change } = useStatusChange(reload);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useSoundSetting();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onChange = () => reload();
    window.addEventListener("orders-changed", onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener("orders-changed", onChange);
    };
  }, [reload]);

  // New orders since the board loaded: highlighted, and a chime.
  useEffect(() => {
    if (!data) return;
    const ids = data.orders.map((o) => o.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const arrived = ids.filter((id) => !seen.current!.has(id));
    if (!arrived.length) return;
    arrived.forEach((id) => seen.current!.add(id));
    setFresh((f) => new Set([...f, ...arrived]));
    if (sound) chime();
  }, [data, sound]);

  const byStatus = useMemo(() => {
    const m: Record<string, OrderView[]> = {};
    for (const o of data?.orders ?? []) (m[o.status] ??= []).push(o);
    return m;
  }, [data]);

  const open = data?.orders.find((o) => o.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {data && <ShopStrip data={data} reload={reload} sound={sound} setSound={setSound} />}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {data && data.orders.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={ClipboardList}
            title="No orders on the go"
            hint="Phone orders appear here the moment the caller confirms them. Orders taken at the counter go on with New order."
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const orders = byStatus[col.status] ?? [];
            return (
              <section key={col.status} className="min-w-0 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <StatusBadge status={col.status} />
                  <span className="text-muted-foreground tabular-nums">{orders.length}</span>
                </h2>
                {orders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    now={now}
                    fresh={fresh.has(o.id)}
                    busy={busy === o.id}
                    onOpen={() => {
                      setOpenId(o.id);
                      setFresh((f) => {
                        const n = new Set(f);
                        n.delete(o.id);
                        return n;
                      });
                    }}
                    onAdvance={(to) => {
                      setFresh((f) => {
                        const n = new Set(f);
                        n.delete(o.id);
                        return n;
                      });
                      void change(o, to);
                    }}
                  />
                ))}
                {!orders.length && <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Nothing here</p>}
              </section>
            );
          })}
        </div>
      )}

      <OrderSheet order={open} onClose={() => setOpenId(null)} onStatus={(o, s) => void change(o, s)} busy={busy !== null} />
    </div>
  );
}

/** Tonight at a glance, and the switches the counter flips during service. */
function ShopStrip({
  data,
  reload,
  sound,
  setSound,
}: {
  data: LiveData;
  reload: () => void;
  sound: boolean;
  setSound: (on: boolean) => void;
}) {
  const { notify } = useDialogs();
  const patch = async (body: Record<string, unknown>) => {
    const res = await apiFetch("/api/shop-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) notify((await res?.json().catch(() => null))?.error ?? "Couldn't change that.");
    reload();
  };
  const { shop, tonight } = data;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-surface">
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", shop.open ? "bg-emerald-500" : "bg-stone-400")} />
        <span className="font-medium">{shop.hoursNote}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Phone orders</span>
        {!shop.voiceEnabled ? (
          <span className="text-xs text-muted-foreground">receptionist off (Settings)</span>
        ) : (
          <Button
            size="sm"
            variant={shop.acceptingOrders ? "outline" : "destructive"}
            onClick={() => patch({ acceptingOrders: !shop.acceptingOrders })}
            title={shop.acceptingOrders ? "Pause: the receptionist will apologise and take no new orders" : "Start taking phone orders again"}
          >
            {shop.acceptingOrders ? <Pause /> : <Play />}
            {shop.acceptingOrders ? "Taking orders" : "Paused"}
          </Button>
        )}
      </div>

      <Stepper label="Collection" minutes={shop.collectionMinutes} onChange={(m) => patch({ collectionMinutes: m })} />
      <Stepper label="Delivery" minutes={shop.deliveryMinutes} onChange={(m) => patch({ deliveryMinutes: m })} />

      <div className="ml-auto flex items-center gap-4 tabular-nums">
        <span>
          <span className="font-semibold">{tonight.orders}</span> <span className="text-muted-foreground">orders tonight</span>
        </span>
        <span>
          <span className="font-semibold">{formatPence(tonight.takingsPence)}</span> <span className="text-muted-foreground">takings</span>
        </span>
        <span className="text-muted-foreground">{tonight.byPhone} by phone</span>
        <Button size="icon-sm" variant="ghost" onClick={() => setSound(!sound)} aria-label={sound ? "Mute new-order chime" : "Chime on new orders"} title={sound ? "Chime on new orders" : "Chime off"}>
          {sound ? <Bell /> : <BellOff />}
        </Button>
      </div>
    </div>
  );
}

function Stepper({ label, minutes, onChange }: { label: string; minutes: number; onChange: (m: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <Button size="icon-xs" variant="outline" aria-label={`${label} wait shorter`} disabled={minutes <= 5} onClick={() => onChange(Math.max(5, minutes - 5))}>
        <Minus />
      </Button>
      <span className="w-14 text-center font-semibold tabular-nums">{minutes} min</span>
      <Button size="icon-xs" variant="outline" aria-label={`${label} wait longer`} disabled={minutes >= 180} onClick={() => onChange(Math.min(180, minutes + 5))}>
        <Plus />
      </Button>
    </div>
  );
}

function History() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, reload } = usePoll<HistoryData>(`/api/orders?view=history&date=${date}&q=${encodeURIComponent(query)}`, 0);
  const { busy, change } = useStatusChange(reload);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.orders.find((o) => o.id === openId) ?? null;

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or order number" className="w-72 pl-8" />
        </div>
        {data && (
          <div className="ml-auto flex gap-4 text-sm tabular-nums">
            <span>
              <span className="font-semibold">{data.totals.orders}</span> <span className="text-muted-foreground">orders</span>
            </span>
            <span>
              <span className="font-semibold">{formatPence(data.totals.takingsPence)}</span> <span className="text-muted-foreground">takings</span>
            </span>
            <span className="text-muted-foreground">
              {data.totals.collections} collection · {data.totals.deliveries} delivery
            </span>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-surface">
        {data && data.orders.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No orders that day" hint={query ? "Nothing matches that search." : "Pick another day above."} />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Items</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.orders.map((o) => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer hover:bg-accent/50">
                  <td className="px-3 py-2 font-semibold tabular-nums">{o.number}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{clock(o.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{o.customerName}</div>
                    <div className="text-xs text-muted-foreground">{phone(o.customerPhone)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <TypeBadge type={o.type} />
                      <SourceBadge source={o.source} />
                    </div>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">
                    {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatPence(o.totalPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <OrderSheet order={open} onClose={() => setOpenId(null)} onStatus={(o, s) => void change(o, s)} busy={busy !== null} />
    </div>
  );
}

const SOUND_KEY = "new-order-chime";

function useSoundSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (window.localStorage.getItem(SOUND_KEY) === "0") setOn(false);
    } catch {
      // No storage: chime on.
    }
  }, []);
  return [
    on,
    (next) => {
      setOn(next);
      try {
        window.localStorage.setItem(SOUND_KEY, next ? "1" : "0");
      } catch {
        // Not remembered.
      }
      if (next) chime();
    },
  ];
}

/** Two short notes, loud enough to hear over a kitchen. Browsers only play it after someone has clicked on the page. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // No audio: the highlight still shows.
  }
}
