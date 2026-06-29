export const EXPRESSION_LABELS = [
  "Anger",
  "Contempt",
  "Disgust",
  "Fear",
  "Happiness",
  "Neutral",
  "Sadness",
  "Surprise",
] as const;

export type ExpressionLabel = (typeof EXPRESSION_LABELS)[number];

export type EmotionScores = Record<ExpressionLabel, number>;

export type EmotionPrediction = {
  label: ExpressionLabel;
  confidence: number;
  scores: EmotionScores;
  matched: boolean;
};

export const TARGET_EXPRESSIONS = [
  "Neutral",
  "Happiness",
  "Sadness",
  "Anger",
  "Surprise",
  "Fear",
  "Disgust",
] as const satisfies readonly ExpressionLabel[];

export const MATCH_CONFIDENCE_THRESHOLD = 0.45;

export const expressionNamesKo: Record<ExpressionLabel, string> = {
  Anger: "분노",
  Contempt: "경멸",
  Disgust: "혐오",
  Fear: "불안",
  Happiness: "기쁨",
  Neutral: "무표정",
  Sadness: "슬픔",
  Surprise: "놀람",
};

export function softmax(values: ArrayLike<number>): number[] {
  if (values.length === 0) {
    return [];
  }

  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    max = Math.max(max, values[index]);
  }

  const exps = Array.from(values, (value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

export function scoresFromProbabilities(probabilities: ArrayLike<number>): EmotionScores {
  return EXPRESSION_LABELS.reduce((scores, label, index) => {
    scores[label] = probabilities[index] ?? 0;
    return scores;
  }, {} as EmotionScores);
}

export function averageEmotionScores(scoreList: EmotionScores[]): EmotionScores {
  if (scoreList.length === 0) {
    return scoresFromProbabilities(new Array(EXPRESSION_LABELS.length).fill(0));
  }

  const totals = scoresFromProbabilities(new Array(EXPRESSION_LABELS.length).fill(0));
  for (const scores of scoreList) {
    for (const label of EXPRESSION_LABELS) {
      totals[label] += scores[label];
    }
  }

  for (const label of EXPRESSION_LABELS) {
    totals[label] /= scoreList.length;
  }

  return totals;
}

export function topEmotion(scores: EmotionScores): Pick<EmotionPrediction, "label" | "confidence"> {
  return EXPRESSION_LABELS.reduce(
    (best, label) => {
      const confidence = scores[label];
      return confidence > best.confidence ? { label, confidence } : best;
    },
    { label: "Neutral", confidence: -1 } as Pick<EmotionPrediction, "label" | "confidence">,
  );
}

export function predictionFromScores(
  scores: EmotionScores,
  targetExpression: ExpressionLabel,
  threshold = MATCH_CONFIDENCE_THRESHOLD,
): EmotionPrediction {
  const top = topEmotion(scores);
  return {
    ...top,
    scores,
    matched: top.label === targetExpression && top.confidence >= threshold,
  };
}

export function predictionFromLogits(
  logits: ArrayLike<number>,
  targetExpression: ExpressionLabel,
  threshold = MATCH_CONFIDENCE_THRESHOLD,
): EmotionPrediction {
  return predictionFromScores(scoresFromProbabilities(softmax(logits)), targetExpression, threshold);
}

export function scoresFromLogits(logits: ArrayLike<number>): EmotionScores {
  return scoresFromProbabilities(softmax(logits));
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
