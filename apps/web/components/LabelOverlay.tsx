"use client";

import { useEffect, useState } from "react";
import type { Editor, TLShape } from "tldraw";

type LabelOverlayProps = {
  editor: Editor | null;
};

type Badge = {
  id: string;
  label: string;
  x: number; // screen px
  y: number; // screen px
};

// 200ms (5fps) is plenty for label badge positioning; 80ms was overkill and
// added unnecessary CPU churn during pan/zoom.
const POLL_MS = 200;

/**
 * Renders a small floating tag above any shape whose `meta.label` is set.
 * Listens to store + camera changes (debounced via interval) so positions stay
 * pinned during pan/zoom or shape moves.
 */
export function LabelOverlay({ editor }: LabelOverlayProps) {
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    if (!editor) return;

    const refresh = () => {
      const next: Badge[] = [];
      for (const shape of editor.getCurrentPageShapes() as TLShape[]) {
        const meta = shape.meta as { label?: unknown } | undefined;
        if (typeof meta?.label !== "string" || meta.label.length === 0)
          continue;
        const bounds = editor.getShapePageBounds(shape.id);
        if (!bounds) continue;
        const screen = editor.pageToScreen({ x: bounds.x, y: bounds.y });
        next.push({
          id: shape.id,
          label: meta.label,
          x: screen.x,
          y: screen.y,
        });
      }
      setBadges(next);
    };

    refresh();

    // The store emits for shape changes; polling at ~12fps catches camera
    // changes (camera lives outside the document store) cheaply.
    const cleanup = editor.store.listen(refresh, { scope: "document" });
    const interval = setInterval(refresh, POLL_MS);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {badges.map((b) => (
        <div
          key={b.id}
          style={{ left: b.x, top: b.y - 6, transform: "translate(-2px, -100%)" }}
          className="absolute rounded-md border border-emerald-400/30 bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black shadow-lg"
        >
          {b.label}
        </div>
      ))}
    </div>
  );
}
