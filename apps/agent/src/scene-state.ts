import {
  TOPIC_SCENE_STATE,
  sceneStateEnvelope,
  type SceneDigest,
} from "@live-tutor/schema";
import type { RpcRoom } from "./tools/rpc.js";

const decoder = new TextDecoder();

export type SceneState = {
  /** The most recent digest we received, or null if FE hasn't published yet. */
  current(): SceneDigest | null;
  /** A short multi-line string suitable for injecting into prompts. */
  asPromptText(): string;
  dispose(): void;
};

/**
 * Subscribes to scene_state envelopes from the FE and maintains an in-memory
 * mirror so tools (and the model, via list_shapes / system prompt injection)
 * can reason about what's currently on the canvas without per-turn snapshots.
 */
export function createSceneState(room: RpcRoom): SceneState {
  let digest: SceneDigest | null = null;

  const onData = (...args: unknown[]) => {
    const [payload, , , topic] = args as [
      Uint8Array,
      unknown,
      unknown,
      string | undefined,
    ];
    if (topic !== TOPIC_SCENE_STATE) return;
    try {
      const env = sceneStateEnvelope.parse(
        JSON.parse(decoder.decode(payload)),
      );
      digest = env.digest;
    } catch (err) {
      console.warn("[scene] invalid scene_state envelope:", err);
    }
  };

  room.on("dataReceived", onData);

  return {
    current() {
      return digest;
    },
    asPromptText() {
      if (!digest) return "Canvas is empty.";
      const lines: string[] = [];
      if (digest.shapes.length === 0) {
        lines.push("Canvas is empty.");
      } else {
        const studentCount = digest.shapes.filter(
          (s) => s.createdBy === "student",
        ).length;
        const summaryHeader = studentCount
          ? `Canvas (${digest.shapes.length} shape${digest.shapes.length === 1 ? "" : "s"}, ${studentCount} student-drawn):`
          : `Canvas (${digest.shapes.length} shape${digest.shapes.length === 1 ? "" : "s"}):`;
        lines.push(summaryHeader);
        for (const s of digest.shapes) {
          const summary = s.summary ? ` "${s.summary}"` : "";
          const label = s.label ? ` [labeled "${s.label}"]` : "";
          const author = s.createdBy === "student" ? " *student-drawn*" : "";
          lines.push(
            `  [${s.id}] ${s.kind}${summary}${label}${author} at (${Math.round(s.x)}, ${Math.round(s.y)}) size ${Math.round(s.w)}x${Math.round(s.h)}`,
          );
        }
      }
      // Pages overview — only shown if the student has more than one.
      if (digest.pages && digest.pages.length > 1) {
        const cur = digest.currentPageId;
        const pageLine = digest.pages
          .map(
            (p) =>
              `${p.id === cur ? "★" : " "} ${p.name} (${p.shapeCount} shapes)`,
          )
          .join("  |  ");
        lines.push(`Pages: ${pageLine}`);
      }

      const f = digest.focus;
      const focusLines: string[] = [];
      if (f.selectedIds.length)
        focusLines.push(`  selected: ${f.selectedIds.join(", ")}`);
      if (f.hoveredId) focusLines.push(`  hovering: ${f.hoveredId}`);
      if (f.cursor)
        focusLines.push(
          `  cursor at (${Math.round(f.cursor.x)}, ${Math.round(f.cursor.y)})`,
        );
      if (f.recentlyTouchedIds.length)
        focusLines.push(
          `  recently touched: ${f.recentlyTouchedIds.join(", ")}`,
        );
      focusLines.push(
        `  viewport: (${Math.round(f.viewport.x)}, ${Math.round(f.viewport.y)}) ${Math.round(f.viewport.w)}x${Math.round(f.viewport.h)} @ zoom ${f.viewport.zoom.toFixed(2)}`,
      );
      lines.push("Student focus:");
      lines.push(...focusLines);
      return lines.join("\n");
    },
    dispose() {
      room.off("dataReceived", onData);
    },
  };
}
