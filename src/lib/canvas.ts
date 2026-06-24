import type { FaceSlot } from "@/lib/templates";

export type Point2D = {
  x: number;
  y: number;
};

export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizedSlotToPixels(slot: FaceSlot, imageWidth: number, imageHeight: number): PixelRect {
  return {
    x: slot.x * imageWidth,
    y: slot.y * imageHeight,
    width: slot.width * imageWidth,
    height: slot.height * imageHeight,
  };
}

export function clampRectToBounds(rect: PixelRect, boundWidth: number, boundHeight: number): PixelRect {
  const x = Math.max(0, Math.min(rect.x, boundWidth));
  const y = Math.max(0, Math.min(rect.y, boundHeight));
  const right = Math.max(x, Math.min(rect.x + rect.width, boundWidth));
  const bottom = Math.max(y, Math.min(rect.y + rect.height, boundHeight));

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function squareFaceRectFromLandmarks(
  landmarks: readonly Point2D[],
  sourceWidth: number,
  sourceHeight: number,
  paddingRatio = 0.36,
): PixelRect {
  if (landmarks.length === 0) {
    throw new Error("No landmarks supplied");
  }

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const landmark of landmarks) {
    minX = Math.min(minX, landmark.x);
    minY = Math.min(minY, landmark.y);
    maxX = Math.max(maxX, landmark.x);
    maxY = Math.max(maxY, landmark.y);
  }

  const centerX = ((minX + maxX) / 2) * sourceWidth;
  const centerY = ((minY + maxY) / 2) * sourceHeight;
  const faceWidth = (maxX - minX) * sourceWidth;
  const faceHeight = (maxY - minY) * sourceHeight;
  const side = Math.max(faceWidth, faceHeight) * (1 + paddingRatio);

  return clampRectToBounds(
    {
      x: centerX - side / 2,
      y: centerY - side / 2,
      width: side,
      height: side,
    },
    sourceWidth,
    sourceHeight,
  );
}

export function coverRect(sourceWidth: number, sourceHeight: number, target: PixelRect): PixelRect {
  const scale = Math.max(target.width / sourceWidth, target.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
  };
}

export function cropCanvasFromRect(sourceCanvas: HTMLCanvasElement, rect: PixelRect): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.drawImage(
    sourceCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas;
}
