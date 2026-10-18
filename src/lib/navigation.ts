/**
 * The CRM's pages, in menu order, and who may open them. The sidebar and the
 * owner-page redirect both read this, so a page added here appears in the
 * menu and is protected in one go. Every API route still checks for itself.
 */

/** Where signing in lands: tonight's orders. */
export const START = "/orders";

export interface NavPage {
  href: string;
  label: string;
  /** The owner's (admin) only: counter staff don't see it. */
  ownerOnly?: boolean;
}

export const NAV_PAGES: NavPage[] = [
  { href: "/orders", label: "Orders" },
  { href: "/customers", label: "Customers" },
  { href: "/calls", label: "Calls & messages" },
  { href: "/menu", label: "Menu", ownerOnly: true },
  { href: "/receptionist", label: "Receptionist lab", ownerOnly: true },
  { href: "/settings", label: "Settings", ownerOnly: true },
];
