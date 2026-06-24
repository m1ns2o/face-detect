import { describe, expect, it } from "vitest";
import { coverRect, normalizedSlotToPixels, squareFaceRectFromLandmarks } from "@/lib/canvas";
import type { FaceSlot } from "@/lib/templates";

describe("canvas geometry", () => {
  it("converts normalized template slots to pixels", () => {
    const slot: FaceSlot = {
      x: 0.25,
      y: 0.2,
      width: 0.5,
      height: 0.4,
      rotation: 0,
      shape: "ellipse",
    };

    expect(normalizedSlotToPixels(slot, 1000, 800)).toEqual({
      x: 250,
      y: 160,
      width: 500,
      height: 320,
    });
  });

  it("builds a padded square crop from landmarks", () => {
    const rect = squareFaceRectFromLandmarks(
      [
        { x: 0.4, y: 0.35 },
        { x: 0.6, y: 0.65 },
      ],
      1000,
      800,
      0.25,
    );

    expect(rect.width).toBeCloseTo(rect.height);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });

  it("covers an elliptical target without distorting the source", () => {
    const drawRect = coverRect(400, 200, {
      x: 100,
      y: 120,
      width: 180,
      height: 240,
    });

    expect(drawRect.height).toBe(240);
    expect(drawRect.width).toBe(480);
    expect(drawRect.x).toBe(-50);
  });
});
