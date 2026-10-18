"use client";

/**
 * Everyone who orders. A customer is made the first time they order with a
 * number, by phone or at the counter, and kept up to date by every order
 * after: the receptionist greets a returning caller by the name and address
 * saved here.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerSheet } from "@/components/customers/customer-sheet";
import { usePoll } from "@/lib/use-poll";
import { apiFetch } from "@/lib/api-fetch";
import { ago, formatPence, phone } from "@/lib/format";

interface Row {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  orders: number;
  spentPence: number;
  lastOrderAt: string | null;
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <Customers />
    </Suspense>
  );
}

function Customers() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const openId = params.get("open");
  const { data, error, reload } = usePoll<{ customers: Row[] }>(`/api/customers?q=${encodeURIComponent(query)}`, 0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const open = (id: string | null) => router.replace(id ? `/customers?open=${id}` : "/customers");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add customer
          </Button>
        }
      />
      <div className="relative w-full max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, street or postcode" className="pl-8" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-surface">
        {data && data.customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query ? "Nobody matches that" : "No customers yet"}
            hint={query ? undefined : "Customers are added the first time they order with a phone number."}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Spent</th>
                <th className="px-3 py-2 font-medium">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data?.customers.map((c) => (
                <tr key={c.id} onClick={() => open(c.id)} className="cursor-pointer hover:bg-accent/50">
                  <td className="px-3 py-2.5 font-medium">{c.name ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{phone(c.phone)}</td>
                  <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">{c.address ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{c.orders}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatPence(c.spentPence)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.lastOrderAt ? ago(c.lastOrderAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CustomerSheet id={openId} onClose={() => open(null)} onChanged={reload} />
      <AddCustomer
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setAdding(false);
          reload();
          open(id);
        }}
      />
    </div>
  );
}

function AddCustomer({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const [form, setForm] = useState({ name: "", phone: "", addressLine1: "", town: "", postcode: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await apiFetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError(data?.error ?? "Couldn't add the customer.");
    setForm({ name: "", phone: "", addressLine1: "", town: "", postcode: "" });
    onAdded(data.id);
  };
  const field = (key: keyof typeof form, label: string) => (
    <label className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {field("name", "Name")}
          {field("phone", "Phone")}
          {field("addressLine1", "Address")}
          <div className="grid grid-cols-2 gap-2">
            {field("town", "Town")}
            {field("postcode", "Postcode")}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
