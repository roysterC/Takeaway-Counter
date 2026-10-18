/**
 * One line in the call log per call our receptionist answers: who rang, when,
 * for how long, what it came to, and the order it produced. Nothing of what
 * was said is kept.
 *
 * Lab calls are never logged: they are tests, not customers. The phone line
 * calls this when a call ends.
 */

import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";
import type { CallOutcome } from "./outcomes";

export async function logCall(
  organizationId: string,
  call: { callerNumber: string | null; startedAt: Date; endedAt: Date; outcomes: CallOutcome[]; orderId: string | null }
): Promise<void> {
  const phone = normalisePhone(call.callerNumber ?? undefined);
  const customer = phone.ok
    ? await prisma.customer.findUnique({
        where: { organizationId_phone: { organizationId, phone: phone.e164 } },
        select: { id: true },
      })
    : null;
  await prisma.call.create({
    data: {
      organizationId,
      phoneNumber: phone.ok ? phone.e164 : "Withheld",
      duration: Math.max(0, Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)),
      outcomes: call.outcomes,
      customerId: customer?.id ?? null,
      orderId: call.orderId,
      createdAt: call.startedAt,
    },
  });
}
