"use client";

/**
 * An order in full, in a side panel: everything on the card plus the money
 * broken down, and every status it can be moved to, including back a step
 * (pressed by mistake) and cancelled.
 */

import Link from "next/link";
import { Ban } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { dateTime, formatPence, phone, clock } from "@/lib/format";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";
import type { OrderView } from "@/lib/order-view";
import { OrderItems, SourceBadge, StatusBadge, TypeBadge } from "./order-card";
import { cn } from "@/lib/utils";

const PATH: Record<string, OrderStatus[]> = {
  collection: ["new", "preparing", "ready", "completed"],
  delivery: ["new", "preparing", "ready", "out_for_delivery", "completed"],
};

export function OrderSheet({
  order,
  onClose,
  onStatus,
  busy,
}: {
  order: OrderView | null;
  onClose: () => void;
  onStatus: (order: OrderView, status: OrderStatus) => void;
  busy?: boolean;
}) {
  const { confirm } = useDialogs();
  return (
    <Sheet open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-md">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-heading text-xl">
                Order #{order.number} <TypeBadge type={order.type} />
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <StatusBadge status={order.status} />
                <SourceBadge source={order.source} />
                <span>{dateTime(order.createdAt)}</span>
                {order.promisedAt && <span>· promised {clock(order.promisedAt)}</span>}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <section className="space-y-1 text-sm">
                <p className="font-semibold">
                  {order.customerId ? (
                    <Link href={`/customers?open=${order.customerId}`} className="hover:underline">
                      {order.customerName}
                    </Link>
                  ) : (
                    order.customerName
                  )}
                </p>
                {order.customerPhone && <p className="text-muted-foreground">{phone(order.customerPhone)}</p>}
                {order.type === "delivery" && (
                  <p>
                    {order.address}
                    {order.deliveryNotes && <span className="block text-muted-foreground">Driver: {order.deliveryNotes}</span>}
                  </p>
                )}
              </section>

              <section>
                <OrderItems order={order} />
                {order.notes && (
                  <p className="mt-3 rounded-md bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                    {order.notes}
                  </p>
                )}
              </section>

              <section className="space-y-1 border-t pt-3 text-sm tabular-nums">
                {order.items.map((i) => (
                  <div key={i.id} className="flex justify-between text-muted-foreground">
                    <span>
                      {i.quantity} × {formatPence(i.unitPricePence)}
                    </span>
                    <span>{formatPence(i.quantity * i.unitPricePence)}</span>
                  </div>
                ))}
                {order.type === "delivery" && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Delivery</span>
                    <span>{order.deliveryFeePence ? formatPence(order.deliveryFeePence) : "Free"}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-base font-semibold text-foreground">
                  <span>Total (cash)</span>
                  <span>{formatPence(order.totalPence)}</span>
                </div>
              </section>

              <section className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Move to</p>
                <div className="flex flex-wrap gap-2">
                  {PATH[order.type].map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={order.status === s ? "default" : "outline"}
                      disabled={busy || order.status === s}
                      onClick={() => onStatus(order, s)}
                      className={cn(order.status === s && "pointer-events-none")}
                    >
                      {STATUS_LABEL[s]}
                    </Button>
                  ))}
                </div>
                {order.status !== "cancelled" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={async () => {
                      if (await confirm({ title: `Cancel order #${order.number}?`, body: "It comes off the board and out of tonight's takings.", confirmLabel: "Cancel order", cancelLabel: "Keep it", destructive: true }))
                        onStatus(order, "cancelled");
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" /> Cancel order
                  </Button>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
