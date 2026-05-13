import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

const SYSTEM_PROMPT = `You are the visual perception layer for a live AI tutor.

Look at the provided whiteboard snapshot and answer the tutor's question
about it. If no specific question is given, describe what's on the canvas
in 2-4 short sentences focused on what would help the tutor decide what to
do next: shapes, equations, plots, student-drawn marks, layout, anything
ambiguous.

When describing student-drawn strokes, be concrete: "the student drew what
looks like a triangle with vertices roughly at the top-left, middle-right,
and bottom-left". Do not refer to coordinate numbers.

No greetings, no preamble, no markdown. Just the description.`;

export type DescribeCanvasInput = {
  pngBase64: string;
  width: number;
  height: number;
  question?: string;
};

export type DescribeCanvasResult =
  | { ok: true; description: string; latencyMs: number }
  | { ok: false; error: string };

export async function describeCanvas(
  input: DescribeCanvasInput,
): Promise<DescribeCanvasResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set. The vision tool relies on Claude.",
    };
  }

  const userText = input.question
    ? `The tutor wants to know: ${input.question}`
    : "Describe what's on the whiteboard.";

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: input.pngBase64,
              },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    });

    const latencyMs = Date.now() - start;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) {
      return { ok: false, error: "Claude returned an empty response." };
    }
    return { ok: true, description: text, latencyMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
