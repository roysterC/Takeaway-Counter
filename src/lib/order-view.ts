/**
 * An order as the CRM screens get it. One shape for the live board, the
 * history and a customer's past orders, so they cannot drift apart.
 */

import type { Prisma } from "@/generated/prisma/client";

export const ORDER_INCLUDE = {
  items: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export interface OrderView {
  id: string;
  number: number;
  type: string;
  status: string;
  source: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  deliveryNotes: string | null;
  notes: string | null;
  subtotalPence: number;
  deliveryFeePence: number;
  totalPence: number;
  paymentMethod: string;
  promisedAt: string | null;
  createdAt: string;
  items: Array<{ id: string; code: string | null; name: string; quantity: number; unitPricePence: number; notes: string | null }>;
}

export function orderView(o: OrderRow): OrderView {
  return {
    id: o.id,
    number: o.number,
    type: o.type,
    status: o.status,
    source: o.source,
    customerId: o.customerId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: [o.addressLine1, o.addressLine2, o.town, o.postcode].filter(Boolean).join(", ") || null,
    deliveryNotes: o.deliveryNotes,
    notes: o.notes,
    subtotalPence: o.subtotalPence,
    deliveryFeePence: o.deliveryFeePence,
    totalPence: o.totalPence,
    paymentMethod: o.paymentMethod,
    promisedAt: o.promisedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      quantity: i.quantity,
      unitPricePence: i.unitPricePence,
      notes: i.notes,
    })),
  };
}
