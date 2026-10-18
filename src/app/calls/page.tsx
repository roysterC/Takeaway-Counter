"use client";

/**
 * What came in on the phone: every call the receptionist answered and what it
 * came to, and the messages callers left for the staff (complaints, allergy
 * questions, changes to an order already placed). Messages waiting on someone
 * are at the top until they are ticked off.
 */

import Link from "next/link";
import { Check, MessageSquare, Phone, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { usePoll } from "@/lib/use-poll";
import { apiFetch } from "@/lib/api-fetch";
import { dateTime, duration, formatPence, phone } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Data {
  calls: Array<{
    id: string;
    phoneNumber: string;
    outcomes: string[];
    duration: number;
    createdAt: string;
    customer: { id: string; name: string | null } | null;
    order: { id: string; number: number; totalPence: number; type: string } | null;
  }>;
  messages: Array<{ id: string; name: string | null; phone: string | null; body: string; handled: boolean; createdAt: string }>;
}

const OUTCOME: Record<string, { label: string; style: string }> = {
  ordered: { label: "Ordered", style: "bg-emerald-100 text-emerald-800" },
  order_status: { label: "Checked an order", style: "bg-sky-100 text-sky-800" },
  message: { label: "Left a message", style: "bg-amber-100 text-amber-900" },
  enquiry: { label: "Enquiry", style: "bg-stone-100 text-stone-700" },
  hung_up: { label: "Hung up", style: "bg-stone-100 text-stone-500" },
};

export default function CallsPage() {
  const { data, error, reload } = usePoll<Data>("/api/calls", 15000);
  const { notify } = useDialogs();
  const open = data?.messages.filter((m) => !m.handled) ?? [];
  const done = data?.messages.filter((m) => m.handled) ?? [];

  const mark = async (id: string, handled: boolean) => {
    const res = await apiFetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handled }),
    }).catch(() => null);
    if (!res?.ok) notify("Couldn't update the message.");
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Calls & messages" />
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold">
          Messages to deal with <span className="text-muted-foreground tabular-nums">{open.length}</span>
        </h2>
        {data && open.length === 0 && (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing waiting. Messages callers leave for the staff appear here.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...open, ...done.slice(0, 6)].map((m) => (
            <article key={m.id} className={cn("space-y-2 rounded-xl border bg-card p-4 shadow-surface", m.handled && "opacity-60")}>
              <div className="flex items-start gap-2">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{m.name ?? "Caller"}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.phone ? (
                      <a href={`tel:${m.phone}`} className="hover:underline">
                        {phone(m.phone)}
                      </a>
                    ) : (
                      "No number"
                    )}{" "}
                    · {dateTime(m.createdAt)}
                  </p>
                </div>
              </div>
              <p className="whitespace-pre-line text-sm">{m.body}</p>
              <Button size="sm" variant={m.handled ? "ghost" : "outline"} onClick={() => mark(m.id, !m.handled)}>
                {m.handled ? <RotateCcw /> : <Check />}
                {m.handled ? "Not done" : "Done"}
              </Button>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-base font-semibold">Calls</h2>
        <div className="overflow-x-auto rounded-xl border bg-card shadow-surface">
          {data && data.calls.length === 0 ? (
            <EmptyState icon={Phone} title="No calls yet" hint="Every call the receptionist answers is listed here with what it came to. Nothing that was said is kept." />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Caller</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 text-right font-medium">Length</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.calls.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2.5 text-muted-foreground">{dateTime(c.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      {c.customer ? (
                        <Link href={`/customers?open=${c.customer.id}`} className="font-medium hover:underline">
                          {c.customer.name ?? phone(c.phoneNumber)}
                        </Link>
                      ) : (
                        <span>{c.phoneNumber === "Withheld" ? "Withheld" : phone(c.phoneNumber)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.outcomes.map((o) => (
                          <span key={o} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", OUTCOME[o]?.style)}>
                            {OUTCOME[o]?.label ?? o}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {c.order ? `#${c.order.number} · ${formatPence(c.order.totalPence)}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{duration(c.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
