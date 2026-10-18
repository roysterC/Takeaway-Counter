/**
 * An order's life on the board, from "new" to "done". No database access, so
 * the screens can import it as well as the server.
 */

export const ORDER_STATUSES = ["new", "preparing", "ready", "out_for_delivery", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["phone", "counter", "lab"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Still in the kitchen or on its way: what the live board shows. */
export const ACTIVE_STATUSES: OrderStatus[] = ["new", "preparing", "ready", "out_for_delivery"];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Cooking",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Done",
  cancelled: "Cancelled",
};

/** The next step for an order, as the board's main button moves it on. */
export function nextStatus(type: string, status: string): OrderStatus | null {
  switch (status) {
    case "new":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return type === "delivery" ? "out_for_delivery" : "completed";
    case "out_for_delivery":
      return "completed";
    default:
      return null;
  }
}

/** What a caller is told when they ask where their order is. */
export function spokenStatus(type: string, status: string): string {
  switch (status) {
    case "new":
      return "it has been received and will be cooked shortly";
    case "preparing":
      return "it is being cooked now";
    case "ready":
      return type === "delivery" ? "it is cooked and waiting for the driver" : "it is ready to collect";
    case "out_for_delivery":
      return "it is out for delivery";
    case "completed":
      return type === "delivery" ? "it has been delivered" : "it has been collected";
    case "cancelled":
      return "it was cancelled";
    default:
      return "it is with the kitchen";
  }
}
