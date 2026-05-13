"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  deleteLesson,
  listRecentLessons,
  type RecentLesson,
} from "@/lib/lesson-store";

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function buildHref(lesson: RecentLesson): string {
  const params = new URLSearchParams();
  if (lesson.meta.subject) params.set("subject", lesson.meta.subject);
  if (lesson.meta.grade) params.set("grade", lesson.meta.grade);
  if (lesson.meta.topic) params.set("topic", lesson.meta.topic);
  const qs = params.toString();
  return qs
    ? `/session/${lesson.roomId}?${qs}`
    : `/session/${lesson.roomId}`;
}

export function RecentLessons() {
  const [lessons, setLessons] = useState<RecentLesson[]>([]);

  useEffect(() => {
    setLessons(listRecentLessons());
  }, []);

  const handleForget = (roomId: string) => {
    deleteLesson(roomId);
    setLessons((prev) => prev.filter((l) => l.roomId !== roomId));
  };

  if (lessons.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/50">
        Recent lessons
      </h2>
      <ul className="flex flex-col gap-1.5">
        {lessons.map((l) => {
          const title =
            l.meta.topic ||
            [l.meta.subject, l.meta.grade && `Grade ${l.meta.grade}`]
              .filter(Boolean)
              .join(" · ") ||
            "Untitled lesson";
          return (
            <li
              key={l.roomId}
              className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 transition-colors hover:bg-white/10"
            >
              <Link
                href={buildHref(l)}
                className="min-w-0 flex-1 text-left"
                title={`Resume ${title}`}
              >
                <p className="truncate text-sm text-white">{title}</p>
                <p className="mt-0.5 text-xs text-white/50">
                  {l.shapeCount} shape{l.shapeCount === 1 ? "" : "s"} ·{" "}
                  {relativeTime(l.lastSavedAt)}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => handleForget(l.roomId)}
                title="Forget this lesson"
                className="rounded-md px-2 py-1 text-xs text-white/40 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
              >
                Forget
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
