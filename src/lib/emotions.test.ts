import { describe, expect, it } from "vitest";
import {
  averageEmotionScores,
  EXPRESSION_LABELS,
  predictionFromLogits,
  predictionFromScores,
  scoresFromProbabilities,
  softmax,
  TARGET_EXPRESSIONS,
} from "@/lib/emotions";

describe("emotion utilities", () => {
  it("keeps seven target expressions while preserving the model output labels", () => {
    expect(EXPRESSION_LABELS).toHaveLength(8);
    expect(TARGET_EXPRESSIONS).toEqual([
      "Neutral",
      "Happiness",
      "Sadness",
      "Anger",
      "Surprise",
      "Fear",
      "Disgust",
    ]);
  });

  it("computes a stable softmax", () => {
    const probabilities = softmax([1000, 1001, 1002]);

    expect(probabilities.reduce((total, value) => total + value, 0)).toBeCloseTo(1);
    expect(probabilities[2]).toBeGreaterThan(probabilities[1]);
    expect(probabilities[1]).toBeGreaterThan(probabilities[0]);
  });

  it("maps logits to labels and checks target threshold", () => {
    const logits = EXPRESSION_LABELS.map((label) => (label === "Happiness" ? 4 : 0));
    const prediction = predictionFromLogits(logits, "Happiness", 0.45);

    expect(prediction.label).toBe("Happiness");
    expect(prediction.matched).toBe(true);
  });

  it("rejects low-confidence target predictions", () => {
    const scores = scoresFromProbabilities([0.1, 0.1, 0.1, 0.1, 0.3, 0.12, 0.08, 0.1]);
    const prediction = predictionFromScores(scores, "Happiness", 0.45);

    expect(prediction.label).toBe("Happiness");
    expect(prediction.matched).toBe(false);
  });

  it("averages repeated frame scores", () => {
    const first = scoresFromProbabilities([0, 0, 0, 0, 0.8, 0.2, 0, 0]);
    const second = scoresFromProbabilities([0, 0, 0, 0, 0.4, 0.6, 0, 0]);
    const average = averageEmotionScores([first, second]);

    expect(average.Happiness).toBeCloseTo(0.6);
    expect(average.Neutral).toBeCloseTo(0.4);
  });
});
