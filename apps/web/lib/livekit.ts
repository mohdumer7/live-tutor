"use client";

import { Room, RoomEvent } from "livekit-client";
import type { LessonConfig } from "@live-tutor/schema";

export type TokenResponse = {
  token: string;
  url: string;
  identity: string;
  roomName: string;
};

export async function fetchToken(input: {
  roomName: string;
  identity: string;
  name?: string;
  lessonConfig?: Partial<LessonConfig>;
}): Promise<TokenResponse> {
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `token request failed: ${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export type ConnectOptions = {
  roomName: string;
  identity: string;
  name?: string;
  publishMicrophone?: boolean;
  lessonConfig?: Partial<LessonConfig>;
};

export async function connectToRoom(opts: ConnectOptions): Promise<Room> {
  const { token, url } = await fetchToken({
    roomName: opts.roomName,
    identity: opts.identity,
    name: opts.name,
    lessonConfig: opts.lessonConfig,
  });

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      red: true,
      dtx: true,
    },
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    console.warn("[livekit] disconnected:", reason);
  });

  await room.connect(url, token);
  console.log("[livekit] connected as", room.localParticipant.identity);

  // Unlock audio playback now that we're inside a user-gesture-driven path.
  // Without this, browsers silently mute remote tracks on first attach.
  try {
    await room.startAudio();
  } catch (err) {
    console.warn("[livekit] startAudio failed:", err);
  }

  if (opts.publishMicrophone ?? true) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      console.log("[livekit] microphone enabled");
    } catch (err) {
      console.error("[livekit] microphone enable failed:", err);
      throw new Error(humanizeMicError(err));
    }
  }

  return room;
}

function humanizeMicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("denied") ||
    lower.includes("not allowed") ||
    lower.includes("permission")
  ) {
    return "Microphone permission was denied. Click the lock icon in the address bar, allow microphone access for this site, then refresh.";
  }
  if (lower.includes("notfound") || lower.includes("no audio")) {
    return "No microphone was found. Plug in or enable a mic and refresh.";
  }
  if (lower.includes("busy") || lower.includes("readable")) {
    return "Your microphone is in use by another app. Close it and refresh.";
  }
  return `Could not access microphone (${msg}).`;
}

// Module-scope room registry. Set by SessionRoom on connect / unset on
// disconnect. Lets non-React-tree consumers (custom tldraw shape utils,
// for example) reach into the LiveKit data channel without prop-drilling.
let activeRoom: Room | null = null;
export function setActiveRoom(room: Room | null): void {
  activeRoom = room;
}
export function getRoom(): Room | null {
  return activeRoom;
}

// Topic used by the data channel for student → agent text messages.
export const STUDENT_MESSAGE_TOPIC = "student_message";

const encoder = new TextEncoder();

export async function sendStudentMessage(
  room: Room,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const payload = encoder.encode(
    JSON.stringify({ type: "student_message", text: trimmed }),
  );
  await room.localParticipant.publishData(payload, {
    reliable: true,
    topic: STUDENT_MESSAGE_TOPIC,
  });
}

// Generate a per-tab participant identity that persists across reloads.
export function getOrCreateIdentity(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "live-tutor.identity";
  const existing = window.sessionStorage.getItem(KEY);
  if (existing) return existing;
  const fresh = `student-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(KEY, fresh);
  return fresh;
}
