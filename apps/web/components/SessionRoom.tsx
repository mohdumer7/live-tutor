"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "tldraw";
import type { Room } from "livekit-client";
import {
  connectToRoom,
  getOrCreateIdentity,
  sendStudentMessage,
  setActiveRoom,
} from "@/lib/livekit";
import { wireCanvasDispatcher } from "@/lib/canvas-dispatcher";
import { wireSceneSync } from "@/lib/scene-sync";
import { loadLesson, wireLessonAutoSave } from "@/lib/lesson-store";
import { AgentPresenceHint } from "./AgentPresenceHint";
import { AudioRenderer } from "./AudioRenderer";
import { LabelOverlay } from "./LabelOverlay";
import { PageNavigator } from "./PageNavigator";
import { PointerOverlay, type PointerTarget } from "./PointerOverlay";
import { StatusBanner } from "./StatusBanner";
import { StudentInput } from "./StudentInput";
import { TranscriptPanel } from "./TranscriptPanel";
import { VoiceBar } from "./VoiceBar";

// tldraw must be client-only — `next/dynamic` with `ssr: false` keeps it out
// of the server bundle.
const TutorCanvas = dynamic(
  () => import("./TutorCanvas").then((m) => m.TutorCanvas),
  { ssr: false, loading: () => <CanvasFallback message="Loading canvas…" /> },
);

type LessonContext = {
  subject?: string;
  grade?: string;
  topic?: string;
  voice?: string;
  persona?: string;
};

type SessionRoomProps = {
  roomName: string;
  lesson?: LessonContext;
};

function lessonKickoff(lesson: LessonContext): string {
  const parts: string[] = [];
  if (lesson.grade) parts.push(`I'm in grade ${lesson.grade}`);
  if (lesson.subject) parts.push(`working on ${lesson.subject}`);
  if (lesson.topic) parts.push(`specifically ${lesson.topic}`);
  if (parts.length === 0) return "";
  return `Hi! ${parts.join(", ")}. Please tutor me through this.`;
}

type Status =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

export function SessionRoom({ roomName, lesson }: SessionRoomProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pointer, setPointer] = useState<PointerTarget | null>(null);
  const startedRef = useRef(false);
  const pointerKeyRef = useRef(0);
  const kickoffSentRef = useRef(false);

  const start = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus({ kind: "connecting" });
    try {
      const next = await connectToRoom({
        roomName,
        identity: getOrCreateIdentity(),
        lessonConfig: lesson
          ? {
              voice: lesson.voice as
                | "Puck"
                | "Charon"
                | "Kore"
                | "Fenrir"
                | "Aoede"
                | undefined,
              persona: lesson.persona as
                | "warm"
                | "strict"
                | "playful"
                | "socratic"
                | undefined,
              subject: lesson.subject,
              grade: lesson.grade,
              topic: lesson.topic,
            }
          : undefined,
      });
      setRoom(next);
      setActiveRoom(next);
      setStatus({ kind: "connected" });

      // If the lesson setup form provided context, fire it as the student's
      // first message. Wait briefly so the agent's greeting can land first
      // (better turn ordering than racing them).
      if (lesson && !kickoffSentRef.current) {
        const text = lessonKickoff(lesson);
        if (text) {
          kickoffSentRef.current = true;
          setTimeout(() => {
            void sendStudentMessage(next, text).catch((err) => {
              console.warn("[session] kickoff message failed:", err);
            });
          }, 1500);
        }
      }
    } catch (err) {
      console.error("[session] connect failed:", err);
      startedRef.current = false;
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Wire the canvas dispatcher, scene-sync, and lesson auto-save once both
  // `room` and `editor` are present. Either can land first; the effect
  // re-runs when either flips.
  useEffect(() => {
    if (!room || !editor) return;
    const cleanupDispatcher = wireCanvasDispatcher(room, editor, {
      onPointAt: ({ x, y, durationMs }) => {
        pointerKeyRef.current += 1;
        setPointer({ x, y, durationMs, key: pointerKeyRef.current });
      },
    });
    const cleanupSceneSync = wireSceneSync(room, editor);
    const cleanupAutoSave = wireLessonAutoSave(roomName, editor, {
      subject: lesson?.subject,
      grade: lesson?.grade,
      topic: lesson?.topic,
    });
    console.log("[session] dispatcher + scene-sync + auto-save wired");
    return () => {
      cleanupDispatcher();
      cleanupSceneSync();
      cleanupAutoSave();
    };
  }, [room, editor, roomName, lesson?.subject, lesson?.grade, lesson?.topic]);

  useEffect(() => {
    return () => {
      setActiveRoom(null);
      void room?.disconnect();
    };
  }, [room]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <TutorCanvas roomId={roomName} onMount={setEditor} />

      <AudioRenderer room={room} />
      <LabelOverlay editor={editor} />
      <PageNavigator editor={editor} />
      <PointerOverlay target={pointer} />

      <div className="pointer-events-none absolute inset-x-0 top-4 flex flex-col items-center gap-2">
        <VoiceBar room={room} />
        <StatusBanner room={room} />
      </div>

      <TranscriptPanel room={room} />

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4">
        <AgentPresenceHint room={room} />
        <StudentInput room={room} />
      </div>

      {status.kind !== "connected" && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#13131a] p-6 text-center shadow-2xl">
            <h1 className="text-xl font-semibold text-white/95">
              Live AI Tutor
            </h1>
            {lesson?.subject || lesson?.topic ? (
              <p className="mt-2 text-sm text-white/70">
                {lesson?.grade ? `Grade ${lesson.grade} · ` : ""}
                {lesson?.subject ?? ""}
                {lesson?.topic ? ` · ${lesson.topic}` : ""}
              </p>
            ) : (
              <p className="mt-2 text-sm text-white/60">
                Room{" "}
                <code className="font-mono text-white/80">{roomName}</code>
              </p>
            )}

            {status.kind === "idle" && (
              <button
                onClick={start}
                className="mt-6 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-medium text-black hover:bg-emerald-300"
              >
                Start session
              </button>
            )}

            {status.kind === "connecting" && (
              <p className="mt-6 text-sm text-white/70">Connecting…</p>
            )}

            {status.kind === "error" && (
              <>
                <p className="mt-6 text-sm text-rose-300">{status.message}</p>
                <button
                  onClick={start}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                >
                  Retry
                </button>
              </>
            )}

            <p className="mt-4 text-xs text-white/40">
              The tutor joins automatically when an agent worker is running and
              your <code className="font-mono">.env</code> has LiveKit + Google
              keys.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CanvasFallback({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e14] text-sm text-white/50">
      {message}
    </div>
  );
}
