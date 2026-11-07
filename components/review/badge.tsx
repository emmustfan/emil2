"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function ReviewBadge({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  useEffect(() => {
    let closed = false,
      running = false,
      queued = false;
    async function refresh() {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      do {
        queued = false;
        try {
          const r = await fetch("/api/review/queue?summary=1", {
            cache: "no-store",
          });
          if (r.ok) {
            const value = await r.json();
            if (!closed) setCount(value.dueCount);
          }
        } catch {}
      } while (queued && !closed);
      running = false;
    }
    window.addEventListener("srs:changed", refresh);
    return () => {
      closed = true;
      window.removeEventListener("srs:changed", refresh);
    };
  }, []);
  return (
    <Link
      href="/review"
      className="inline-flex min-h-11 items-center rounded-full bg-emerald-50 px-3 text-sm text-emerald-900"
      aria-label={`К повторению: ${count}`}
    >
      К повторению: <span className="ml-1 font-semibold">{count}</span>
    </Link>
  );
}
