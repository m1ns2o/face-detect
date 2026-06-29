import type { ExpressionLabel } from "@/lib/emotions";
import { clampRectToBounds, type PixelRect } from "@/lib/canvas";

export type RgbaImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

export type DetectedComicSlot = {
  id: string;
  index: number;
  rect: PixelRect;
  panelRect: PixelRect;
};

type Component = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type DetectionOptions = {
  minAreaRatio?: number;
  maxAreaRatio?: number;
  minSidePx?: number;
};

export const DEFAULT_COMIC_TARGETS = [
  "Fear",
  "Sadness",
  "Fear",
  "Neutral",
  "Happiness",
  "Happiness",
  "Happiness",
] as const satisfies readonly ExpressionLabel[];

export const COMIC_TARGET_EXPRESSIONS = [
  "Fear",
  "Sadness",
  "Happiness",
  "Neutral",
  "Anger",
  "Surprise",
] as const satisfies readonly ExpressionLabel[];

const DEFAULT_OPTIONS = {
  minAreaRatio: 0.0012,
  maxAreaRatio: 0.035,
  minSidePx: 18,
};

export function detectComicFaceSlots(
  imageData: RgbaImageData,
  options: DetectionOptions = {},
): DetectedComicSlot[] {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const components = findBrightComponents(imageData);
  const imageArea = imageData.width * imageData.height;

  const candidates = components
    .filter((component) => {
      const rect = componentToRect(component);
      const area = rect.width * rect.height;
      const aspectRatio = rect.width / rect.height;
      const areaRatio = area / imageArea;
      const fillRatio = component.area / area;

      return (
        rect.width >= resolvedOptions.minSidePx &&
        rect.height >= resolvedOptions.minSidePx &&
        areaRatio >= resolvedOptions.minAreaRatio &&
        areaRatio <= resolvedOptions.maxAreaRatio &&
        fillRatio >= 0.5 &&
        aspectRatio >= 0.58 &&
        aspectRatio <= 1.55
      );
    })
    .map(componentToRect)
    .map((rect) => expandRect(rect, imageData.width, imageData.height, 1.04));

  return sortRectsReadingOrder(deduplicateRects(candidates)).map((rect, index) => ({
    id: `cut-${index + 1}`,
    index,
    rect,
    panelRect: inferPanelRect(imageData, rect),
  }));
}

export function scaleRect(rect: PixelRect, scale: number): PixelRect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function expandRect(
  rect: PixelRect,
  boundWidth: number,
  boundHeight: number,
  scale = 1.1,
): PixelRect {
  const nextWidth = rect.width * scale;
  const nextHeight = rect.height * scale;

  return clampRectToBounds(
    {
      x: rect.x + (rect.width - nextWidth) / 2,
      y: rect.y + (rect.height - nextHeight) / 2,
      width: nextWidth,
      height: nextHeight,
    },
    boundWidth,
    boundHeight,
  );
}

export function sortRectsReadingOrder<T extends { rect: PixelRect } | PixelRect>(items: T[]): T[] {
  return [...items].sort((first, second) => {
    const firstRect = sortableRect(first);
    const secondRect = sortableRect(second);
    const rowTolerance = Math.max(firstRect.height, secondRect.height) * 0.7;

    if (Math.abs(firstRect.y - secondRect.y) > rowTolerance) {
      return firstRect.y - secondRect.y;
    }

    return firstRect.x - secondRect.x;
  });
}

function sortableRect(item: { rect: PixelRect } | PixelRect): PixelRect {
  return "rect" in item ? item.rect : item;
}

function findBrightComponents(imageData: RgbaImageData): Component[] {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    if (visited[pixelIndex] || !isMaskPixel(data, pixelIndex)) {
      visited[pixelIndex] = 1;
      continue;
    }

    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    visited[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;

    const enqueueNeighbor = (nextIndex: number, inBounds: boolean) => {
      if (!inBounds || visited[nextIndex]) {
        return;
      }

      visited[nextIndex] = 1;
      if (isMaskPixel(data, nextIndex)) {
        queue[tail] = nextIndex;
        tail += 1;
      }
    };

    while (head < tail) {
      const current = queue[head];
      head += 1;
      area += 1;

      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      enqueueNeighbor(current - 1, x > 0);
      enqueueNeighbor(current + 1, x < width - 1);
      enqueueNeighbor(current - width, y > 0);
      enqueueNeighbor(current + width, y < height - 1);
    }

    components.push({ area, minX, minY, maxX, maxY });
  }

  return components;
}

function isMaskPixel(data: RgbaImageData["data"], pixelIndex: number) {
  const offset = pixelIndex * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  return alpha > 160 && red > 190 && green > 190 && blue > 190 && max - min < 35;
}

function componentToRect(component: Component): PixelRect {
  return {
    x: component.minX,
    y: component.minY,
    width: component.maxX - component.minX + 1,
    height: component.maxY - component.minY + 1,
  };
}

function deduplicateRects(rects: PixelRect[]): PixelRect[] {
  const sorted = [...rects].sort((first, second) => second.width * second.height - first.width * first.height);
  const kept: PixelRect[] = [];

  for (const rect of sorted) {
    if (!kept.some((existing) => intersectionOverMinArea(existing, rect) > 0.55)) {
      kept.push(rect);
    }
  }

  return kept;
}

function intersectionOverMinArea(first: PixelRect, second: PixelRect) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const minArea = Math.min(first.width * first.height, second.width * second.height);

  return minArea === 0 ? 0 : intersection / minArea;
}

function inferPanelRect(imageData: RgbaImageData, slotRect: PixelRect): PixelRect {
  const rowBands = findLineBands(imageData.height, (position) => rowDarkRatio(imageData, position), 0.16);
  const centerY = slotRect.y + slotRect.height / 2;
  const topBand = lastBandBefore(rowBands, centerY);
  const bottomBand = firstBandAfter(rowBands, centerY);
  const top = topBand?.center ?? Math.max(0, slotRect.y - slotRect.height * 2.2);
  const bottom = bottomBand?.center ?? Math.min(imageData.height, slotRect.y + slotRect.height * 3.1);
  const yStart = Math.max(0, Math.floor(top));
  const yEnd = Math.min(imageData.height - 1, Math.ceil(bottom));
  const columnBands = findLineBands(
    imageData.width,
    (position) => columnDarkRatio(imageData, position, yStart, yEnd),
    0.22,
  );
  const centerX = slotRect.x + slotRect.width / 2;
  const leftBand = lastBandBefore(columnBands, centerX);
  const rightBand = firstBandAfter(columnBands, centerX);
  const left = leftBand?.center ?? Math.max(0, slotRect.x - slotRect.width * 2.3);
  const right = rightBand?.center ?? Math.min(imageData.width, slotRect.x + slotRect.width * 2.3);

  return clampRectToBounds(
    {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    },
    imageData.width,
    imageData.height,
  );
}

function rowDarkRatio(imageData: RgbaImageData, y: number) {
  let dark = 0;

  for (let x = 0; x < imageData.width; x += 1) {
    if (isDarkPixel(imageData, x, y)) {
      dark += 1;
    }
  }

  return dark / imageData.width;
}

function columnDarkRatio(imageData: RgbaImageData, x: number, yStart: number, yEnd: number) {
  let dark = 0;
  const height = Math.max(1, yEnd - yStart + 1);

  for (let y = yStart; y <= yEnd; y += 1) {
    if (isDarkPixel(imageData, x, y)) {
      dark += 1;
    }
  }

  return dark / height;
}

function isDarkPixel(imageData: RgbaImageData, x: number, y: number) {
  const offset = (y * imageData.width + x) * 4;
  const red = imageData.data[offset];
  const green = imageData.data[offset + 1];
  const blue = imageData.data[offset + 2];
  const alpha = imageData.data[offset + 3];

  return alpha > 160 && red < 70 && green < 70 && blue < 70;
}

function findLineBands(
  length: number,
  scoreAt: (position: number) => number,
  threshold: number,
): Array<{ start: number; end: number; center: number }> {
  const bands: Array<{ start: number; end: number; center: number }> = [];
  let start: number | null = null;

  for (let position = 0; position < length; position += 1) {
    const isLine = scoreAt(position) >= threshold;

    if (isLine && start === null) {
      start = position;
    }

    if ((!isLine || position === length - 1) && start !== null) {
      const end = isLine && position === length - 1 ? position : position - 1;
      if (end - start >= 1) {
        bands.push({ start, end, center: (start + end) / 2 });
      }
      start = null;
    }
  }

  return bands;
}

function lastBandBefore(
  bands: Array<{ start: number; end: number; center: number }>,
  position: number,
) {
  return [...bands].reverse().find((band) => band.center < position);
}

function firstBandAfter(
  bands: Array<{ start: number; end: number; center: number }>,
  position: number,
) {
  return bands.find((band) => band.center > position);
}
