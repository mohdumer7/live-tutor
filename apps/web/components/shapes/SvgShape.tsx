"use client";

import { useEffect, useRef } from "react";
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

export type SvgShape = TLBaseShape<
  "svg",
  {
    svg: string;
    w: number;
    h: number;
  }
>;

export class SvgShapeUtil extends ShapeUtil<TLShape> {
  static override type = "svg" as const;
  static override props = {
    svg: T.string,
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
  } as never;

  override canResize(): boolean {
    return true;
  }

  override getDefaultProps(): SvgShape["props"] {
    return {
      svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#eee'/></svg>",
      w: 240,
      h: 240,
    };
  }

  override getGeometry(shape: TLShape) {
    const s = shape as unknown as SvgShape;
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
    const s = shape as unknown as SvgShape;
    return (
      <HTMLContainer
        style={{
          width: s.props.w,
          height: s.props.h,
          background: "white",
          borderRadius: 8,
          padding: 4,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,0,0,0.08)",
          color: "#0b0b0f",
          pointerEvents: "all",
          overflow: "hidden",
        }}
      >
        <SvgEmbed svg={s.props.svg} w={s.props.w} h={s.props.h} />
      </HTMLContainer>
    );
  }

  override indicator(shape: TLShape) {
    const s = shape as unknown as SvgShape;
    return <rect width={s.props.w} height={s.props.h} rx={8} ry={8} />;
  }
}

/**
 * Renders agent-supplied SVG markup safely:
 *   1. Parse via DOMParser (so we never touch innerHTML on the live DOM).
 *   2. Strip <script> nodes and any on*=  event-handler attributes.
 *   3. Force the root <svg> to fill the shape's box.
 *   4. Adopt the parsed node into the live DOM via appendChild.
 */
function SvgEmbed({ svg, w, h }: { svg: string; w: number; h: number }) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;

    while (root.firstChild) root.removeChild(root.firstChild);

    let parsed: Document;
    try {
      parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    } catch (err) {
      const err1 = document.createElement("div");
      err1.style.color = "#b91c1c";
      err1.style.fontSize = "12px";
      err1.textContent = `SVG parse error: ${(err as Error).message}`;
      root.appendChild(err1);
      return;
    }

    // DOMParser puts a <parsererror> element in the result on bad input.
    const parseError = parsed.querySelector("parsererror");
    if (parseError) {
      const err2 = document.createElement("div");
      err2.style.color = "#b91c1c";
      err2.style.fontSize = "12px";
      err2.textContent = "Invalid SVG markup";
      root.appendChild(err2);
      return;
    }

    const svgEl = parsed.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") {
      const err3 = document.createElement("div");
      err3.style.color = "#b91c1c";
      err3.style.fontSize = "12px";
      err3.textContent = "Root element is not <svg>";
      root.appendChild(err3);
      return;
    }

    // Strip <script> and event handler attributes everywhere in the tree.
    svgEl.querySelectorAll("script").forEach((n) => n.remove());
    const all: Element[] = [svgEl, ...svgEl.querySelectorAll("*")];
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        if (attr.name.toLowerCase().startsWith("on")) {
          el.removeAttribute(attr.name);
        }
        // Block javascript: URIs in href / xlink:href.
        if (
          (attr.name === "href" || attr.name === "xlink:href") &&
          /^\s*javascript:/i.test(attr.value)
        ) {
          el.removeAttribute(attr.name);
        }
      }
    }

    // Make it fill the shape's box.
    svgEl.setAttribute("width", String(w - 8));
    svgEl.setAttribute("height", String(h - 8));
    svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

    root.appendChild(svgEl);
  }, [svg, w, h]);

  return <div ref={host} style={{ width: w - 8, height: h - 8 }} />;
}
