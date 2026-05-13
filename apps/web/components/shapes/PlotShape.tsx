"use client";

import { useEffect, useRef } from "react";
import functionPlot from "function-plot";
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

export type PlotShape = TLBaseShape<
  "plot",
  {
    expression: string;
    xMin: number;
    xMax: number;
    yMin: number | null;
    yMax: number | null;
    title: string;
    w: number;
    h: number;
  }
>;

// Same TLShape-union workaround as EquationShape: extend ShapeUtil<TLShape>
// and cast inside method bodies.
export class PlotShapeUtil extends ShapeUtil<TLShape> {
  static override type = "plot" as const;
  static override props = {
    expression: T.string,
    xMin: T.number,
    xMax: T.number,
    yMin: T.number.nullable(),
    yMax: T.number.nullable(),
    title: T.string,
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
  } as never;

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): PlotShape["props"] {
    return {
      expression: "x^2",
      xMin: -5,
      xMax: 5,
      yMin: null,
      yMax: null,
      title: "",
      w: 360,
      h: 260,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as PlotShape;
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
    const s = shape as unknown as PlotShape;
    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          background: "white",
          borderRadius: 8,
          padding: 8,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,0,0,0.08)",
          color: "#0b0b0f",
          pointerEvents: "all",
        }}
      >
        <Plot {...s.props} />
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as PlotShape;
    return <rect width={s.props.w} height={s.props.h} rx={8} ry={8} />;
  }
}

function Plot(props: PlotShape["props"]) {
  const target = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = target.current;
    if (!host) return;

    while (host.firstChild) host.removeChild(host.firstChild);

    try {
      functionPlot({
        target: host,
        width: props.w - 16,
        height: props.h - 16 - (props.title ? 18 : 0),
        title: props.title || undefined,
        grid: true,
        xAxis: { domain: [props.xMin, props.xMax] },
        yAxis:
          props.yMin !== null && props.yMax !== null
            ? { domain: [props.yMin, props.yMax] }
            : undefined,
        data: [{ fn: props.expression, graphType: "polyline" }],
      });
    } catch (err) {
      console.warn("[plot] function-plot render failed:", err);
      while (host.firstChild) host.removeChild(host.firstChild);
      const msg = document.createElement("div");
      msg.style.color = "#b91c1c";
      msg.style.fontSize = "12px";
      msg.textContent = `Could not plot: ${(err as Error).message}`;
      host.appendChild(msg);
    }
  }, [
    props.expression,
    props.xMin,
    props.xMax,
    props.yMin,
    props.yMax,
    props.title,
    props.w,
    props.h,
  ]);

  return <div ref={target} />;
}
