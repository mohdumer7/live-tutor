"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  DEFAULT_PERSONA,
  DEFAULT_VOICE,
  PERSONA_OPTIONS,
  VOICE_OPTIONS,
  type PersonaId,
  type VoiceId,
} from "@live-tutor/schema";
import { RecentLessons } from "@/components/RecentLessons";

const SUBJECTS = ["Math", "Science", "English", "History", "Other"] as const;
const GRADES = ["5", "6", "7", "8", "9", "10", "11", "12"] as const;

const PREF_STORAGE_KEY = "live-tutor.prefs";

type StickyPrefs = {
  voice?: VoiceId;
  persona?: PersonaId;
};

function loadPrefs(): StickyPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StickyPrefs;
  } catch {
    return {};
  }
}

function savePrefs(prefs: StickyPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

function generateRoomId(): string {
  return `lesson-${Math.random().toString(36).slice(2, 10)}`;
}

export default function Home() {
  const router = useRouter();
  const initialPrefs = loadPrefs();
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]>("Math");
  const [grade, setGrade] = useState<(typeof GRADES)[number]>("8");
  const [topic, setTopic] = useState("");
  const [voice, setVoice] = useState<VoiceId>(
    initialPrefs.voice ?? DEFAULT_VOICE,
  );
  const [persona, setPersona] = useState<PersonaId>(
    initialPrefs.persona ?? DEFAULT_PERSONA,
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    savePrefs({ voice, persona });
    const params = new URLSearchParams();
    params.set("subject", subject);
    params.set("grade", grade);
    if (topic.trim()) params.set("topic", topic.trim());
    if (voice !== DEFAULT_VOICE) params.set("voice", voice);
    if (persona !== DEFAULT_PERSONA) params.set("persona", persona);
    const roomId = generateRoomId();
    router.push(`/session/${roomId}?${params.toString()}`);
  };

  return (
    <main className="flex min-h-screen items-start justify-center px-6 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">
          Live AI Tutor
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight text-white">
          Talk to a tutor that{" "}
          <span className="text-emerald-300">draws as it teaches</span>.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Live voice tutor with a shared whiteboard. Tell us what you'd like
          to work on and we'll start a fresh lesson.
        </p>

        <RecentLessons />

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/50">
              Subject
            </label>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubject(s)}
                  className={
                    "rounded-full border px-3 py-1.5 text-sm transition-colors " +
                    (subject === s
                      ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/50">
              Grade
            </label>
            <div className="flex flex-wrap gap-1.5">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={
                    "h-9 w-9 rounded-full border text-sm transition-colors " +
                    (grade === g
                      ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10")
                  }
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="topic"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/50"
            >
              Topic <span className="text-white/30">(optional)</span>
            </label>
            <input
              id="topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. quadratic formula, photosynthesis, the French Revolution"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
            />
          </div>

          <details className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wider text-white/60">
              Tutor style
            </summary>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  Voice
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {VOICE_OPTIONS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVoice(v.id)}
                      title={v.description}
                      className={
                        "rounded-full border px-3 py-1 text-xs transition-colors " +
                        (voice === v.id
                          ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10")
                      }
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  Personality
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PERSONA_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPersona(p.id)}
                      className={
                        "rounded-xl border px-3 py-2 text-left text-xs transition-colors " +
                        (persona === p.id
                          ? "border-emerald-400 bg-emerald-400/15 text-emerald-200"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10")
                      }
                    >
                      <span className="block font-medium">{p.label}</span>
                      <span className="mt-0.5 block text-[10px] text-white/45">
                        {p.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </details>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Start a lesson"}
          </button>
        </form>

        <p className="mt-6 text-xs text-white/40">
          The tutor only joins when the agent worker is running and your{" "}
          <code className="font-mono">.env</code> has LiveKit + Google keys.
        </p>
      </div>
    </main>
  );
}
