import { z } from "zod";

/* ------------------------------------------------------------------------- */
/* Voice presets                                                              */
/* ------------------------------------------------------------------------- */

// Gemini Live's named voices. Add more here if Google ships them.
export const VOICE_OPTIONS = [
  { id: "Puck", label: "Puck", description: "Friendly, warm" },
  { id: "Charon", label: "Charon", description: "Deep, calm" },
  { id: "Kore", label: "Kore", description: "Bright, clear" },
  { id: "Fenrir", label: "Fenrir", description: "Energetic" },
  { id: "Aoede", label: "Aoede", description: "Soft, gentle" },
] as const;

export const voiceIdSchema = z.enum([
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
]);
export type VoiceId = z.infer<typeof voiceIdSchema>;
export const DEFAULT_VOICE: VoiceId = "Puck";

/* ------------------------------------------------------------------------- */
/* Persona presets                                                            */
/* ------------------------------------------------------------------------- */

export const personaIdSchema = z.enum([
  "warm",
  "strict",
  "playful",
  "socratic",
]);
export type PersonaId = z.infer<typeof personaIdSchema>;
export const DEFAULT_PERSONA: PersonaId = "warm";

export type PersonaPreset = {
  id: PersonaId;
  label: string;
  description: string;
  // Appended to the base TUTOR_INSTRUCTIONS at session construction.
  promptAddendum: string;
};

export const PERSONA_OPTIONS: ReadonlyArray<PersonaPreset> = [
  {
    id: "warm",
    label: "Warm",
    description: "Encouraging and patient",
    promptAddendum: `STYLE: warm and encouraging. Lots of small affirmations
("good catch", "exactly"). Patient — never make the student feel rushed.
Light, natural humor when it fits.`,
  },
  {
    id: "strict",
    label: "Strict",
    description: "Rigorous and precise",
    promptAddendum: `STYLE: rigorous and precise. Reward correct reasoning;
politely point out errors without sugar-coating. Light praise only when
genuinely earned. Demand correct vocabulary and clean notation.`,
  },
  {
    id: "playful",
    label: "Playful",
    description: "Fun analogies, lots of energy",
    promptAddendum: `STYLE: playful and energetic. Use vivid analogies
("imagine the variables are kids on a seesaw…"). Don't be afraid of a
lighthearted joke. Keep the energy high without being annoying.`,
  },
  {
    id: "socratic",
    label: "Socratic",
    description: "Guides via questions",
    promptAddendum: `STYLE: Socratic. Default to asking guiding questions
rather than explaining outright. Only give the answer after the student
has tried, or after two or three guided steps. Praise good attempts even
if the conclusion is wrong.`,
  },
] as const;

export function getPersona(id: PersonaId | undefined): PersonaPreset {
  return (
    PERSONA_OPTIONS.find((p) => p.id === id) ??
    (PERSONA_OPTIONS[0] as PersonaPreset)
  );
}

/* ------------------------------------------------------------------------- */
/* Per-participant lesson config                                              */
/* ------------------------------------------------------------------------- */

// Sent through the LiveKit participant metadata. The agent reads this when
// the student joins to configure voice + persona before starting the
// realtime session.
export const lessonConfigSchema = z.object({
  voice: voiceIdSchema.default(DEFAULT_VOICE),
  persona: personaIdSchema.default(DEFAULT_PERSONA),
  subject: z.string().optional(),
  grade: z.string().optional(),
  topic: z.string().optional(),
});
export type LessonConfig = z.infer<typeof lessonConfigSchema>;
