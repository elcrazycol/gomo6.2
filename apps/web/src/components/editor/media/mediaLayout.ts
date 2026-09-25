// Layout mapping for a media node, shared by the read figure and the editor
// NodeView so both agree on placement.
//
// "inline" is the default: the media is only as wide as its own (natural) size
// and sits in the line, so several can be placed side by side and it never
// takes a whole line by itself. "left"/"right" float it so text wraps.

import type { CSSProperties } from "react";
import { clampMediaWidth, type MediaAlign } from "./mediaSchema";

export const mediaFigureLayout = (
  align: MediaAlign,
  width: number,
): { className: string; style: CSSProperties } => {
  const percent = clampMediaWidth(width);
  switch (align) {
    case "full":
      return { className: "relative inline-block w-full align-middle", style: { width: "100%" } };
    case "left":
      return { className: "relative float-left mr-3", style: { width: `${percent}%` } };
    case "right":
      return { className: "relative float-right ml-3", style: { width: `${percent}%` } };
    case "inline":
    default:
      return {
        className: "relative inline-block align-middle mr-2",
        style: { width: `${percent}%` },
      };
  }
};
