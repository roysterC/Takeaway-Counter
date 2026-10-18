"use client";

/**
 * An order taken at the counter or on the shop's own phone: the same order,
 * the same prices and the same board as the receptionist's, typed in by
 * staff. Type a regular's number and their name and address fill in.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bike, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { formatPence } from "@/lib/format";
import { normaliseName } from "@/lib/menu";
import { cn } from "@/lib/utils";

interface MenuItemRow {
  id: string;
  code: string | null;
  name: string;
  pricePence: number;
  available: boolean;
}
interface Section {
  id: string;
  name: string;
  items: MenuItemRow[];
}
interface Line {
  item: MenuItemRow;
  quantity: number;
  notes: string;
}

const EMPTY_CUSTOMER = { name: "", phone: "", addressLine1: "", addressLine2: "", town: "", postcode: "", deliveryNotes: "" };

export function NewOrderSheet({ open, onClose, onPlaced }: { open: boolean; onClose: () => void; onPlaced: (number: number) => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [type, setType] = useState<"collection" | "delivery">("collection");
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch("/api/menu")
      .then((r) => r.json())
      .then((d) => setSections(d.sections ?? []))
      .catch(() => setError("Couldn't load the menu."));
  }, [open]);

  const reset = () => {
    setType("collection");
    setCustomer(EMPTY_CUSTOMER);
    setLines([]);
    setNotes("");
    setSearch("");
    setError(null);
    setFound(null);
  };

  const all = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const byCode = all.filter((i) => i.code?.toLowerCase() === q);
    const words = normaliseName(q).split(" ").filter(Boolean);
    const byName = all.filter((i) => !byCode.includes(i) && words.every((w) => normaliseName(i.name).includes(w)));
    return [...byCode, ...byName].slice(0, 12);
  }, [search, all]);

  const subtotal = lines.reduce((s, l) => s + l.item.pricePence * l.quantity, 0);

  const add = (item: MenuItemRow) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.item.id === item.id && !l.notes);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { item, quantity: 1, notes: "" }];
    });
    setSearch("");
    searchRef.current?.focus();
  };

  /** A regular's number: fill in who they are and where they live. */
  const lookUp = async () => {
    const digits = customer.phone.replace(/\D/g, "");
    if (digits.length < 10) return;
    const res = await apiFetch(`/api/customers?q=${encodeURIComponent(digits)}`).catch(() => null);
    const data = await res?.json().catch(() => null);
    const match = data?.customers?.[0];
    if (!match) return setFound(null);
    const full = await apiFetch(`/api/customers/${match.id}`).then((r) => r.json()).catch(() => null);
    const c = full?.customer;
    if (!c) return;
    setFound(`${c.name ?? "Customer"}: ${full.stats.orders} order${full.stats.orders === 1 ? "" : "s"} before`);
    setCustomer((cur) => ({
      ...cur,
      name: cur.name || c.name || "",
      addressLine1: cur.addressLine1 || c.addressLine1 || "",
      addressLine2: cur.addressLine2 || c.addressLine2 || "",
      town: cur.town || c.town || "",
      postcode: cur.postcode || c.postcode || "",
      deliveryNotes: cur.deliveryNotes || c.deliveryNotes || "",
    }));
  };

  const place = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          customer,
          notes,
          lines: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, notes: l.notes })),
        }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Couldn't place the order.");
      onPlaced(data.order.number);
      reset();
      onClose();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof EMPTY_CUSTOMER) => (e: React.ChangeEvent<HTMLInputElement>) => setCustomer((c) => ({ ...c, [k]: e.target.value }));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="font-heading text-xl">New order</SheetTitle>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(["collection", "delivery"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium",
                    type === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
                  )}
                >
                  {t === "delivery" ? <Bike className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
                  {t === "delivery" ? "Delivery" : "Collection"}
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              <Field label="Phone">
                <Input value={customer.phone} onChange={set("phone")} onBlur={lookUp} placeholder="07700 900123" inputMode="tel" />
                {found && <p className="mt-1 text-xs text-emerald-700">{found}</p>}
              </Field>
              <Field label="Name">
                <Input value={customer.name} onChange={set("name")} />
              </Field>
              {type === "delivery" && (
                <>
                  <Field label="Address">
                    <Input value={customer.addressLine1} onChange={set("addressLine1")} placeholder="House number and street" />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Town">
                      <Input value={customer.town} onChange={set("town")} />
                    </Field>
                    <Field label="Postcode">
                      <Input value={customer.postcode} onChange={set("postcode")} className="uppercase" />
                    </Field>
                  </div>
                  <Field label="For the driver">
                    <Input value={customer.deliveryNotes} onChange={set("deliveryNotes")} placeholder="e.g. side door" />
                  </Field>
                </>
              )}
              <Field label="Kitchen note for the whole order">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. nut allergy" />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]?.available) {
                    e.preventDefault();
                    add(results[0]);
                  }
                }}
                placeholder="Number or dish, e.g. 65a or chow mein"
                className="pl-8"
              />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover shadow-raised">
                  {results.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={!i.available}
                        onClick={() => add(i)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                      >
                        <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{i.code}</span>
                        <span className="flex-1">{i.name}</span>
                        <span className="tabular-nums">{i.available ? formatPence(i.pricePence) : "Sold out"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border">
              {lines.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Search the menu to add dishes.</p>
              ) : (
                <ul className="divide-y">
                  {lines.map((l, i) => (
                    <li key={`${l.item.id}-${i}`} className="space-y-1.5 p-2.5">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">{l.item.code}</span>
                        <span className="min-w-0 flex-1">{l.item.name}</span>
                        <span className="tabular-nums">{formatPence(l.item.pricePence * l.quantity)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 pl-11">
                        <Button
                          size="icon-xs"
                          variant="outline"
                          aria-label="One fewer"
                          onClick={() =>
                            setLines((ls) => ls.flatMap((x, j) => (j !== i ? [x] : x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : [])))
                          }
                        >
                          {l.quantity > 1 ? <Minus /> : <Trash2 />}
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                        <Button size="icon-xs" variant="outline" aria-label="One more" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x)))}>
                          <Plus />
                        </Button>
                        <Input
                          value={l.notes}
                          onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                          placeholder="Note, e.g. no onions"
                          className="ml-1 h-7 text-xs"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Food {type === "delivery" ? "(delivery charge added when placed)" : ""}</span>
              <span className="text-lg font-semibold tabular-nums">{formatPence(subtotal)}</span>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="h-11 w-full" disabled={saving || !lines.length || !customer.name.trim()} onClick={place}>
              {saving ? "Placing…" : "Place order"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
