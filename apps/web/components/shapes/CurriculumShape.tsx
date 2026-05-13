"use client";

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
  type TLShape,
  type TLShapePartial,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";

export type CurriculumModuleProp = {
  title: string;
  objectives: string[];
  subtopics: string[];
  suggestedTools: string[];
  estimatedMinutes?: number;
  status: "pending" | "in_progress" | "complete";
};

export type CurriculumShape = TLBaseShape<
  "curriculum",
  {
    title: string;
    prerequisites: string[];
    modules: CurriculumModuleProp[];
    notes: string[];
    w: number;
    h: number;
  }
>;

export class CurriculumShapeUtil extends ShapeUtil<TLShape> {
  static override type = "curriculum" as const;
  static override props = {
    title: T.string,
    prerequisites: T.arrayOf(T.string),
    modules: T.arrayOf(
      T.object({
        title: T.string,
        objectives: T.arrayOf(T.string),
        subtopics: T.arrayOf(T.string),
        suggestedTools: T.arrayOf(T.string),
        estimatedMinutes: T.number.optional(),
        status: T.string,
      }),
    ),
    notes: T.arrayOf(T.string),
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
  } as never;

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): CurriculumShape["props"] {
    return {
      title: "Lesson plan",
      prerequisites: [],
      modules: [],
      notes: [],
      w: 360,
      h: 440,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as CurriculumShape;
    return new Rectangle2d({
      width: s.props.w,
      height: s.props.h,
      isFilled: true,
    });
  }

  override onResize(shape: TLShape, info: TLResizeInfo<TLShape>) {
    return resizeBox(
      shape as unknown as Parameters<typeof resizeBox>[0],
      info as unknown as Parameters<typeof resizeBox>[1],
    ) as TLShapePartial<TLShape>;
  }

  override component(shape: TLShape) {
    const s = shape as unknown as CurriculumShape;
    const completed = s.props.modules.filter(
      (m) => m.status === "complete",
    ).length;
    const inProgress = s.props.modules.findIndex(
      (m) => m.status === "in_progress",
    );

    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
          color: "#0b0b0f",
          pointerEvents: "all",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "10px 14px 8px",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            background: "rgba(16,185,129,0.04)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(16,185,129,0.85)",
              fontWeight: 600,
            }}
          >
            Lesson plan
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.25,
            }}
          >
            {s.props.title}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: "rgba(0,0,0,0.5)",
            }}
          >
            {completed} of {s.props.modules.length} done
            {inProgress >= 0
              ? ` · on module ${inProgress + 1}`
              : completed === s.props.modules.length && completed > 0
                ? " · complete"
                : ""}
          </div>
        </header>

        <ol
          style={{
            margin: 0,
            padding: "8px 0",
            listStyle: "none",
            flex: 1,
            overflowY: "auto",
          }}
        >
          {s.props.modules.map((m, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "6px 14px",
                opacity: m.status === "pending" ? 0.65 : 1,
                background:
                  m.status === "in_progress"
                    ? "rgba(16,185,129,0.07)"
                    : undefined,
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  marginTop: 2,
                  display: "inline-flex",
                  width: 16,
                  height: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  fontSize: 10,
                  fontWeight: 700,
                  color:
                    m.status === "complete"
                      ? "#fff"
                      : m.status === "in_progress"
                        ? "#16a34a"
                        : "rgba(0,0,0,0.4)",
                  background:
                    m.status === "complete"
                      ? "#16a34a"
                      : m.status === "in_progress"
                        ? "rgba(16,185,129,0.18)"
                        : "rgba(0,0,0,0.06)",
                  border:
                    m.status === "in_progress"
                      ? "1.5px solid #16a34a"
                      : undefined,
                }}
              >
                {m.status === "complete" ? "✓" : i + 1}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.3,
                  }}
                >
                  {m.title}
                </div>
                {m.subtopics.length > 0 && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10.5,
                      color: "rgba(0,0,0,0.55)",
                      lineHeight: 1.35,
                    }}
                  >
                    {m.subtopics.slice(0, 4).join(" · ")}
                    {m.subtopics.length > 4 ? " …" : ""}
                  </div>
                )}
                {m.estimatedMinutes && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      color: "rgba(0,0,0,0.4)",
                    }}
                  >
                    ~{m.estimatedMinutes} min
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        {s.props.notes.length > 0 && (
          <footer
            style={{
              padding: "8px 14px",
              borderTop: "1px solid rgba(0,0,0,0.06)",
              fontSize: 10.5,
              color: "rgba(0,0,0,0.55)",
              maxHeight: "30%",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(0,0,0,0.4)",
                marginBottom: 4,
              }}
            >
              Notes
            </div>
            {s.props.notes.slice(-3).map((n, i) => (
              <div key={i} style={{ marginTop: i ? 4 : 0 }}>
                · {n}
              </div>
            ))}
          </footer>
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as CurriculumShape;
    return (
      <rect width={s.props.w} height={s.props.h} rx={12} ry={12} />
    );
  }
}
