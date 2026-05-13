"use client";

import { useEffect, useState } from "react";
import type { Room } from "livekit-client";
import {
  TOPIC_AGENT_STATE,
  agentStateEnvelope,
  type AgentState,
  type AgentStateEnvelope,
} from "@live-tutor/schema";

type StatusBannerProps = {
  room: Room | null;
};

const decoder = new TextDecoder();

const LABELS: Record<AgentState, { label: string; tone: string }> = {
  idle: { label: "Ready", tone: "bg-white/5 text-white/40" },
  listening: {
    label: "Listening…",
    tone: "bg-sky-400/20 text-sky-200",
  },
  thinking: {
    label: "Thinking…",
    tone: "bg-amber-300/20 text-amber-200",
  },
  speaking: {
    label: "Speaking",
    tone: "bg-emerald-400/20 text-emerald-200",
  },
  drawing: {
    label: "Drawing",
    tone: "bg-indigo-400/20 text-indigo-200",
  },
  generating_image: {
    label: "Generating image…",
    tone: "bg-fuchsia-400/20 text-fuchsia-200",
  },
  looking: {
    label: "Looking at canvas…",
    tone: "bg-violet-400/20 text-violet-200",
  },
};

export function StatusBanner({ room }: StatusBannerProps) {
  const [current, setCurrent] = useState<AgentStateEnvelope | null>(null);

  useEffect(() => {
    if (!room) return;
    const handler = (
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic !== TOPIC_AGENT_STATE) return;
      try {
        const env = agentStateEnvelope.parse(
          JSON.parse(decoder.decode(payload)),
        );
        setCurrent(env);
      } catch (err) {
        console.warn("[status] parse failed:", err);
      }
    };
    room.on(
      "dataReceived" as Parameters<Room["on"]>[0],
      handler as unknown as Parameters<Room["on"]>[1],
    );
    return () => {
      room.off(
        "dataReceived" as Parameters<Room["off"]>[0],
        handler as unknown as Parameters<Room["off"]>[1],
      );
    };
  }, [room]);

  // Don't render the banner for idle state — keeps the canvas clean when
  // nothing's happening.
  if (!current || current.state === "idle") return null;

  const meta = LABELS[current.state];

  return (
    <div
      className={
        "pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs shadow-lg backdrop-blur " +
        meta.tone
      }
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
      <span>{meta.label}</span>
      {current.detail && (
        <span className="max-w-[14rem] truncate text-white/50">
          {current.detail}
        </span>
      )}
    </div>
  );
}
