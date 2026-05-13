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

export type VideoShape = TLBaseShape<
  "video-tutor",
  {
    url: string;
    alt: string;
    w: number;
    h: number;
  }
>;

export class VideoShapeUtil extends ShapeUtil<TLShape> {
  // Use 'video-tutor' to avoid colliding with tldraw's built-in 'video' shape
  // (which is asset-backed and harder to populate ad-hoc).
  static override type = "video-tutor" as const;
  static override props = {
    url: T.string,
    alt: T.string,
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
  } as never;

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): VideoShape["props"] {
    return {
      url: "",
      alt: "",
      w: 480,
      h: 270,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as VideoShape;
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
    const s = shape as unknown as VideoShape;
    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          background: "black",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,0,0,0.08)",
          pointerEvents: "all",
        }}
      >
        {s.props.url ? (
          <video
            src={s.props.url}
            controls
            autoPlay
            // Browsers block audible autoplay; muted lets it start, the
            // student can unmute via the controls.
            muted
            playsInline
            loop
            aria-label={s.props.alt}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "black",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.6)",
              fontSize: 12,
            }}
          >
            video unavailable
          </div>
        )}
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as VideoShape;
    return <rect width={s.props.w} height={s.props.h} rx={8} ry={8} />;
  }
}
