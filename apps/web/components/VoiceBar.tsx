"use client";

import { useEffect, useState } from "react";
import {
  ConnectionState,
  type Participant,
  ParticipantKind,
  type Room,
  RoomEvent,
} from "livekit-client";

type VoiceBarProps = {
  room: Room | null;
};

type ParticipantState = {
  identity: string;
  speaking: boolean;
  isAgent: boolean;
};

function isAgent(p: Participant): boolean {
  return (
    p.kind === ParticipantKind.AGENT ||
    p.identity.startsWith("agent-") ||
    p.identity.startsWith("AG_") // LiveKit Agents v1.x default identity prefix
  );
}

export function VoiceBar({ room }: VoiceBarProps) {
  const [connection, setConnection] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [remotes, setRemotes] = useState<ParticipantState[]>([]);
  const [micActive, setMicActive] = useState(false);

  useEffect(() => {
    if (!room) return;

    const refresh = () => {
      setConnection(room.state);
      setMicActive(room.localParticipant.isMicrophoneEnabled);
      const next: ParticipantState[] = [];
      room.remoteParticipants.forEach((p) => {
        next.push({
          identity: p.identity,
          speaking: p.isSpeaking,
          isAgent: isAgent(p),
        });
      });
      setRemotes(next);
    };

    refresh();

    room
      .on(RoomEvent.ConnectionStateChanged, refresh)
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh);

    return () => {
      room
        .off(RoomEvent.ConnectionStateChanged, refresh)
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.ActiveSpeakersChanged, refresh)
        .off(RoomEvent.LocalTrackPublished, refresh)
        .off(RoomEvent.LocalTrackUnpublished, refresh)
        .off(RoomEvent.TrackMuted, refresh)
        .off(RoomEvent.TrackUnmuted, refresh);
    };
  }, [room]);

  const label =
    connection === ConnectionState.Connected
      ? "Connected"
      : connection === ConnectionState.Connecting
        ? "Connecting…"
        : connection === ConnectionState.Reconnecting
          ? "Reconnecting…"
          : "Disconnected";

  const agent = remotes.find((p) => p.isAgent);

  const toggleMic = async () => {
    if (!room || connection !== ConnectionState.Connected) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!micActive);
    } catch (err) {
      console.error("[voicebar] mic toggle failed:", err);
    }
  };

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-sm shadow-lg backdrop-blur">
      <span
        className={
          "inline-block h-2 w-2 rounded-full " +
          (connection === ConnectionState.Connected
            ? "bg-emerald-400"
            : connection === ConnectionState.Connecting ||
                connection === ConnectionState.Reconnecting
              ? "bg-amber-300 animate-pulse"
              : "bg-rose-400")
        }
      />
      <span className="text-white/80">{label}</span>
      <span className="mx-1 h-3 w-px bg-white/10" />
      <button
        type="button"
        onClick={toggleMic}
        disabled={!room || connection !== ConnectionState.Connected}
        title={micActive ? "Mute microphone" : "Unmute microphone"}
        className={
          "rounded-full px-3 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
          (micActive
            ? "bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
            : "bg-rose-400/15 text-rose-300 hover:bg-rose-400/25")
        }
      >
        {micActive ? "🎙 Mic on" : "🔇 Mic off"}
      </button>
      <span className="mx-1 h-3 w-px bg-white/10" />
      <span
        className={
          "rounded-full px-2 py-0.5 text-xs " +
          (agent?.speaking
            ? "bg-sky-400/20 text-sky-200"
            : agent
              ? "bg-white/5 text-white/70"
              : "bg-white/5 text-white/40")
        }
      >
        Tutor {agent ? (agent.speaking ? "speaking" : "listening") : "offline"}
      </span>
    </div>
  );
}
