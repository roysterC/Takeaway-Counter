"use client";

/**
 * Who is signed in, for the screens to shape themselves around, and the
 * redirect that keeps counter staff off the owner's pages.
 *
 * This is presentation only. Every API route decides for itself what a login
 * may see, so if this got something wrong the screen would show an error,
 * not something it shouldn't.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";
import { NAV_PAGES, START } from "@/lib/navigation";

export interface Me {
  role: string;
  name: string | null;
  email: string | null;
  shopName: string | null;
}

const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}

const OWNER_PAGES = NAV_PAGES.filter((p) => p.ownerOnly).map((p) => p.href);

export function isOwnerPage(path: string): boolean {
  return OWNER_PAGES.some((href) => path === href || path.startsWith(`${href}/`));
}

export function MeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const isPublic = pathname.startsWith("/login");

  useEffect(() => {
    if (status !== "authenticated" || isPublic) return;
    let live = true;
    apiFetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setMe(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [status, isPublic]);

  useEffect(() => {
    if (me?.role === "member" && !isPublic && isOwnerPage(pathname)) router.replace(START);
  }, [me, pathname, isPublic, router]);

  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}
