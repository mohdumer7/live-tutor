import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { lessonConfigSchema } from "@live-tutor/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenRequest = {
  roomName: string;
  identity: string;
  name?: string;
  lessonConfig?: unknown;
};

function parseBody(input: unknown): TokenRequest | { error: string } {
  if (typeof input !== "object" || input === null)
    return { error: "body must be a JSON object" };
  const { roomName, identity, name, lessonConfig } = input as Record<
    string,
    unknown
  >;
  if (typeof roomName !== "string" || roomName.length === 0)
    return { error: "roomName required" };
  if (typeof identity !== "string" || identity.length === 0)
    return { error: "identity required" };
  if (name !== undefined && typeof name !== "string")
    return { error: "name must be a string" };
  return { roomName, identity, name, lessonConfig };
}

export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      {
        error:
          "Server is missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL",
      },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseBody(body);
  if ("error" in parsed)
    return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { roomName, identity, name, lessonConfig } = parsed;

  // Embed the lesson config (voice / persona / subject / grade / topic) in
  // participant metadata so the agent can read it from
  // `participant.metadata` and configure the realtime session before any
  // tutoring starts.
  let metadata: string | undefined;
  if (lessonConfig !== undefined) {
    const result = lessonConfigSchema.safeParse(lessonConfig);
    if (result.success) {
      metadata = JSON.stringify(result.data);
    } else {
      // Malformed config is non-fatal — drop it and let the agent use defaults.
      console.warn("[token] invalid lessonConfig:", result.error.message);
    }
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: name ?? identity,
    ttl: "10m",
    ...(metadata ? { metadata } : {}),
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({ token, url: wsUrl, identity, roomName });
}
