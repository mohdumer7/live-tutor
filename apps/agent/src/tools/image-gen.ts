import { fal } from "@fal-ai/client";
import type { GenerateImageArgs } from "@live-tutor/schema";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const key = process.env.FAL_KEY;
  if (!key) return false;
  fal.config({ credentials: key });
  configured = true;
  return true;
}

export type GenerateImageResult = {
  ok: true;
  url: string;
  alt: string;
  latencyMs: number;
};

export type GenerateImageError = {
  ok: false;
  error: string;
};

type ImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9";

function pickImageSize(w: number, h: number): ImageSize {
  const ratio = w / h;
  if (ratio >= 1.4) return "landscape_16_9";
  if (ratio >= 1.1) return "landscape_4_3";
  if (ratio <= 0.7) return "portrait_16_9";
  if (ratio <= 0.9) return "portrait_4_3";
  return "square_hd";
}

export async function generateImage(
  args: GenerateImageArgs,
): Promise<GenerateImageResult | GenerateImageError> {
  if (!ensureConfigured()) {
    return {
      ok: false,
      error: "FAL_KEY is not set. Add it to .env to enable image generation.",
    };
  }

  // Endpoint id can be overridden via FAL_IMAGE_MODEL, e.g. to switch to
  // fal-ai/flux/schnell for cheaper/faster generation, or to a future
  // openai/gpt-image-3 if/when fal hosts it.
  const endpoint = process.env.FAL_IMAGE_MODEL || "openai/gpt-image-2";

  const start = Date.now();
  try {
    // The @fal-ai/client SDK is generic over endpoint id; the openai/gpt-image-2
    // input shape isn't in its baked types yet. We cast through unknown.
    const result = (await fal.subscribe(endpoint as never, {
      input: {
        prompt: args.prompt,
        image_size: pickImageSize(args.w, args.h),
        // 'low' for fastest + cheapest. Bump to 'medium' or 'high' for sharper.
        quality: "low",
        output_format: "jpeg",
        num_images: 1,
      } as unknown as never,
      logs: false,
    })) as {
      data?: {
        images?: Array<{ url?: string; content_type?: string }>;
      };
    };

    const latencyMs = Date.now() - start;
    const url = result.data?.images?.[0]?.url;
    if (!url) return { ok: false, error: "fal.ai returned no image url" };
    return { ok: true, url, alt: args.prompt, latencyMs };
  } catch (err) {
    return { ok: false, error: extractFalError(err) };
  }
}

// fal.ai's SDK throws errors that bury the actual server message in
// `body.detail`. Surface it so the tutor can tell the student something
// useful (e.g. "account is locked") instead of generic "Forbidden".
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
