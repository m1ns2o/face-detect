"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { scoresFromLogits, type EmotionScores } from "@/lib/emotions";

const EMOTIEFF_INPUT_SIZE = 224;
const IMAGE_NET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGE_NET_STD = [0.229, 0.224, 0.225] as const;

export type EmotionRuntime = {
  predict(faceCanvas: HTMLCanvasElement): Promise<EmotionScores>;
};

export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker: MediaPipeFaceLandmarker, FilesetResolver } = await import(
    "@mediapipe/tasks-vision"
  );
  const vision = await FilesetResolver.forVisionTasks("/wasm/mediapipe");

  return MediaPipeFaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "/models/mediapipe/face_landmarker.task",
      delegate: "CPU",
    },
    numFaces: 1,
    outputFaceBlendshapes: false,
    runningMode: "IMAGE",
  });
}

export async function createEmotionRuntime(): Promise<EmotionRuntime> {
  const ort = await import("onnxruntime-web/wasm");

  ort.env.wasm.wasmPaths = "/wasm/ort/";
  ort.env.wasm.numThreads = 1;

  const session = await ort.InferenceSession.create(
    "/models/emotieff/enet_b0_8_best_vgaf.onnx",
    {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    },
  );
  const inputName = session.inputNames[0] ?? "input";
  const outputName = session.outputNames[0];

  if (!outputName) {
    throw new Error("Emotion model has no output tensor");
  }

  return {
    async predict(faceCanvas: HTMLCanvasElement): Promise<EmotionScores> {
      const input = preprocessFaceCanvas(faceCanvas);
      const tensor = new ort.Tensor("float32", input, [
        1,
        3,
        EMOTIEFF_INPUT_SIZE,
        EMOTIEFF_INPUT_SIZE,
      ]);
      const result = await session.run({ [inputName]: tensor });
      const output = result[outputName]?.data;

      if (!output || typeof output[0] !== "number") {
        throw new Error("Emotion model returned an invalid output tensor");
      }

      return scoresFromLogits(output as ArrayLike<number>);
    },
  };
}

export function preprocessFaceCanvas(faceCanvas: HTMLCanvasElement): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = EMOTIEFF_INPUT_SIZE;
  canvas.height = EMOTIEFF_INPUT_SIZE;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.drawImage(faceCanvas, 0, 0, EMOTIEFF_INPUT_SIZE, EMOTIEFF_INPUT_SIZE);
  const pixels = context.getImageData(0, 0, EMOTIEFF_INPUT_SIZE, EMOTIEFF_INPUT_SIZE).data;
  const input = new Float32Array(3 * EMOTIEFF_INPUT_SIZE * EMOTIEFF_INPUT_SIZE);
  const planeSize = EMOTIEFF_INPUT_SIZE * EMOTIEFF_INPUT_SIZE;

  for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex += 1) {
    const sourceIndex = pixelIndex * 4;
    input[pixelIndex] = (pixels[sourceIndex] / 255 - IMAGE_NET_MEAN[0]) / IMAGE_NET_STD[0];
    input[planeSize + pixelIndex] =
      (pixels[sourceIndex + 1] / 255 - IMAGE_NET_MEAN[1]) / IMAGE_NET_STD[1];
    input[2 * planeSize + pixelIndex] =
      (pixels[sourceIndex + 2] / 255 - IMAGE_NET_MEAN[2]) / IMAGE_NET_STD[2];
  }

  return input;
}
