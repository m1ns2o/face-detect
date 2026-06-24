import type { ExpressionLabel } from "@/lib/emotions";

export type FaceSlotShape = "ellipse";

export type FaceSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: FaceSlotShape;
};

export type TemplateConfig = {
  id: string;
  title: string;
  imageSrc: string;
  targetEmotion: ExpressionLabel;
  accent: string;
  faceSlot: FaceSlot;
};

export const templates = [
  {
    id: "neutral-study",
    title: "집중 학습",
    imageSrc: "/templates/neutral-study.png",
    targetEmotion: "Neutral",
    accent: "#1f8a70",
    faceSlot: {
      x: 0.365,
      y: 0.18,
      width: 0.265,
      height: 0.34,
      rotation: 0,
      shape: "ellipse",
    },
  },
  {
    id: "happy-solved",
    title: "문제 해결",
    imageSrc: "/templates/happy-solved.png",
    targetEmotion: "Happiness",
    accent: "#d58922",
    faceSlot: {
      x: 0.395,
      y: 0.16,
      width: 0.255,
      height: 0.335,
      rotation: 0,
      shape: "ellipse",
    },
  },
  {
    id: "sad-quiz",
    title: "어려운 퀴즈",
    imageSrc: "/templates/sad-quiz.png",
    targetEmotion: "Sadness",
    accent: "#9a6d91",
    faceSlot: {
      x: 0.39,
      y: 0.255,
      width: 0.25,
      height: 0.315,
      rotation: 0,
      shape: "ellipse",
    },
  },
  {
    id: "surprise-lab",
    title: "놀라운 결과",
    imageSrc: "/templates/surprise-lab.png",
    targetEmotion: "Surprise",
    accent: "#2f7f5f",
    faceSlot: {
      x: 0.395,
      y: 0.175,
      width: 0.255,
      height: 0.335,
      rotation: 0,
      shape: "ellipse",
    },
  },
] as const satisfies readonly TemplateConfig[];
