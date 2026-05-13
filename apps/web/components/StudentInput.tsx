"use client";

import { useState, type FormEvent } from "react";
import type { Room } from "livekit-client";
import { sendStudentMessage } from "@/lib/livekit";

type StudentInputProps = {
  room: Room | null;
};

const QUICK_ACTIONS: ReadonlyArray<{ label: string; message: string }> = [
  { label: "I'm stuck", message: "I'm stuck — can you help?" },
  {
    label: "Go slower",
    message: "Could you slow down and explain that part again?",
  },
  {
    label: "Show me again",
    message: "Can you show me that one more time?",
  },
  {
    label: "Practice problem",
    message: "Give me a practice problem on what we just covered.",
  },
];

export function StudentInput({ room }: StudentInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !room || sending;

  const sendText = async (value: string) => {
    if (!room) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    setError(null);
    setSending(true);
    try {
      await sendStudentMessage(room, trimmed);
      setText("");
    } catch (err) {
      console.error("[student-input] send failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void sendText(text);
  };

  return (
    <div className="pointer-events-auto flex w-full max-w-2xl flex-col items-stretch gap-2">
      <div className="hide-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 sm:flex-wrap sm:justify-center sm:overflow-visible">
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={disabled}
            onClick={() => void sendText(q.message)}
            className="shrink-0 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur transition-colors hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-40"
            title={q.message}
          >
            {q.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/70 px-3 py-2 shadow-xl backdrop-blur"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            room
              ? "Type a message to the tutor…"
              : "Connect to the room to chat"
          }
          disabled={disabled}
          className="flex-1 bg-transparent px-2 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
        {error && (
          <span className="ml-2 text-xs text-rose-300" title={error}>
            Send failed
          </span>
        )}
      </form>
    </div>
  );
}
