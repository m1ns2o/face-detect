import { describe, expect, it } from "vitest";
import { detectComicFaceSlots, sortRectsReadingOrder, type RgbaImageData } from "@/lib/comic";
import type { PixelRect } from "@/lib/canvas";

describe("comic mask detection", () => {
  it("finds circular face masks while ignoring wide speech bubbles", () => {
    const imageData = createImageData(400, 240, [230, 210, 180, 255]);

    drawPanelLines(imageData, [8, 196, 392], [8, 118, 232]);
    drawEllipse(imageData, 70, 58, 23, 28, [248, 248, 246, 255]);
    drawEllipse(imageData, 270, 62, 26, 27, [248, 248, 246, 255]);
    drawEllipse(imageData, 76, 176, 24, 26, [248, 248, 246, 255]);
    drawRect(imageData, { x: 220, y: 132, width: 130, height: 34 }, [255, 255, 255, 255]);

    const slots = detectComicFaceSlots(imageData);

    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.index)).toEqual([0, 1, 2]);
    expect(slots[0].rect.x).toBeLessThan(slots[1].rect.x);
    expect(slots[2].rect.y).toBeGreaterThan(slots[0].rect.y);
  });

  it("sorts masks by reading order", () => {
    const sorted = sortRectsReadingOrder([
      { x: 220, y: 120, width: 30, height: 30 },
      { x: 30, y: 20, width: 30, height: 30 },
      { x: 180, y: 24, width: 30, height: 30 },
    ]);

    expect(sorted).toEqual([
      { x: 30, y: 20, width: 30, height: 30 },
      { x: 180, y: 24, width: 30, height: 30 },
      { x: 220, y: 120, width: 30, height: 30 },
    ]);
  });
});

function createImageData(
  width: number,
  height: number,
  color: [number, number, number, number],
): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }

  return { width, height, data };
}

function drawPanelLines(imageData: RgbaImageData, xLines: number[], yLines: number[]) {
  for (const x of xLines) {
    drawRect(imageData, { x, y: 0, width: 3, height: imageData.height }, [18, 18, 18, 255]);
  }

  for (const y of yLines) {
    drawRect(imageData, { x: 0, y, width: imageData.width, height: 3 }, [18, 18, 18, 255]);
  }
}

function drawRect(
  imageData: RgbaImageData,
  rect: PixelRect,
  color: [number, number, number, number],
) {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(imageData.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(imageData.height, Math.ceil(rect.y + rect.height));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      setPixel(imageData, x, y, color);
    }
  }
}

function drawEllipse(
  imageData: RgbaImageData,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: [number, number, number, number],
) {
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
    for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
      const normalizedX = (x - centerX) / radiusX;
      const normalizedY = (y - centerY) / radiusY;

      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
        setPixel(imageData, x, y, color);
      }
    }
  }
}

function setPixel(
  imageData: RgbaImageData,
  x: number,
  y: number,
  color: [number, number, number, number],
) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return;
  }

  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = color[0];
  imageData.data[offset + 1] = color[1];
  imageData.data[offset + 2] = color[2];
  imageData.data[offset + 3] = color[3];
}
