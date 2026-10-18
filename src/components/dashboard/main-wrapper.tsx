"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { BrandMark, Sidebar } from "@/components/dashboard/sidebar";
import { useMe } from "@/components/providers/me-provider";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useCollapsedNav();
  const me = useMe();

  // The login page: no sidebar, no padding, no chrome.
  if (pathname?.startsWith("/login")) return <>{children}</>;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Phones: the menu is a drawer behind this button. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BrandMark size="sm" />
        <span className="truncate font-heading text-[0.95rem] font-semibold">{me?.shopName ?? ""}</span>
      </header>

      <div className="flex min-h-0 w-full flex-1">
        {navOpen && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

        <Suspense fallback={<aside className={`hidden md:block ${collapsed ? "w-16" : "w-64"} shrink-0 bg-sidebar`} aria-hidden />}>
          <Sidebar
            open={navOpen}
            onNavigate={() => setNavOpen(false)}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
          />
        </Suspense>

        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

const COLLAPSED_KEY = "sidebar-collapsed";

/**
 * Whether the menu is folded to its icon rail, remembered in this browser.
 * Read after mount: the server has no storage, and storage can refuse
 * (private windows), so the menu simply starts open.
 */
function useCollapsedNav(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after mount
      if (window.localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // No storage: start open.
    }
  }, []);
  const set = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but still folded for this visit.
    }
  };
  return [collapsed, set];
}
