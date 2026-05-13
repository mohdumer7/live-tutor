"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ParticipantKind,
  type Participant,
  type Room,
  RoomEvent,
} from "livekit-client";

type AgentPresenceHintProps = {
  room: Room | null;
};

const TIMEOUT_MS = 30_000;

function isAgent(p: Participant): boolean {
  return (
    p.kind === ParticipantKind.AGENT ||
    p.identity.startsWith("agent-") ||
    p.identity.startsWith("AG_")
  );
}

/**
 * Renders a small floating notice above the input bar when the room is
 * connected but no agent participant has joined within 30 seconds. The most
 * common cause is that this room already used its dispatch slot earlier (for
 * a session that died or was abandoned), and LiveKit only dispatches one
 * agent per room. The fix is just to start a new lesson.
 */
export function AgentPresenceHint({ room }: AgentPresenceHintProps) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!room || dismissed) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const recompute = () => {
      let agentPresent = false;
      room.remoteParticipants.forEach((p) => {
        if (isAgent(p)) agentPresent = true;
      });
      if (agentPresent) {
        if (timer) clearTimeout(timer);
        timer = null;
        setShow(false);
        return;
      }
      if (timer) return;
      timer = setTimeout(() => setShow(true), TIMEOUT_MS);
    };

    recompute();
    room.on(RoomEvent.ParticipantConnected, recompute);
    room.on(RoomEvent.ParticipantDisconnected, recompute);
    return () => {
      if (timer) clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, recompute);
      room.off(RoomEvent.ParticipantDisconnected, recompute);
    };
  }, [room, dismissed]);

  if (!show || dismissed) return null;

  return (
    <div className="pointer-events-auto rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-xs text-amber-100 shadow-lg backdrop-blur">
      <p className="font-medium">Tutor hasn't joined this room.</p>
      <p className="mt-1 text-amber-100/70">
        This room may have already used its dispatch on a previous session.{" "}
        <Link
          href="/"
          className="underline decoration-dotted underline-offset-2 hover:text-amber-50"
        >
          Start a new lesson →
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="mt-2 text-[11px] text-amber-100/50 hover:text-amber-100"
      >
        Dismiss
      </button>
    </div>
  );
}
