import {
  createEmotionRuntime,
  createFaceLandmarker,
  withSuppressedMediaPipeInfoLogs,
} from "../src/lib/browser-models";
import { cropCanvasFromRect, squareFaceRectFromLandmarks } from "../src/lib/canvas";
import {
  expressionNamesKo,
  formatPercent,
  type EmotionScores,
  type ExpressionLabel,
} from "../src/lib/emotions";

type CelebrityExpressionCase = {
  id: string;
  name: string;
  role: string;
  expectedExpression: ExpressionLabel;
  imageUrl: string;
  sourceUrl: string;
  license: string;
};

type RankedScore = {
  label: ExpressionLabel;
  labelKo: string;
  score: number;
  percent: string;
};

type CelebrityExpressionResult = {
  id: string;
  name: string;
  role: string;
  expectedExpression: ExpressionLabel;
  expectedExpressionKo: string;
  sourceUrl: string;
  license: string;
  imageSize: {
    width: number;
    height: number;
  };
  faceCrop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  topLabel: ExpressionLabel;
  topLabelKo: string;
  confidence: number;
  confidencePercent: string;
  matched: boolean;
  ranked: RankedScore[];
};

declare global {
  interface Window {
    runCelebrityExpressionReport: (
      cases: CelebrityExpressionCase[],
    ) => Promise<CelebrityExpressionResult[]>;
  }
}

window.runCelebrityExpressionReport = async (cases) => {
  const faceLandmarker = await createFaceLandmarker();
  const emotionRuntime = await createEmotionRuntime();
  const results: CelebrityExpressionResult[] = [];

  try {
    for (const testCase of cases) {
      const frameCanvas = await loadImageCanvas(testCase.imageUrl);
      const detection = withSuppressedMediaPipeInfoLogs(() => faceLandmarker.detect(frameCanvas));
      const landmarks = detection.faceLandmarks[0];

      if (!landmarks?.length) {
        throw new Error(`No face detected for ${testCase.name}`);
      }

      const faceRect = squareFaceRectFromLandmarks(
        landmarks,
        frameCanvas.width,
        frameCanvas.height,
      );
      const faceCanvas = cropCanvasFromRect(frameCanvas, faceRect);
      const scores = await emotionRuntime.predict(faceCanvas);
      const ranked = rankScores(scores);
      const top = ranked[0];

      if (!top) {
        throw new Error(`No emotion scores returned for ${testCase.name}`);
      }

      results.push({
        id: testCase.id,
        name: testCase.name,
        role: testCase.role,
        expectedExpression: testCase.expectedExpression,
        expectedExpressionKo: expressionNamesKo[testCase.expectedExpression],
        sourceUrl: testCase.sourceUrl,
        license: testCase.license,
        imageSize: {
          width: frameCanvas.width,
          height: frameCanvas.height,
        },
        faceCrop: {
          x: Math.round(faceRect.x),
          y: Math.round(faceRect.y),
          width: Math.round(faceRect.width),
          height: Math.round(faceRect.height),
        },
        topLabel: top.label,
        topLabelKo: top.labelKo,
        confidence: top.score,
        confidencePercent: top.percent,
        matched: top.label === testCase.expectedExpression,
        ranked,
      });
    }
  } finally {
    faceLandmarker.close();
  }

  return results;
};

function rankScores(scores: EmotionScores): RankedScore[] {
  return (Object.entries(scores) as [ExpressionLabel, number][])
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([label, score]) => ({
      label,
      labelKo: expressionNamesKo[label],
      score,
      percent: formatPercent(score),
    }));
}

async function loadImageCanvas(src: string): Promise<HTMLCanvasElement> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to load image: ${src} (${response.status})`);
  }

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas 2D context is not available");
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}
