"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Fetch JSON from the API now and every `intervalMs` after, while the tab is
 * visible. The orders board lives on this: a new phone order appears within
 * a few seconds without anyone pressing refresh. `reload` fetches at once,
 * after an action changes something.
 */
export function usePoll<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!url) return;
    const mine = ++seq.current;
    try {
      const res = await apiFetch(url);
      const body = await res.json().catch(() => null);
      // A slower, older request must not overwrite a newer one's answer.
      if (!live.current || mine !== seq.current) return;
      if (!res.ok) {
        setError(body?.error ?? `Couldn't load (${res.status})`);
        return;
      }
      setError(null);
      setData(body as T);
    } catch {
      if (live.current && mine === seq.current) setError("Can't reach the server. Retrying…");
    }
  }, [url]);

  useEffect(() => {
    live.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first fetch; its result arrives asynchronously
    void reload();
    if (!intervalMs) return () => void (live.current = false);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, intervalMs);
    return () => {
      live.current = false;
      clearInterval(t);
    };
  }, [reload, intervalMs]);

  return { data, error, reload, setData };
}
