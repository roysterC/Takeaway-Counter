"use client";

/**
 * One customer: who they are, where they live, what they usually have, and
 * every order they have placed. Details are editable in place; the next
 * phone call from their number greets them with whatever is saved here.
 */

import { useCallback, useEffect, useState } from "react";
import { Phone, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { useMe } from "@/components/providers/me-provider";
import { StatusBadge, TypeBadge } from "@/components/orders/order-card";
import { apiFetch } from "@/lib/api-fetch";
import { dateTime, date, formatPence, phone } from "@/lib/format";
import type { OrderView } from "@/lib/order-view";

interface Detail {
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    town: string | null;
    postcode: string | null;
    deliveryNotes: string | null;
    notes: string | null;
    createdAt: string;
  };
  stats: { orders: number; spentPence: number; averagePence: number; favourites: Array<{ name: string; count: number }> };
  orders: OrderView[];
}

const FIELDS = [
  ["name", "Name"],
  ["phone", "Phone"],
  ["addressLine1", "Address"],
  ["addressLine2", "Address line 2"],
  ["town", "Town"],
  ["postcode", "Postcode"],
  ["deliveryNotes", "For the driver"],
] as const;

type Form = Record<(typeof FIELDS)[number][0] | "notes", string>;

export function CustomerSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, notify } = useDialogs();
  const isOwner = useMe()?.role !== "member";

  const load = useCallback(async () => {
    if (!id) return;
    const res = await apiFetch(`/api/customers/${id}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as Detail | null;
    if (!res?.ok || !data) return setError("Couldn't load this customer.");
    setDetail(data);
    const c = data.customer;
    setForm({
      name: c.name ?? "",
      phone: c.phone ? phone(c.phone) : "",
      addressLine1: c.addressLine1 ?? "",
      addressLine2: c.addressLine2 ?? "",
      town: c.town ?? "",
      postcode: c.postcode ?? "",
      deliveryNotes: c.deliveryNotes ?? "",
      notes: c.notes ?? "",
    });
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the last customer while the next loads
    setDetail(null);
    setError(null);
    void load();
  }, [load]);

  const save = async () => {
    if (!id || !form) return;
    setSaving(true);
    setError(null);
    const res = await apiFetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError((await res?.json().catch(() => null))?.error ?? "Couldn't save.");
    notify("Saved.");
    onChanged();
    void load();
  };

  const remove = async () => {
    if (!id || !detail) return;
    if (
      !(await confirm({
        title: `Delete ${detail.customer.name ?? "this customer"}?`,
        body: "Their past orders stay on record under the name they were placed with.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    const res = await apiFetch(`/api/customers/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return notify("Couldn't delete.");
    onChanged();
    onClose();
  };

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-heading text-xl">{detail?.customer.name ?? "Customer"}</SheetTitle>
          {detail && (
            <SheetDescription className="flex items-center gap-1.5">
              {detail.customer.phone && (
                <a href={`tel:${detail.customer.phone}`} className="flex items-center gap-1 hover:underline">
                  <Phone className="h-3 w-3" /> {phone(detail.customer.phone)}
                </a>
              )}
              <span>· customer since {date(detail.customer.createdAt)}</span>
            </SheetDescription>
          )}
        </SheetHeader>

        {detail && form && (
          <div className="space-y-6 px-4 pb-6">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Orders" value={String(detail.stats.orders)} />
              <Stat label="Spent" value={formatPence(detail.stats.spentPence)} />
              <Stat label="Average" value={formatPence(detail.stats.averagePence)} />
            </div>

            {detail.stats.favourites.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Usually has</h3>
                <div className="flex flex-wrap gap-1.5">
                  {detail.stats.favourites.map((f) => (
                    <span key={f.name} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                      {f.name} <span className="text-muted-foreground">×{f.count}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground">Details</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map(([key, label]) => (
                  <label key={key} className={`grid gap-1.5 ${key === "addressLine1" || key === "deliveryNotes" ? "sm:col-span-2" : ""}`}>
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                  </label>
                ))}
                <label className="grid gap-1.5 sm:col-span-2">
                  <span className="text-xs text-muted-foreground">Staff notes (never read out on the phone)</span>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </label>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex items-center gap-2">
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                {isOwner && (
                  <Button variant="ghost" className="ml-auto text-destructive" onClick={remove}>
                    <Trash2 /> Delete
                  </Button>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">Orders</h3>
              {detail.orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
              <ul className="divide-y rounded-lg border">
                {detail.orders.map((o) => (
                  <li key={o.id} className="space-y-1 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">#{o.number}</span>
                      <TypeBadge type={o.type} />
                      <StatusBadge status={o.status} />
                      <span className="ml-auto font-semibold tabular-nums">{formatPence(o.totalPence)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{dateTime(o.createdAt)}</p>
                    <p className="text-muted-foreground">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
        {!detail && error && <p className="px-4 text-sm text-red-600">{error}</p>}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-2 py-2.5">
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
