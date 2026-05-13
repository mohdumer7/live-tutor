import Anthropic from "@anthropic-ai/sdk";
import {
  curriculumModuleSchema,
  type CurriculumModule,
  type PlanLessonArgs,
} from "@live-tutor/schema";
import { z } from "zod";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

const SYSTEM_PROMPT = `You are a curriculum researcher for a live AI tutor.

Given a topic, build a focused, step-by-step lesson plan. The student will
be taught these modules in order, with the tutor narrating and using
visualizations (images, equations, plots, short videos, mini-games).

Constraints:
- 4-7 modules. Don't go broader. Each module is one tight subject.
- Each module: 2-5 short subtopics, 1-3 learning objectives.
- Estimate minutes per module honestly (typically 4-15 each).
- Suggest the most useful visual tools per module from this set ONLY:
  ["image", "video", "equation", "plot", "minigame", "svg"].
  Only suggest a tool if it's genuinely helpful — don't pad.
- Ordering matters: prerequisites earlier, conceptual depth later.
- Title each module so a student would understand it (no jargon-only titles).
- DO NOT include modules that need real-world experiments or external links.

Respond as a single JSON object only, no prose, no code fences:

{
  "title": "Short, student-facing lesson title",
  "prerequisites": ["short string", ...],   // 0-4 items, optional
  "modules": [
    {
      "title": "Module title",
      "objectives": ["learning objective 1", "learning objective 2"],
      "subtopics": ["subtopic 1", "subtopic 2", "subtopic 3"],
      "suggestedTools": ["image", "equation"],
      "estimatedMinutes": 8
    },
    ...
  ]
}`;

const planResponseSchema = z.object({
  title: z.string().min(1).max(160),
  prerequisites: z.array(z.string().min(1).max(120)).max(8).default([]),
  modules: z.array(curriculumModuleSchema).min(1).max(15),
});

export type PlanLessonResult =
  | {
      ok: true;
      title: string;
      prerequisites: string[];
      modules: CurriculumModule[];
      latencyMs: number;
    }
  | { ok: false; error: string };

export async function planLesson(
  args: PlanLessonArgs,
): Promise<PlanLessonResult> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set. Lesson planning relies on Claude.",
    };
  }

  const userParts: string[] = [`Topic: ${args.topic}`];
  if (args.level) userParts.push(`Student level: ${args.level}`);
  if (args.durationHint) userParts.push(`Time budget: ${args.durationHint}`);

  const start = Date.now();
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2400,
      temperature: 0.4,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userParts.join("\n") }],
    });
    const latencyMs = Date.now() - start;
    let text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Strip ``` fences if Claude added them.
    text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: `lesson planner returned non-JSON: ${text.slice(0, 200)}`,
      };
    }

    const validated = planResponseSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        error: `lesson planner returned invalid shape: ${validated.error.message.slice(0, 200)}`,
      };
    }

    return {
      ok: true,
      title: validated.data.title,
      prerequisites: validated.data.prerequisites,
      modules: validated.data.modules.map((m) => ({
        ...m,
        // Ensure all modules start as pending regardless of what Claude
        // returned — the tutor advances them as it teaches.
        status: "pending" as const,
      })),
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
