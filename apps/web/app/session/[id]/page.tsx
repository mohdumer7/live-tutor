import { SessionRoom } from "@/components/SessionRoom";

type SessionPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickString(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export default async function SessionPage({
  params,
  searchParams,
}: SessionPageProps) {
  const { id } = await params;
  const search = await searchParams;
  const subject = pickString(search.subject);
  const grade = pickString(search.grade);
  const topic = pickString(search.topic);
  const voice = pickString(search.voice);
  const persona = pickString(search.persona);

  const lesson =
    subject || grade || topic || voice || persona
      ? { subject, grade, topic, voice, persona }
      : undefined;

  return <SessionRoom roomName={id} lesson={lesson} />;
}
