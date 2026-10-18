"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  ClipboardList,
  FlaskConical,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Settings,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "@/components/providers/me-provider";
import { NAV_PAGES } from "@/lib/navigation";

/** Each page's icon; the pages themselves are in src/lib/navigation.ts. */
const ICONS: Record<string, typeof ClipboardList> = {
  "/orders": ClipboardList,
  "/customers": Users,
  "/calls": Phone,
  "/menu": UtensilsCrossed,
  "/receptionist": FlaskConical,
  "/settings": Settings,
};

/** The shop's mark: a red square with the first letter, like a stamp on the menu. */
export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-primary font-heading font-bold text-primary-foreground",
        size === "sm" ? "h-7 w-7 text-sm" : "h-9 w-9 text-base"
      )}
    >
      喜
    </span>
  );
}

export function Sidebar({
  open = false,
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  /** Drawer state below md. Ignored from md up, where the rail is static. */
  open?: boolean;
  onNavigate?: () => void;
  /** From md up: folded to a rail of icons. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const wide = collapsed ? "md:hidden" : "";
  const pathname = usePathname();
  const asOrg = useSearchParams().get("asOrg");
  const { data: session } = useSession();
  const me = useMe();
  // Nothing owner-only is shown until the role has loaded from the database.
  const isOwner = me?.role === "admin" || me?.role === "superAdmin";
  const pages = NAV_PAGES.filter((p) => !p.ownerOnly || isOwner);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform md:static md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
        collapsed ? "md:w-16" : "md:w-64"
      )}
    >
      <div className={cn("flex h-16 items-center gap-3 border-b border-sidebar-border px-4", collapsed && "md:justify-center md:px-0")}>
        <BrandMark />
        <div className={cn("min-w-0", wide)}>
          <p className="truncate font-heading text-[0.95rem] font-semibold">{me?.shopName ?? " "}</p>
          <p className="text-[11px] text-sidebar-foreground/60">Takeaway Counter</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {pages.map((p) => {
          const Icon = ICONS[p.href] ?? ClipboardList;
          const active = pathname === p.href || pathname?.startsWith(`${p.href}/`);
          return (
            <Link
              key={p.href}
              href={asOrg ? `${p.href}?asOrg=${encodeURIComponent(asOrg)}` : p.href}
              onClick={onNavigate}
              title={collapsed ? p.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-white/10 hover:text-sidebar-foreground",
                collapsed && "md:justify-center md:px-0"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={wide}>{p.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-sidebar-border p-3">
        <div className={cn("px-3 pb-2 text-xs text-sidebar-foreground/60", wide)}>
          <p className="truncate">{session?.user?.name || session?.user?.email}</p>
          <p>{me?.role === "member" ? "Counter staff" : me?.role === "superAdmin" ? "Super-admin" : me ? "Owner" : " "}</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-white/10 hover:text-sidebar-foreground",
            collapsed && "md:justify-center md:px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className={wide}>Sign out</span>
        </button>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            className={cn(
              "hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-white/10 hover:text-sidebar-foreground md:flex",
              collapsed && "md:justify-center md:px-0"
            )}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            <span className={wide}>Collapse</span>
          </button>
        )}
      </div>
    </aside>
  );
}
