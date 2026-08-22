"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MUTED } from "@/components/primitives";

/**
 * The sketch's `chip-row`. The selection is local and cosmetic: this build has
 * no filtering, but a chip row that cannot be pressed reads as broken, so the
 * highlight moves and nothing else happens.
 */
export default function ChipRow({
  items,
  active = 0,
  outlined = false,
}: {
  items: string[];
  active?: number;
  outlined?: boolean;
}) {
  const [current, setCurrent] = useState(active);

  return (
    <div className="flex gap-2 overflow-x-auto px-[var(--pad)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => setCurrent(i)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs transition",
            outlined
              ? "border border-[color:var(--border)]"
              : "bg-[var(--card)]",
            i === current
              ? "bg-[var(--accent)] font-medium text-white"
              : MUTED
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
