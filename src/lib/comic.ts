import { TARGET_EXPRESSIONS, type ExpressionLabel } from "@/lib/emotions";
import { clampRectToBounds, type PixelRect } from "@/lib/canvas";

export type RgbaImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

export type DetectedComicPanel = {
  id: string;
  index: number;
  rect: PixelRect;
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

type LineBand = {
  start: number;
  end: number;
  center: number;
};

type Interval = {
  start: number;
  end: number;
};

type SlotMatch = {
  rect: PixelRect;
  panelRect: PixelRect;
};

type PanelCandidate = {
  rect: PixelRect;
  fillRatio: number;
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

export const COMIC_TARGET_EXPRESSIONS = TARGET_EXPRESSIONS;

const DEFAULT_OPTIONS = {
  minAreaRatio: 0.0012,
  maxAreaRatio: 0.035,
  minSidePx: 18,
};

const PANEL_COMPONENT_OPTIONS = {
  maxRectAreaRatio: 0.98,
  minFillRatio: 0.035,
  minSplitFillRatio: 0.22,
  minHeightRatio: 0.16,
  minRectAreaRatio: 0.025,
  minWidthRatio: 0.11,
};

const GUTTER_SPLIT_OPTIONS = {
  threshold: 0.9,
};

const LINE_PANEL_OPTIONS = {
  horizontalThreshold: 0.16,
  minHeightRatio: 0.16,
  minWidthRatio: 0.11,
  verticalThreshold: 0.22,
};

export function detectComicFaceSlots(
  imageData: RgbaImageData,
  options: DetectionOptions = {},
): DetectedComicSlot[] {
  const maskRects = findMaskRects(imageData, options);
  const panelRects = detectComicPanels(imageData).map((panel) => panel.rect);

  return matchMasksToPanels(maskRects, panelRects, imageData).map((slot, index) => ({
    id: `cut-${index + 1}`,
    index,
    rect: slot.rect,
    panelRect: slot.panelRect,
  }));
}

export function detectComicPanels(imageData: RgbaImageData): DetectedComicPanel[] {
  const componentPanels = detectPanelsFromComponents(imageData);

  if (componentPanels.length > 1) {
    return componentPanels.map((rect, index) => ({
      id: `panel-${index + 1}`,
      index,
      rect,
    }));
  }

  const linePanels = detectPanelsFromLineBands(imageData);
  const rects = linePanels.length > 0 ? linePanels : componentPanels;
  const fallbackRects = rects.length > 0 ? rects : [fullImageRect(imageData)];

  return fallbackRects.map((rect, index) => ({
    id: `panel-${index + 1}`,
    index,
    rect,
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
  return [...items].sort((first, second) =>
    compareRectsReadingOrder(sortableRect(first), sortableRect(second)),
  );
}

function findMaskRects(imageData: RgbaImageData, options: DetectionOptions) {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const imageArea = imageData.width * imageData.height;

  const candidates = findComponents(imageData, (pixelIndex) =>
    isMaskPixel(imageData.data, pixelIndex),
  )
    .filter((component) => isMaskComponent(component, imageArea, resolvedOptions))
    .map(componentToRect)
    .map((rect) => expandRect(rect, imageData.width, imageData.height, 1.04));

  return sortRectsReadingOrder(deduplicateRects(candidates));
}

function isMaskComponent(
  component: Component,
  imageArea: number,
  options: Required<DetectionOptions>,
) {
  const rect = componentToRect(component);
  const area = rect.width * rect.height;
  const aspectRatio = rect.width / rect.height;
  const areaRatio = area / imageArea;
  const fillRatio = component.area / area;

  return (
    rect.width >= options.minSidePx &&
    rect.height >= options.minSidePx &&
    areaRatio >= options.minAreaRatio &&
    areaRatio <= options.maxAreaRatio &&
    fillRatio >= 0.5 &&
    aspectRatio >= 0.58 &&
    aspectRatio <= 1.55
  );
}

function detectPanelsFromComponents(imageData: RgbaImageData): PixelRect[] {
  const imageArea = imageData.width * imageData.height;
  const minWidth = Math.max(48, imageData.width * PANEL_COMPONENT_OPTIONS.minWidthRatio);
  const minHeight = Math.max(48, imageData.height * PANEL_COMPONENT_OPTIONS.minHeightRatio);

  const candidates = findComponents(imageData, (pixelIndex) =>
    isPanelPixel(imageData.data, pixelIndex),
  )
    .map((component): PanelCandidate | null => {
      const rect = componentToRect(component);
      const rectArea = rect.width * rect.height;
      const rectAreaRatio = rectArea / imageArea;
      const fillRatio = component.area / rectArea;
      const valid =
        rect.width >= minWidth &&
        rect.height >= minHeight &&
        rectAreaRatio >= PANEL_COMPONENT_OPTIONS.minRectAreaRatio &&
        rectAreaRatio <= PANEL_COMPONENT_OPTIONS.maxRectAreaRatio &&
        fillRatio >= PANEL_COMPONENT_OPTIONS.minFillRatio;

      return valid ? { rect, fillRatio } : null;
    })
    .filter((candidate): candidate is PanelCandidate => Boolean(candidate));

  const rects = candidates.flatMap((candidate) =>
    candidate.fillRatio >= PANEL_COMPONENT_OPTIONS.minSplitFillRatio
      ? splitPanelRectByGutters(imageData, candidate.rect)
      : [candidate.rect],
  );

  return sortRectsReadingOrder(deduplicateRects(rects));
}

function splitPanelRectByGutters(imageData: RgbaImageData, rect: PixelRect): PixelRect[] {
  const minWidth = Math.max(48, imageData.width * PANEL_COMPONENT_OPTIONS.minWidthRatio);
  const minHeight = Math.max(48, imageData.height * PANEL_COMPONENT_OPTIONS.minHeightRatio);
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(imageData.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(imageData.height, Math.ceil(rect.y + rect.height));
  const horizontalGutters = findLineBandsInRange(
    top,
    bottom,
    (position) => rowGutterRatio(imageData, position, left, right - 1),
    GUTTER_SPLIT_OPTIONS.threshold,
  );
  const rowIntervals = lineBandsToIntervalsBetween(top, bottom, horizontalGutters, minHeight);
  const panels: PixelRect[] = [];

  for (const row of rowIntervals) {
    const yStart = Math.max(0, Math.floor(row.start));
    const yEnd = Math.min(imageData.height - 1, Math.ceil(row.end) - 1);
    const verticalGutters = findLineBandsInRange(
      left,
      right,
      (position) => columnGutterRatio(imageData, position, yStart, yEnd),
      GUTTER_SPLIT_OPTIONS.threshold,
    );
    const columnIntervals = lineBandsToIntervalsBetween(left, right, verticalGutters, minWidth);

    for (const column of columnIntervals) {
      panels.push(
        clampRectToBounds(
          {
            x: column.start,
            y: row.start,
            width: column.end - column.start,
            height: row.end - row.start,
          },
          imageData.width,
          imageData.height,
        ),
      );
    }
  }

  return panels.length > 1 ? panels : [rect];
}

function detectPanelsFromLineBands(imageData: RgbaImageData): PixelRect[] {
  const minHeight = Math.max(48, imageData.height * LINE_PANEL_OPTIONS.minHeightRatio);
  const minWidth = Math.max(48, imageData.width * LINE_PANEL_OPTIONS.minWidthRatio);
  const rowBands = findLineBands(
    imageData.height,
    (position) => rowSeparatorScore(imageData, position),
    LINE_PANEL_OPTIONS.horizontalThreshold,
  );
  const rowIntervals = lineBandsToIntervals(imageData.height, rowBands, minHeight);
  const panels: PixelRect[] = [];

  for (const row of rowIntervals) {
    const yStart = Math.max(0, Math.floor(row.start));
    const yEnd = Math.min(imageData.height - 1, Math.ceil(row.end));
    const columnBands = findLineBands(
      imageData.width,
      (position) => columnSeparatorScore(imageData, position, yStart, yEnd),
      LINE_PANEL_OPTIONS.verticalThreshold,
    );
    const columnIntervals = lineBandsToIntervals(imageData.width, columnBands, minWidth);

    for (const column of columnIntervals) {
      panels.push(
        clampRectToBounds(
          {
            x: column.start,
            y: row.start,
            width: column.end - column.start,
            height: row.end - row.start,
          },
          imageData.width,
          imageData.height,
        ),
      );
    }
  }

  return sortRectsReadingOrder(deduplicateRects(panels));
}

function matchMasksToPanels(
  maskRects: PixelRect[],
  panelRects: PixelRect[],
  imageData: RgbaImageData,
): SlotMatch[] {
  const remainingMaskIndexes = new Set(maskRects.map((_, index) => index));
  const matches: SlotMatch[] = [];

  for (const panelRect of sortRectsReadingOrder(panelRects)) {
    const masksInPanel = [...remainingMaskIndexes]
      .filter((maskIndex) => rectContainsCenter(panelRect, maskRects[maskIndex]))
      .map((maskIndex) => ({ maskIndex, rect: maskRects[maskIndex] }));

    for (const mask of sortRectsReadingOrder(masksInPanel)) {
      matches.push({
        rect: mask.rect,
        panelRect,
      });
      remainingMaskIndexes.delete(mask.maskIndex);
    }
  }

  for (const maskIndex of remainingMaskIndexes) {
    const rect = maskRects[maskIndex];
    matches.push({
      rect,
      panelRect: inferPanelRect(imageData, rect),
    });
  }

  return sortSlotsReadingOrder(matches);
}

function sortSlotsReadingOrder(slots: SlotMatch[]) {
  return [...slots].sort((first, second) => {
    const panelComparison = compareRectsReadingOrder(first.panelRect, second.panelRect);

    if (panelComparison !== 0) {
      return panelComparison;
    }

    return compareRectsReadingOrder(first.rect, second.rect);
  });
}

function rectContainsCenter(container: PixelRect, rect: PixelRect) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return (
    centerX >= container.x &&
    centerX <= container.x + container.width &&
    centerY >= container.y &&
    centerY <= container.y + container.height
  );
}

function sortableRect(item: { rect: PixelRect } | PixelRect): PixelRect {
  return "rect" in item ? item.rect : item;
}

function compareRectsReadingOrder(firstRect: PixelRect, secondRect: PixelRect) {
  const rowTolerance = Math.max(firstRect.height, secondRect.height) * 0.7;

  if (Math.abs(firstRect.y - secondRect.y) > rowTolerance) {
    return firstRect.y - secondRect.y;
  }

  return firstRect.x - secondRect.x;
}

function findComponents(
  imageData: RgbaImageData,
  isTargetPixel: (pixelIndex: number) => boolean,
): Component[] {
  const { width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    if (visited[pixelIndex]) {
      continue;
    }

    visited[pixelIndex] = 1;

    if (!isTargetPixel(pixelIndex)) {
      continue;
    }

    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    queue[tail] = pixelIndex;
    tail += 1;

    const enqueueNeighbor = (nextIndex: number, inBounds: boolean) => {
      if (!inBounds || visited[nextIndex]) {
        return;
      }

      visited[nextIndex] = 1;

      if (isTargetPixel(nextIndex)) {
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

function isPanelPixel(data: RgbaImageData["data"], pixelIndex: number) {
  return !isGutterPixel(data, pixelIndex);
}

function isGutterPixel(data: RgbaImageData["data"], pixelIndex: number) {
  const offset = pixelIndex * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  return alpha <= 160 || (red > 244 && green > 244 && blue > 244 && max - min < 28);
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
  const rowBands = findLineBands(
    imageData.height,
    (position) => rowDarkRatio(imageData, position),
    LINE_PANEL_OPTIONS.horizontalThreshold,
  );
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
    LINE_PANEL_OPTIONS.verticalThreshold,
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

function rowSeparatorScore(imageData: RgbaImageData, y: number) {
  return Math.max(rowDarkRatio(imageData, y), rowLongestDarkRunRatio(imageData, y));
}

function columnSeparatorScore(imageData: RgbaImageData, x: number, yStart: number, yEnd: number) {
  return Math.max(
    columnDarkRatio(imageData, x, yStart, yEnd),
    columnLongestDarkRunRatio(imageData, x, yStart, yEnd),
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

function rowLongestDarkRunRatio(imageData: RgbaImageData, y: number) {
  let longestRun = 0;
  let currentRun = 0;

  for (let x = 0; x < imageData.width; x += 1) {
    if (isDarkPixel(imageData, x, y)) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return longestRun / imageData.width;
}

function columnLongestDarkRunRatio(imageData: RgbaImageData, x: number, yStart: number, yEnd: number) {
  let longestRun = 0;
  let currentRun = 0;
  const height = Math.max(1, yEnd - yStart + 1);

  for (let y = yStart; y <= yEnd; y += 1) {
    if (isDarkPixel(imageData, x, y)) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return longestRun / height;
}

function rowGutterRatio(imageData: RgbaImageData, y: number, xStart: number, xEnd: number) {
  let gutter = 0;
  const width = Math.max(1, xEnd - xStart + 1);

  for (let x = xStart; x <= xEnd; x += 1) {
    const pixelIndex = y * imageData.width + x;
    if (isGutterPixel(imageData.data, pixelIndex)) {
      gutter += 1;
    }
  }

  return gutter / width;
}

function columnGutterRatio(imageData: RgbaImageData, x: number, yStart: number, yEnd: number) {
  let gutter = 0;
  const height = Math.max(1, yEnd - yStart + 1);

  for (let y = yStart; y <= yEnd; y += 1) {
    const pixelIndex = y * imageData.width + x;
    if (isGutterPixel(imageData.data, pixelIndex)) {
      gutter += 1;
    }
  }

  return gutter / height;
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
): LineBand[] {
  const bands: LineBand[] = [];
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

function lineBandsToIntervals(length: number, bands: LineBand[], minSize: number): Interval[] {
  return lineBandsToIntervalsBetween(0, length, bands, minSize);
}

function findLineBandsInRange(
  startPosition: number,
  endPosition: number,
  scoreAt: (position: number) => number,
  threshold: number,
): LineBand[] {
  const bands: LineBand[] = [];
  let start: number | null = null;

  for (let position = startPosition; position < endPosition; position += 1) {
    const isLine = scoreAt(position) >= threshold;

    if (isLine && start === null) {
      start = position;
    }

    if ((!isLine || position === endPosition - 1) && start !== null) {
      const end = isLine && position === endPosition - 1 ? position : position - 1;
      if (end - start >= 1) {
        bands.push({ start, end, center: (start + end) / 2 });
      }
      start = null;
    }
  }

  return bands;
}

function lineBandsToIntervalsBetween(
  startPosition: number,
  endPosition: number,
  bands: LineBand[],
  minSize: number,
): Interval[] {
  const boundaries = [startPosition, ...bands.map((band) => band.center), endPosition]
    .sort((first, second) => first - second)
    .filter((position, index, positions) => index === 0 || position - positions[index - 1] > 2);
  const intervals: Interval[] = [];

  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1];
    const end = boundaries[index];

    if (end - start >= minSize) {
      intervals.push({ start, end });
    }
  }

  return intervals.length > 0 ? intervals : [{ start: startPosition, end: endPosition }];
}

function lastBandBefore(bands: LineBand[], position: number) {
  return [...bands].reverse().find((band) => band.center < position);
}

function firstBandAfter(bands: LineBand[], position: number) {
  return bands.find((band) => band.center > position);
}

function fullImageRect(imageData: RgbaImageData): PixelRect {
  return {
    x: 0,
    y: 0,
    width: imageData.width,
    height: imageData.height,
  };
}
