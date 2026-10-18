"use client";

/**
 * The shop's setup, the owner's only. Everything here shapes what the
 * receptionist says: the greeting, the hours it takes orders in, where it
 * delivers and for how much, and the notes it answers questions from.
 * Changes apply from the next call.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { apiFetch } from "@/lib/api-fetch";
import { WEEKDAYS, type DayHours } from "@/lib/hours";
import { parsePounds } from "@/lib/money";

interface Settings {
  businessName: string;
  greeting: string | null;
  voiceEnabled: boolean;
  acceptingOrders: boolean;
  contactPhone: string | null;
  address: string | null;
  openingHours: DayHours[];
  receptionistNotes: string | null;
  collectionMinutes: number;
  deliveryMinutes: number;
  deliveryEnabled: boolean;
  deliveryZones: Array<{ name: string; prefixes: string[]; feePence: number }>;
  minDeliveryPence: number;
  freeDeliveryOverPence: number | null;
  phoneNumbers: string[];
}

/** The form keeps money and lists as the owner types them, and converts on save. */
interface Form {
  businessName: string;
  greeting: string;
  voiceEnabled: boolean;
  contactPhone: string;
  address: string;
  openingHours: DayHours[];
  receptionistNotes: string;
  collectionMinutes: string;
  deliveryMinutes: string;
  deliveryEnabled: boolean;
  zones: Array<{ name: string; prefixes: string; fee: string }>;
  minDelivery: string;
  freeOver: string;
  phoneNumbers: string;
}

const pounds = (p: number) => (p / 100).toFixed(2);

function toForm(s: Settings): Form {
  return {
    businessName: s.businessName,
    greeting: s.greeting ?? "",
    voiceEnabled: s.voiceEnabled,
    contactPhone: s.contactPhone ?? "",
    address: s.address ?? "",
    openingHours: s.openingHours,
    receptionistNotes: s.receptionistNotes ?? "",
    collectionMinutes: String(s.collectionMinutes),
    deliveryMinutes: String(s.deliveryMinutes),
    deliveryEnabled: s.deliveryEnabled,
    zones: s.deliveryZones.map((z) => ({ name: z.name, prefixes: z.prefixes.join(", "), fee: pounds(z.feePence) })),
    minDelivery: pounds(s.minDeliveryPence),
    freeOver: s.freeDeliveryOverPence === null ? "" : pounds(s.freeDeliveryOverPence),
    phoneNumbers: s.phoneNumbers.join(", "),
  };
}

export default function SettingsPage() {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { notify } = useDialogs();

  useEffect(() => {
    apiFetch("/api/settings")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setForm(toForm(d));
      })
      .catch((e) => setError(e instanceof Error && e.message ? e.message : "Couldn't load the settings."));
  }, []);

  if (!form) return <div className="space-y-6"><PageHeader title="Settings" />{error && <p className="text-sm text-red-600">{error}</p>}</div>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setDay = (day: number, patch: Partial<DayHours>) =>
    set("openingHours", form.openingHours.map((d) => (d.day === day ? { ...d, ...patch } : d)));

  const save = async () => {
    setError(null);
    const money = (label: string, v: string) => {
      const p = parsePounds(v);
      if (p === null) throw new Error(`${label}: enter an amount like 2.50`);
      return p;
    };
    let body: Record<string, unknown>;
    try {
      body = {
        businessName: form.businessName,
        greeting: form.greeting,
        voiceEnabled: form.voiceEnabled,
        contactPhone: form.contactPhone,
        address: form.address,
        openingHours: form.openingHours,
        receptionistNotes: form.receptionistNotes,
        collectionMinutes: Number(form.collectionMinutes),
        deliveryMinutes: Number(form.deliveryMinutes),
        deliveryEnabled: form.deliveryEnabled,
        deliveryZones: form.zones.map((z) => ({
          name: z.name,
          prefixes: z.prefixes.split(",").map((p) => p.trim()).filter(Boolean),
          feePence: money(`Fee for ${z.name || "a zone"}`, z.fee),
        })),
        minDeliveryPence: money("Minimum delivery order", form.minDelivery),
        freeDeliveryOverPence: form.freeOver.trim() ? money("Free delivery over", form.freeOver) : null,
        phoneNumbers: form.phoneNumbers.split(",").map((n) => n.trim()).filter(Boolean),
      };
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(true);
    const res = await apiFetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError((await res?.json().catch(() => null))?.error ?? "Couldn't save.");
    notify("Settings saved. The receptionist uses them from the next call.");
  };

  return (
    <div className="max-w-4xl space-y-6 pb-24">
      <PageHeader title="Settings" />

      <Panel title="The shop">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name the receptionist answers with">
            <Input value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />
          </Field>
          <Field label="Shop phone number">
            <Input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
          </Field>
          <Field label="Address" wide>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="The receptionist">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.voiceEnabled} onChange={(e) => set("voiceEnabled", e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          Answer the phone with the receptionist
        </label>
        <Field label="Greeting (blank for the standard one)">
          <Input
            value={form.greeting}
            onChange={(e) => set("greeting", e.target.value)}
            placeholder={`Hello, it's ${form.businessName}. Is it for collection or delivery?`}
          />
        </Field>
        <Field label="Twilio number(s) callers ring, separated by commas">
          <Input value={form.phoneNumbers} onChange={(e) => set("phoneNumbers", e.target.value)} placeholder="+44 1889 000000" />
        </Field>
        <Field label="What the receptionist knows about the shop: payment, allergies, parking, bank holidays…">
          <Textarea value={form.receptionistNotes} onChange={(e) => set("receptionistNotes", e.target.value)} rows={8} />
        </Field>
      </Panel>

      <Panel title="Opening hours">
        <p className="text-xs text-muted-foreground">The receptionist only takes orders while the shop is open. It tells callers outside these hours when you next open.</p>
        <div className="divide-y rounded-lg border">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const d = form.openingHours.find((h) => h.day === day)!;
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 font-medium">{WEEKDAYS[day]}</span>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!d.closed} onChange={(e) => setDay(day, { closed: !e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
                  Open
                </label>
                {!d.closed && (
                  <span className="flex items-center gap-2">
                    <Input type="time" value={d.open} onChange={(e) => setDay(day, { open: e.target.value })} className="w-28" />
                    to
                    <Input type="time" value={d.close} onChange={(e) => setDay(day, { close: e.target.value })} className="w-28" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Wait times">
        <p className="text-xs text-muted-foreground">What callers are quoted. Staff can turn these up and down from the Orders screen during service.</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="Collection (minutes)">
            <Input type="number" min={5} max={180} value={form.collectionMinutes} onChange={(e) => set("collectionMinutes", e.target.value)} />
          </Field>
          <Field label="Delivery (minutes)">
            <Input type="number" min={5} max={180} value={form.deliveryMinutes} onChange={(e) => set("deliveryMinutes", e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Delivery">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.deliveryEnabled} onChange={(e) => set("deliveryEnabled", e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          Offer delivery
        </label>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="Minimum order for delivery (£)">
            <Input value={form.minDelivery} onChange={(e) => set("minDelivery", e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Free delivery over (£, blank for never)">
            <Input value={form.freeOver} onChange={(e) => set("freeOver", e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Zones match the start of a postcode. The longest match wins, so &quot;ST18 0&quot; (Hixon) beats &quot;ST18&quot; (nearby villages). Postcodes in no zone are not delivered to.
          </p>
          <div className="divide-y rounded-lg border">
            {form.zones.map((z, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_90px_auto] items-center gap-2 px-3 py-2">
                <Input value={z.name} onChange={(e) => set("zones", form.zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Zone name" />
                <Input value={z.prefixes} onChange={(e) => set("zones", form.zones.map((x, j) => (j === i ? { ...x, prefixes: e.target.value } : x)))} placeholder="ST18 0, ST18 1" />
                <Input value={z.fee} onChange={(e) => set("zones", form.zones.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))} placeholder="£" inputMode="decimal" />
                <Button size="icon-sm" variant="ghost" aria-label="Remove zone" onClick={() => set("zones", form.zones.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => set("zones", [...form.zones, { name: "", prefixes: "", fee: "" }])}>
            <Plus /> Add zone
          </Button>
        </div>
      </Panel>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="ml-auto" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-surface">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`grid gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
