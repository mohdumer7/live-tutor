"use client";

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
  type TLShape,
} from "tldraw";

export type SkeletonKind =
  | "image"
  | "video"
  | "minigame"
  | "plan"
  | "thinking";

export type SkeletonShape = TLBaseShape<
  "skeleton",
  {
    kind: SkeletonKind;
    label: string;
    w: number;
    h: number;
  }
>;

export class SkeletonShapeUtil extends ShapeUtil<TLShape> {
  static override type = "skeleton" as const;
  static override props = {
    kind: T.literalEnum("image", "video", "minigame", "plan", "thinking"),
    label: T.string,
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
  } as never;

  // Skeletons are transient — disable user-facing affordances so the
  // student doesn't accidentally drag, resize, or rotate them.
  override canResize(): boolean {
    return false;
  }
  override canEdit(): boolean {
    return false;
  }
  override hideRotateHandle(): boolean {
    return true;
  }
  override hideResizeHandles(): boolean {
    return true;
  }
  override hideSelectionBoundsBg(): boolean {
    return true;
  }
  override hideSelectionBoundsFg(): boolean {
    return true;
  }

  override getDefaultProps(): SkeletonShape["props"] {
    return {
      kind: "image",
      label: "Generating…",
      w: 420,
      h: 360,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as SkeletonShape;
    return new Rectangle2d({
      width: s.props.w,
      height: s.props.h,
      isFilled: true,
    });
  }

  override component(shape: TLShape) {
    const s = shape as unknown as SkeletonShape;
    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          borderRadius: 12,
          overflow: "hidden",
          pointerEvents: "none",
          position: "relative",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.85), rgba(245,245,250,0.85))",
          border: "1px dashed rgba(15,15,30,0.16)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "rgba(15,15,30,0.55)",
        }}
      >
        <SkeletonShimmer />
        <SkeletonIcon kind={s.props.kind} />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            fontSize: 13,
            fontWeight: 500,
            maxWidth: "85%",
            textAlign: "center",
            lineHeight: 1.3,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as never,
          }}
        >
          {s.props.label || labelFor(s.props.kind)}
        </div>
        <SkeletonDots />
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as SkeletonShape;
    return <rect width={s.props.w} height={s.props.h} rx={12} ry={12} />;
  }
}

function labelFor(kind: SkeletonKind): string {
  switch (kind) {
    case "image":
      return "Generating image…";
    case "video":
      return "Generating video…";
    case "minigame":
      return "Building minigame…";
    case "plan":
      return "Planning lesson…";
    case "thinking":
      return "Thinking…";
  }
}

// Diagonal shimmer band that sweeps across the surface — universal "we're
// loading" visual signal. Renders behind the icon/label.
function SkeletonShimmer() {
  return (
    <>
      <style>{`
        @keyframes tutor-skeleton-shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(220%); }
        }
        @keyframes tutor-skeleton-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes tutor-skeleton-dot {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 1; }
        }
      `}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(110deg, transparent 30%, rgba(120, 130, 255, 0.16) 50%, transparent 70%)",
          animation: "tutor-skeleton-shimmer 1.6s ease-in-out infinite",
          zIndex: 1,
        }}
      />
    </>
  );
}

function SkeletonDots() {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        zIndex: 2,
        display: "flex",
        gap: 6,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "rgba(100, 110, 200, 0.75)",
            animation: `tutor-skeleton-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function SkeletonIcon({ kind }: { kind: SkeletonKind }) {
  const size = 36;
  const common = {
    width: size,
    height: size,
    style: {
      position: "relative" as const,
      zIndex: 2,
      animation: "tutor-skeleton-pulse 1.6s ease-in-out infinite",
      color: "rgba(70, 80, 160, 0.85)",
    },
  };
  switch (kind) {
    case "image":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="9" cy="10" r="1.8" fill="currentColor" />
          <path
            d="M3 17l4-4 4 3 3-2 7 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "video":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="5"
            width="18"
            height="14"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M10 9.5l5 2.5-5 2.5z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "minigame":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <path
            d="M6 9h4M8 7v4M15 9.5h.01M17.5 11h.01"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M3 13a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5 4 4 0 0 1-7.2 2.4l-.4-.4h-2.8l-.4.4A4 4 0 0 1 3 13z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "plan":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect
            x="4"
            y="3"
            width="16"
            height="18"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M8 8h8M8 12h8M8 16h5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "thinking":
    default:
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M9 10c0-1.7 1.3-3 3-3s3 1.3 3 3c0 1.3-1 2-2 2.5s-1 1-1 1.5M12 17h.01"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
