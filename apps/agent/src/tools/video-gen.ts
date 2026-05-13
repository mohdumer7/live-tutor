import { fal } from "@fal-ai/client";
import type { GenerateVideoArgs } from "@live-tutor/schema";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const key = process.env.FAL_KEY;
  if (!key) return false;
  fal.config({ credentials: key });
  configured = true;
  return true;
}

export type GenerateVideoResult =
  | {
      ok: true;
      url: string;
      alt: string;
      latencyMs: number;
    }
  | { ok: false; error: string };

export async function generateVideo(
  args: GenerateVideoArgs,
): Promise<GenerateVideoResult> {
  if (!ensureConfigured()) {
    return {
      ok: false,
      error: "FAL_KEY is not set. Add it to .env to enable video generation.",
    };
  }

  // Default to Veo3 fast — best quality/latency tradeoff for educational
  // clips. Override via FAL_VIDEO_MODEL for experimentation.
  const endpoint = process.env.FAL_VIDEO_MODEL || "fal-ai/veo3/fast";
  const aspectRatio = pickAspectRatio(args.w, args.h);

  const start = Date.now();
  try {
    const result = (await fal.subscribe(endpoint as never, {
      input: {
        prompt: args.prompt,
        aspect_ratio: aspectRatio,
        // Most fal video endpoints accept a `duration` in seconds; default
        // to a short clip suitable for tutoring context.
        duration: 5,
      } as unknown as never,
      logs: false,
    })) as {
      data?: {
        video?: { url?: string };
        // Some endpoints nest under `videos: [{url}]` instead.
        videos?: Array<{ url?: string }>;
      };
    };

    const latencyMs = Date.now() - start;
    const url =
      result.data?.video?.url ?? result.data?.videos?.[0]?.url ?? "";
    if (!url) return { ok: false, error: "fal.ai returned no video url" };
    return { ok: true, url, alt: args.prompt, latencyMs };
  } catch (err) {
    return { ok: false, error: extractFalError(err) };
  }
}

function pickAspectRatio(w: number, h: number): "16:9" | "9:16" | "1:1" {
  const ratio = w / h;
  if (ratio >= 1.4) return "16:9";
  if (ratio <= 0.7) return "9:16";
  return "1:1";
}

function extractFalError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      message?: string;
      status?: number;
      body?: { detail?: unknown };
    };
    const detail = e.body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (typeof first.msg === "string") return first.msg;
    }
    if (e.message) {
      return e.status ? `${e.status} ${e.message}` : e.message;
    }
  }
  return String(err);
}
