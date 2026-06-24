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

type IdolCase = {
  id: string;
  name: string;
  group: string;
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

type IdolResult = {
  id: string;
  name: string;
  group: string;
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
  ranked: RankedScore[];
};

declare global {
  interface Window {
    runIdolExpressionReport: (cases: IdolCase[]) => Promise<IdolResult[]>;
  }
}

window.runIdolExpressionReport = async (cases) => {
  const faceLandmarker = await createFaceLandmarker();
  const emotionRuntime = await createEmotionRuntime();
  const results: IdolResult[] = [];

  try {
    for (const idolCase of cases) {
      const frameCanvas = await loadImageCanvas(idolCase.imageUrl);
      const detection = withSuppressedMediaPipeInfoLogs(() => faceLandmarker.detect(frameCanvas));
      const landmarks = detection.faceLandmarks[0];

      if (!landmarks?.length) {
        throw new Error(`No face detected for ${idolCase.name}`);
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
        throw new Error(`No emotion scores returned for ${idolCase.name}`);
      }

      results.push({
        id: idolCase.id,
        name: idolCase.name,
        group: idolCase.group,
        sourceUrl: idolCase.sourceUrl,
        license: idolCase.license,
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

function loadImageCanvas(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas 2D context is not available"));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}
