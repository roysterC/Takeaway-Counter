"use client";

/**
 * One order as the kitchen and the counter need it: number, how it's
 * leaving, when it's due, who it's for, what's in it, and one button to move
 * it on. Dense on purpose: the board is read at a glance from across a
 * kitchen.
 */

import { Bike, Clock, MapPin, Phone, ShoppingBag, StickyNote, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clock, formatPence, phone } from "@/lib/format";
import { nextStatus, STATUS_LABEL, type OrderStatus } from "@/lib/order-status";
import type { OrderView } from "@/lib/order-view";

/** What the main button says for the step it takes. */
const ADVANCE_LABEL: Record<string, string> = {
  preparing: "Start cooking",
  ready: "Mark ready",
  out_for_delivery: "Out for delivery",
  completed: "Done",
};

export const STATUS_STYLE: Record<string, string> = {
  new: "bg-red-100 text-red-800",
  preparing: "bg-amber-100 text-amber-900",
  ready: "bg-emerald-100 text-emerald-800",
  out_for_delivery: "bg-sky-100 text-sky-800",
  completed: "bg-stone-100 text-stone-700",
  cancelled: "bg-stone-100 text-stone-500 line-through",
};

export function TypeBadge({ type }: { type: string }) {
  const delivery = type === "delivery";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        delivery ? "bg-sky-600 text-white" : "bg-stone-800 text-white"
      )}
    >
      {delivery ? <Bike className="h-3 w-3" /> : <ShoppingBag className="h-3 w-3" />}
      {delivery ? "Delivery" : "Collection"}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>
      {STATUS_LABEL[status as OrderStatus] ?? status}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "lab") return <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">TEST</span>;
  if (source === "phone") return <span className="text-[11px] text-muted-foreground">by phone</span>;
  return <span className="text-[11px] text-muted-foreground">at counter</span>;
}

export function OrderItems({ order }: { order: OrderView }) {
  return (
    <ul className="space-y-1">
      {order.items.map((i) => (
        <li key={i.id} className="flex gap-2 text-sm leading-snug">
          <span className="w-6 shrink-0 text-right font-semibold tabular-nums">{i.quantity}×</span>
          <span className="min-w-0 flex-1">
            {i.code && <span className="mr-1 font-mono text-xs text-muted-foreground">{i.code}</span>}
            {i.name}
            {i.notes && <span className="block text-xs font-medium text-red-700">→ {i.notes}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OrderCard({
  order,
  now,
  fresh,
  busy,
  onAdvance,
  onOpen,
}: {
  order: OrderView;
  now: number;
  /** Arrived since the board was last looked at: highlighted. */
  fresh?: boolean;
  busy?: boolean;
  onAdvance: (to: OrderStatus) => void;
  onOpen: () => void;
}) {
  const next = nextStatus(order.type, order.status);
  const due = order.promisedAt ? new Date(order.promisedAt).getTime() : null;
  const late = due !== null && now > due && order.status !== "out_for_delivery";
  const minsLeft = due !== null ? Math.round((due - now) / 60000) : null;

  return (
    <article
      className={cn(
        "rounded-xl border bg-card shadow-surface transition-shadow",
        fresh && "ring-2 ring-primary ring-offset-1 animate-in fade-in-0",
        late && "border-red-300"
      )}
    >
      <button type="button" onClick={onOpen} className="block w-full space-y-2.5 p-3 text-left">
        <div className="flex items-center gap-2">
          <span className="font-heading text-lg font-bold tabular-nums">#{order.number}</span>
          <TypeBadge type={order.type} />
          {order.source === "lab" && <SourceBadge source="lab" />}
          <span className="ml-auto flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Clock className="h-3 w-3" />
            {clock(order.createdAt)}
          </span>
        </div>

        <div className="text-sm">
          <p className="font-semibold">{order.customerName}</p>
          {order.customerPhone && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" />
              {phone(order.customerPhone)}
            </p>
          )}
          {order.type === "delivery" && order.address && (
            <p className="mt-1 flex items-start gap-1 text-xs">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {order.address}
                {order.deliveryNotes && <span className="block text-muted-foreground">Driver: {order.deliveryNotes}</span>}
              </span>
            </p>
          )}
        </div>

        <OrderItems order={order} />

        {order.notes && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            {/allerg|nut|gluten|dairy|coeliac/i.test(order.notes) ? (
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {order.notes}
          </p>
        )}

        <div className="flex items-center justify-between border-t pt-2 text-sm">
          <span className="font-semibold tabular-nums">
            {formatPence(order.totalPence)} <span className="text-xs font-normal text-muted-foreground">cash</span>
          </span>
          {minsLeft !== null && (
            <span className={cn("text-xs tabular-nums", late ? "font-semibold text-red-700" : "text-muted-foreground")}>
              {late ? `${-minsLeft} min late` : `due ${clock(order.promisedAt!)}`}
            </span>
          )}
        </div>
      </button>
      {next && (
        <div className="px-3 pb-3">
          <Button className="h-9 w-full" variant={order.status === "new" ? "default" : "outline"} disabled={busy} onClick={() => onAdvance(next)}>
            {order.type === "collection" && next === "completed" ? "Collected" : order.type === "delivery" && next === "completed" ? "Delivered" : ADVANCE_LABEL[next]}
          </Button>
        </div>
      )}
    </article>
  );
}
