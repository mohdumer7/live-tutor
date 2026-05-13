import { CurriculumShapeUtil } from "./CurriculumShape";
import { EquationShapeUtil } from "./EquationShape";
import { MinigameShapeUtil } from "./MinigameShape";
import { PlotShapeUtil } from "./PlotShape";
import { SkeletonShapeUtil } from "./SkeletonShape";
import { SvgShapeUtil } from "./SvgShape";
import { VideoShapeUtil } from "./VideoShape";

export {
  CurriculumShapeUtil,
  EquationShapeUtil,
  MinigameShapeUtil,
  PlotShapeUtil,
  SkeletonShapeUtil,
  SvgShapeUtil,
  VideoShapeUtil,
};
export type { CurriculumShape } from "./CurriculumShape";
export type { EquationShape } from "./EquationShape";
export type { MinigameShape } from "./MinigameShape";
export type { PlotShape } from "./PlotShape";
export type { SkeletonShape } from "./SkeletonShape";
export type { SvgShape } from "./SvgShape";
export type { VideoShape } from "./VideoShape";

// Shapes the TutorCanvas registers with <Tldraw shapeUtils={...}>.
export const tutorShapeUtils = [
  CurriculumShapeUtil,
  EquationShapeUtil,
  PlotShapeUtil,
  SkeletonShapeUtil,
  SvgShapeUtil,
  VideoShapeUtil,
  MinigameShapeUtil,
];
