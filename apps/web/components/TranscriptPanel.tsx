"use client";

import { useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import {
  TOPIC_TRANSCRIPT,
  transcriptEnvelope,
  type TranscriptEnvelope,
} from "@live-tutor/schema";

type TranscriptPanelProps = {
  room: Room | null;
};

const decoder = new TextDecoder();

export function TranscriptPanel({ room }: TranscriptPanelProps) {
  const [entries, setEntries] = useState<TranscriptEnvelope[]>([]);
  // Collapsed by default on phones (where the side panel would cover the
  // whole canvas). Open by default on tablets and up.
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!room) return;
    const handler = (
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic !== TOPIC_TRANSCRIPT) return;
      try {
        const env = transcriptEnvelope.parse(
          JSON.parse(decoder.decode(payload)),
        );
        // Coalesce rapid duplicates (Gemini sometimes streams partial then
        // final transcripts for the same utterance).
        setEntries((prev) => {
          const last = prev[prev.length - 1];
          if (
            last &&
            last.role === env.role &&
            env.timestamp - last.timestamp < 1500 &&
            (env.text.startsWith(last.text) || last.text.startsWith(env.text))
          ) {
            const next = prev.slice(0, -1);
            next.push(env);
            return next;
          }
          return [...prev, env];
        });
      } catch (err) {
        console.warn("[transcript] parse failed:", err);
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

  // Auto-scroll to the latest message.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? "Hide transcript" : "Show transcript"}
        className="pointer-events-auto absolute right-4 top-4 z-30 rounded-full border border-white/10 bg-black/60 px-3 py-2 text-xs font-medium text-white/80 shadow-lg backdrop-blur hover:bg-black/70"
      >
        {open ? "Hide transcript" : `Transcript (${entries.length})`}
      </button>

      <aside
        aria-label="Transcript"
        className={
          "pointer-events-auto absolute right-0 top-0 z-20 flex h-full w-full max-w-[20rem] flex-col border-l border-white/10 bg-black/85 backdrop-blur transition-transform duration-200 sm:bg-black/70 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-white/80">
            Transcript
          </h2>
          <span className="text-xs text-white/40">{entries.length} turns</span>
        </header>

        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto px-4 py-3 text-sm"
        >
          {entries.length === 0 ? (
            <p className="text-white/40">
              The conversation will appear here as you talk.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.map((e, i) => (
                <li key={`${e.timestamp}-${i}`} className="flex flex-col">
                  <span
                    className={
                      "text-[10px] uppercase tracking-wider " +
                      (e.role === "tutor"
                        ? "text-emerald-300/80"
                        : "text-sky-300/80")
                    }
                  >
                    {e.role === "tutor" ? "Tutor" : "You"}
                    {e.source === "text" && " · typed"}
                  </span>
                  <p className="mt-0.5 leading-snug text-white/85">{e.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
