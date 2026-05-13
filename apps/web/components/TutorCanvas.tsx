"use client";

import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import { tutorShapeUtils } from "./shapes";
import { loadLesson } from "@/lib/lesson-store";

// Self-host tldraw fonts/icons under /tldraw-assets/ instead of cdn.tldraw.com.
// (DNS-level blocks of the CDN otherwise leave the canvas without fonts and
// produce ERR_NAME_NOT_RESOLVED for every asset. Bundler-import-based
// helpers in @tldraw/assets don't play nicely with Turbopack's asset
// loader, so we ship them as static files in apps/web/public/.)
const localAssetUrls = getAssetUrls({ baseUrl: "/tldraw-assets" });

type TutorCanvasProps = {
  // Optional room id used to look up a saved snapshot to restore on mount.
  roomId?: string;
  onMount?: (editor: Editor) => void;
};

export function TutorCanvas({ roomId, onMount }: TutorCanvasProps) {
  return (
    <div className="absolute inset-0">
      <Tldraw
        shapeUtils={tutorShapeUtils}
        assetUrls={localAssetUrls}
        onMount={(editor) => {
          // If we have a previously-saved snapshot for this room, restore it
          // BEFORE handing the editor to the parent, so scene-sync doesn't
          // publish an empty scene to the agent first.
          if (roomId) {
            const saved = loadLesson(roomId);
            if (saved?.snapshot) {
              try {
                editor.loadSnapshot(
                  saved.snapshot as Parameters<Editor["loadSnapshot"]>[0],
                );
                console.log(
                  `[tutor-canvas] restored saved lesson for ${roomId}`,
                );
              } catch (err) {
                console.warn(
                  "[tutor-canvas] snapshot restore failed:",
                  err,
                );
              }
            }
          }

          // Tablet polish: when a real stylus first contacts the canvas,
          // switch tldraw into pen mode. Pen mode treats pen input as the
          // only drawing pointer, so palm rests and finger taps stop
          // creating stray marks. We do this lazily — desktop mouse users
          // never see it.
          if (
            typeof window !== "undefined" &&
            typeof PointerEvent !== "undefined"
          ) {
            const onPointerDown = (e: PointerEvent) => {
              if (e.pointerType === "pen") {
                try {
                  editor.updateInstanceState({ isPenMode: true });
                } catch (err) {
                  console.warn("[tutor-canvas] pen-mode toggle failed:", err);
                }
                window.removeEventListener(
                  "pointerdown",
                  onPointerDown,
                  true,
                );
              }
            };
            window.addEventListener("pointerdown", onPointerDown, {
              capture: true,
            });
          }

          onMount?.(editor);
        }}
      />
    </div>
  );
}
