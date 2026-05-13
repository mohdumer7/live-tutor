"use client";

import { useEffect, useState } from "react";

export type PointerTarget = {
  x: number; // screen px
  y: number; // screen px
  durationMs: number;
  // Used to force re-mount on rapid repeats so the animation always restarts.
  key: number;
};

type PointerOverlayProps = {
  target: PointerTarget | null;
};

export function PointerOverlay({ target }: PointerOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!target) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), target.durationMs);
    return () => clearTimeout(t);
  }, [target]);

  if (!target || !visible) return null;

  return (
    <div
      key={target.key}
      className="pointer-events-none absolute z-50"
      style={{ left: target.x, top: target.y, transform: "translate(-50%, -50%)" }}
    >
      <span className="block h-12 w-12 animate-ping rounded-full border-2 border-emerald-400/80" />
      <span className="absolute inset-0 m-auto block h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.85)]" />
    </div>
  );
}
