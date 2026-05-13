"use client";

import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
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

export type EquationShape = TLBaseShape<
  "equation",
  {
    latex: string;
    w: number;
    h: number;
    fontSize: number;
  }
>;

// tldraw's `ShapeUtil<T extends TLShape>` constraint is a closed union of
// built-in shapes; custom shapes need module augmentation OR the looser
// constraint we pick here. We extend `ShapeUtil<TLShape>` (the wide form)
// and cast inside method bodies. Runtime behavior is identical.
export class EquationShapeUtil extends ShapeUtil<TLShape> {
  static override type = "equation" as const;
  // Cast: the props validators are typed for TLShape but we know our shape.
  static override props = {
    latex: T.string,
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    fontSize: T.positiveNumber,
  } as never;

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): EquationShape["props"] {
    return {
      latex: "y = x^2",
      w: 240,
      h: 80,
      fontSize: 36,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as EquationShape;
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
    const s = shape as unknown as EquationShape;
    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
          background: "white",
          color: "#0b0b0f",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 8,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          pointerEvents: "all",
        }}
      >
        <Equation latex={s.props.latex} fontSize={s.props.fontSize} />
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as EquationShape;
    return <rect width={s.props.w} height={s.props.h} rx={8} ry={8} />;
  }
}

function Equation({ latex, fontSize }: { latex: string; fontSize: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(latex, ref.current, {
        throwOnError: false,
        displayMode: true,
        output: "html",
      });
    } catch (err) {
      console.warn("[equation] katex render failed:", err);
      if (ref.current) ref.current.textContent = latex;
    }
  }, [latex]);
  return <div ref={ref} style={{ fontSize, lineHeight: 1.2 }} />;
}
