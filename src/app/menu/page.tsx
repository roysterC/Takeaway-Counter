"use client";

/**
 * The menu the receptionist sells from. Prices and dishes changed here are
 * on the next call; a dish switched off is "sold out tonight" and the
 * receptionist will apologise rather than take it.
 */

import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { useMe } from "@/components/providers/me-provider";
import { usePoll } from "@/lib/use-poll";
import { apiFetch } from "@/lib/api-fetch";
import { formatPence } from "@/lib/format";
import { normaliseName } from "@/lib/menu";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  pricePence: number;
  available: boolean;
  aliases: string[];
  categoryId: string;
}
interface Section {
  id: string;
  name: string;
  note: string | null;
  items: Item[];
}

type ItemDraft = { id?: string; categoryId: string; code: string; name: string; price: string; description: string; aliases: string };
type SectionDraft = { id?: string; name: string; note: string };

export default function MenuPage() {
  const { data, error, reload } = usePoll<{ sections: Section[] }>("/api/menu", 0);
  const { confirm, notify } = useDialogs();
  const isOwner = useMe()?.role !== "member";
  const [q, setQ] = useState("");
  const [item, setItem] = useState<ItemDraft | null>(null);
  const [section, setSection] = useState<SectionDraft | null>(null);

  const sections = useMemo(() => {
    const words = normaliseName(q).split(" ").filter(Boolean);
    if (!words.length) return data?.sections ?? [];
    return (data?.sections ?? [])
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => i.code?.toLowerCase() === q.trim().toLowerCase() || words.every((w) => normaliseName(i.name).includes(w))),
      }))
      .filter((s) => s.items.length);
  }, [data, q]);
  const soldOut = (data?.sections ?? []).flatMap((s) => s.items).filter((i) => !i.available).length;

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await apiFetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res?.ok) {
      notify((await res?.json().catch(() => null))?.error ?? "That didn't work.");
      return false;
    }
    reload();
    return true;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Menu"
        actions={
          isOwner && (
            <Button variant="outline" onClick={() => setSection({ name: "", note: "" })}>
              <Plus /> Add section
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish by number or name" className="pl-8" />
        </div>
        {soldOut > 0 && <span className="text-sm text-amber-800">{soldOut} sold out tonight</span>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && data.sections.length === 0 && (
        <div className="rounded-xl border bg-card">
          <EmptyState icon={UtensilsCrossed} title="No menu yet" hint="Run the seed script to load the menu, or add a section." />
        </div>
      )}

      <div className="space-y-5">
        {sections.map((s) => (
          <section key={s.id} className="overflow-hidden rounded-xl border bg-card shadow-surface">
            <header className="flex items-start gap-3 border-b bg-muted/40 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-base font-semibold">{s.name}</h2>
                {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
              </div>
              {isOwner && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setItem({ categoryId: s.id, code: "", name: "", price: "", description: "", aliases: "" })}>
                    <Plus /> Dish
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Edit section" onClick={() => setSection({ id: s.id, name: s.name, note: s.note ?? "" })}>
                    <Pencil />
                  </Button>
                </div>
              )}
            </header>
            <ul className="divide-y">
              {s.items.map((i) => (
                <li key={i.id} className={cn("flex items-center gap-3 px-4 py-2 text-sm", !i.available && "bg-stone-50")}>
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{i.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn(!i.available && "text-muted-foreground line-through")}>{i.name}</p>
                    {i.description && <p className="truncate text-xs text-muted-foreground">{i.description}</p>}
                  </div>
                  <span className="w-16 text-right tabular-nums">{formatPence(i.pricePence)}</span>
                  <button
                    type="button"
                    onClick={() => call(`/api/menu/items/${i.id}`, "PATCH", { available: !i.available })}
                    className={cn(
                      "w-24 shrink-0 rounded-md px-2 py-1 text-xs font-medium",
                      i.available ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-900 hover:bg-amber-200"
                    )}
                    title={i.available ? "Mark sold out tonight" : "Back on the menu"}
                  >
                    {i.available ? "Available" : "Sold out"}
                  </button>
                  {isOwner && (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${i.name}`}
                        onClick={() =>
                          setItem({
                            id: i.id,
                            categoryId: i.categoryId,
                            code: i.code ?? "",
                            name: i.name,
                            price: (i.pricePence / 100).toFixed(2),
                            description: i.description ?? "",
                            aliases: i.aliases.join(", "),
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${i.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Remove ${i.name}?`, body: "Past orders keep it. To take it off just for tonight, mark it sold out instead.", confirmLabel: "Remove", destructive: true }))
                            void call(`/api/menu/items/${i.id}`, "DELETE");
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <ItemDialog
        draft={item}
        sections={data?.sections ?? []}
        onClose={() => setItem(null)}
        onSave={async (d) => {
          const body = { categoryId: d.categoryId, code: d.code, name: d.name, price: d.price, description: d.description, aliases: d.aliases };
          const ok = d.id ? await call(`/api/menu/items/${d.id}`, "PATCH", body) : await call("/api/menu", "POST", { kind: "item", ...body });
          if (ok) setItem(null);
        }}
      />
      <SectionDialog
        draft={section}
        onClose={() => setSection(null)}
        onDelete={async (id) => {
          if (await confirm({ title: "Delete this section and all its dishes?", confirmLabel: "Delete", destructive: true })) {
            if (await call(`/api/menu/categories/${id}`, "DELETE")) setSection(null);
          }
        }}
        onSave={async (d) => {
          const ok = d.id
            ? await call(`/api/menu/categories/${d.id}`, "PATCH", { name: d.name, note: d.note })
            : await call("/api/menu", "POST", { kind: "category", name: d.name, note: d.note });
          if (ok) setSection(null);
        }}
      />
    </div>
  );
}

function ItemDialog({
  draft,
  sections,
  onClose,
  onSave,
}: {
  draft: ItemDraft | null;
  sections: Section[];
  onClose: () => void;
  onSave: (d: ItemDraft) => void;
}) {
  const [form, setForm] = useState<ItemDraft | null>(draft);
  const [shown, setShown] = useState<ItemDraft | null>(draft);
  // A new draft opened: start the form from it.
  if (draft !== shown) {
    setShown(draft);
    setForm(draft);
  }
  const set = (k: keyof ItemDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit dish" : "Add dish"}</DialogTitle>
        </DialogHeader>
        {form && (
          <div className="grid gap-3">
            <div className="grid grid-cols-[90px_1fr] gap-2">
              <Labelled label="Number">
                <Input value={form.code} onChange={set("code")} placeholder="65a" />
              </Labelled>
              <Labelled label="Name">
                <Input value={form.name} onChange={set("name")} />
              </Labelled>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Labelled label="Price (£)">
                <Input value={form.price} onChange={set("price")} inputMode="decimal" placeholder="7.60" />
              </Labelled>
              <Labelled label="Section">
                <select value={form.categoryId} onChange={set("categoryId")} className="h-8 rounded-lg border border-input bg-card px-2 text-sm">
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Labelled>
            </div>
            <Labelled label="Description (told to callers who ask)">
              <Textarea value={form.description} onChange={set("description")} rows={2} />
            </Labelled>
            <Labelled label="Other names callers use, separated by commas">
              <Input value={form.aliases} onChange={set("aliases")} placeholder="e.g. char siu fried rice" />
            </Labelled>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => form && onSave(form)} disabled={!form?.name.trim() || !form?.price.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionDialog({
  draft,
  onClose,
  onSave,
  onDelete,
}: {
  draft: SectionDraft | null;
  onClose: () => void;
  onSave: (d: SectionDraft) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<SectionDraft | null>(draft);
  const [shown, setShown] = useState<SectionDraft | null>(draft);
  if (draft !== shown) {
    setShown(draft);
    setForm(draft);
  }
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit section" : "Add section"}</DialogTitle>
        </DialogHeader>
        {form && (
          <div className="grid gap-3">
            <Labelled label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Labelled>
            <Labelled label="Note (told to the receptionist, e.g. 'Contains peanuts')">
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
            </Labelled>
          </div>
        )}
        <DialogFooter>
          {draft?.id && (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => onDelete(draft.id!)}>
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => form && onSave(form)} disabled={!form?.name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
