"use client";

import { useEffect, useRef } from "react";
import {
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  RoomEvent,
  Track,
} from "livekit-client";

type AudioRendererProps = {
  room: Room | null;
};

// LiveKit doesn't auto-play remote audio — every subscribed audio track has
// to be `track.attach()`-ed to an HTMLMediaElement that's kept alive so the
// browser keeps playing it. This component renders an invisible host element
// for each attached element and cleans up on unmount or unsubscribe.
export function AudioRenderer({ room }: AudioRendererProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef(new Map<string, HTMLMediaElement>());

  useEffect(() => {
    if (!room) return;

    const host = hostRef.current;
    if (!host) return;

    const attach = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const audioTrack = track as RemoteAudioTrack;
      const el = audioTrack.attach();
      el.autoplay = true;
      host.appendChild(el);
      elementsRef.current.set(track.sid ?? `${Math.random()}`, el);
      console.log("[audio] attached track", track.sid);
    };

    const detach = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const audioTrack = track as RemoteAudioTrack;
      audioTrack.detach().forEach((el) => el.remove());
      const sid = track.sid;
      if (sid) elementsRef.current.delete(sid);
      console.log("[audio] detached track", track.sid);
    };

    const onSubscribed = (
      track: RemoteTrack,
      _pub: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      attach(track);
    };

    const onUnsubscribed = (
      track: RemoteTrack,
      _pub: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      detach(track);
    };

    // Attach anything already subscribed (covers reconnects & late-mount races).
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track) attach(pub.track);
      });
    });

    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      const elements = elementsRef.current;
      elements.forEach((el) => el.remove());
      elements.clear();
    };
  }, [room]);

  return <div ref={hostRef} aria-hidden className="hidden" />;
}
