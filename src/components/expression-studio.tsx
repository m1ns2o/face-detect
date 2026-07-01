"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Download,
  ImagePlus,
  LoaderCircle,
  RefreshCcw,
  ScanFace,
  ShieldCheck,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createEmotionRuntime,
  createFaceLandmarker,
  withSuppressedMediaPipeInfoLogs,
  type EmotionRuntime,
} from "@/lib/browser-models";
import {
  averageEmotionScores,
  expressionNamesKo,
  formatPercent,
  predictionFromScores,
  type EmotionPrediction,
  type EmotionScores,
  type ExpressionLabel,
} from "@/lib/emotions";
import {
  coverRect,
  cropCanvasFromRect,
  squareFaceRectFromLandmarks,
  type PixelRect,
} from "@/lib/canvas";
import {
  COMIC_TARGET_EXPRESSIONS,
  DEFAULT_COMIC_TARGETS,
  detectComicFaceSlots,
  scaleRect,
  type DetectedComicSlot,
} from "@/lib/comic";
import type { SampleComicAsset, SampleFaceAsset } from "@/lib/sample-assets";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ModelState = "loading" | "ready" | "error";
type CaptureStatus = "idle" | "capturing" | "complete" | "error";
type UploadStatus = "idle" | "analyzing" | "ready" | "error";

type SuccessfulSample = {
  scores: EmotionScores;
  faceCanvas: HTMLCanvasElement;
};

type ComicSlot = DetectedComicSlot & {
  targetEmotion: ExpressionLabel;
  panelPreviewSrc: string;
};

type ComicProject = {
  fileName: string;
  imageSrc: string;
  width: number;
  height: number;
  slots: ComicSlot[];
};

type CapturedComicSlot = {
  faceCanvas: HTMLCanvasElement;
  prediction: EmotionPrediction;
};

type ExpressionStudioProps = {
  testAssets?: {
    sampleComic: SampleComicAsset;
    sampleFaces: readonly SampleFaceAsset[];
  };
};

const SAMPLE_COUNT = 5;
const SAMPLE_DELAY_MS = 240;
const CAPTURE_ELAPSED_TICK_MS = 100;
const MAX_DETECTION_SIDE = 1200;
const MAX_PANEL_PREVIEW_SIDE = 640;

export function ExpressionStudio({ testAssets }: ExpressionStudioProps) {
  const testMode = Boolean(testAssets);
  const sampleFaces = testAssets?.sampleFaces ?? [];
  const [modelState, setModelState] = useState<ModelState>("loading");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [statusText, setStatusText] = useState("모델 준비 중");
  const [cameraReady, setCameraReady] = useState(false);
  const [comicProject, setComicProject] = useState<ComicProject | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [captures, setCaptures] = useState<Record<string, CapturedComicSlot>>({});
  const [prediction, setPrediction] = useState<EmotionPrediction | null>(null);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureElapsedMs, setCaptureElapsedMs] = useState(0);
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sampleFaceBusyId, setSampleFaceBusyId] = useState<string | null>(null);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const emotionRuntimeRef = useRef<EmotionRuntime | null>(null);
  const captureProgressTimerRef = useRef<number | null>(null);

  const activeSlot = useMemo(
    () => comicProject?.slots.find((slot) => slot.id === activeSlotId) ?? null,
    [activeSlotId, comicProject],
  );
  const activeSlotIndex = activeSlot ? activeSlot.index : -1;
  const completedCount = comicProject
    ? comicProject.slots.filter((slot) => Boolean(captures[slot.id])).length
    : 0;
  const totalSlots = comicProject?.slots.length ?? 0;
  const allComplete = totalSlots > 0 && completedCount === totalSlots;
  const busy =
    captureStatus === "capturing" || uploadStatus === "analyzing" || sampleFaceBusyId !== null;
  const captureDisabled = modelState !== "ready" || !cameraReady || !activeSlot || busy;
  const sampleFaceDisabled =
    !testMode || modelState !== "ready" || !activeSlot || !comicProject || busy;
  const activeCapture = activeSlot ? captures[activeSlot.id] : null;
  const nextSlot = comicProject?.slots[activeSlotIndex + 1] ?? null;
  const downloadName = `${fileNameWithoutExtension(comicProject?.fileName ?? "webtoon")}-face-webtoon.png`;

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  function formatElapsedMs(elapsedMs: number) {
    const seconds = Math.max(0, Math.round(elapsedMs / 1000));
    return `${seconds}s`;
  }

  useEffect(() => {
    let mounted = true;

    async function loadModels() {
      try {
        setStatusText("모델 준비 중");
        const [faceLandmarker, emotionRuntime] = await Promise.all([
          createFaceLandmarker(),
          createEmotionRuntime(),
        ]);

        if (!mounted) {
          faceLandmarker.close();
          return;
        }

        faceLandmarkerRef.current = faceLandmarker;
        emotionRuntimeRef.current = emotionRuntime;
        setModelState("ready");
        setStatusText("준비 완료");
      } catch (error) {
        console.error(error);
        if (mounted) {
          setModelState("error");
          setLastError("모델 파일을 불러오지 못했습니다.");
          setStatusText("모델 오류");
        }
      }
    }

    loadModels();

    return () => {
      mounted = false;
      if (captureProgressTimerRef.current !== null) {
        window.clearInterval(captureProgressTimerRef.current);
        captureProgressTimerRef.current = null;
      }
      stopCamera();
      faceLandmarkerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (comicProject?.imageSrc.startsWith("blob:")) {
        URL.revokeObjectURL(comicProject.imageSrc);
      }
    };
  }, [comicProject?.imageSrc]);

  async function loadComicFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setUploadStatus("error");
      setLastError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    const imageSrc = URL.createObjectURL(file);
    setUploadStatus("analyzing");
    setLastError(null);
    setPrediction(null);
    setCaptures({});
    setCompositeUrl(null);
    setCaptureProgress(0);
    setCaptureElapsedMs(0);
    setStatusText("웹툰 분석 중");

    try {
      const image = await loadImage(imageSrc);
      const nextProject = analyzeComicImage(file.name, imageSrc, image);

      setComicProject(nextProject);
      setActiveSlotId(nextProject.slots[0]?.id ?? null);
      setUploadStatus("ready");
      setCaptureStatus("idle");
      setStatusText(`${nextProject.slots.length}컷 준비`);
    } catch (error) {
      console.error(error);
      URL.revokeObjectURL(imageSrc);
      setComicProject(null);
      setActiveSlotId(null);
      setUploadStatus("error");
      setCaptureStatus("error");
      setStatusText("웹툰 분석 오류");
      setLastError(
        error instanceof Error
          ? error.message
          : "마스킹된 얼굴 위치를 찾지 못했습니다.",
      );
    }
  }

  async function handleComicUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (file) {
      await loadComicFile(file);
    }
  }

  function handleUploadDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();

    if (!busy) {
      setIsDraggingUpload(true);
    }
  }

  function handleUploadDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingUpload(false);
  }

  async function handleUploadDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingUpload(false);

    if (busy) {
      return;
    }

    const file = Array.from(event.dataTransfer.files).find((item) =>
      item.type.startsWith("image/"),
    );

    if (!file) {
      setUploadStatus("error");
      setLastError("드롭한 항목에서 이미지 파일을 찾지 못했습니다.");
      return;
    }

    await loadComicFile(file);
  }

  async function loadSampleComic() {
    if (!testAssets) {
      return;
    }

    setUploadStatus("analyzing");
    setLastError(null);
    setPrediction(null);
    setCaptures({});
    setCompositeUrl(null);
    setCaptureProgress(0);
    setCaptureElapsedMs(0);
    setStatusText("샘플 웹툰 분석 중");

    try {
      const image = await loadImage(testAssets.sampleComic.imageSrc);
      const nextProject = analyzeComicImage(
        testAssets.sampleComic.title,
        testAssets.sampleComic.imageSrc,
        image,
      );

      setComicProject(nextProject);
      setActiveSlotId(nextProject.slots[0]?.id ?? null);
      setUploadStatus("ready");
      setCaptureStatus("idle");
      setStatusText(`${nextProject.slots.length}컷 준비`);
    } catch (error) {
      console.error(error);
      setComicProject(null);
      setActiveSlotId(null);
      setUploadStatus("error");
      setCaptureStatus("error");
      setStatusText("샘플 분석 오류");
      setLastError(
        error instanceof Error
          ? error.message
          : "샘플 웹툰에서 마스킹된 얼굴 위치를 찾지 못했습니다.",
      );
    }
  }

  function selectSlot(slotId: string) {
    setActiveSlotId(slotId);
    setCaptureStatus("idle");
    setCaptureProgress(0);
    setCaptureElapsedMs(0);
    setPrediction(captures[slotId]?.prediction ?? null);
    setStatusText(modelState === "ready" ? "준비 완료" : "모델 준비 중");
  }

  function updateSlotTarget(slotId: string, targetEmotion: ExpressionLabel) {
    const currentCapture = captures[slotId];

    setComicProject((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        slots: current.slots.map((slot) =>
          slot.id === slotId ? { ...slot, targetEmotion } : slot,
        ),
      };
    });

    if (slotId === activeSlotId && currentCapture) {
      setPrediction(predictionFromScores(currentCapture.prediction.scores, targetEmotion));
    }

    setCaptures((current) => {
      const capture = current[slotId];
      if (!capture) {
        return current;
      }

      const nextPrediction = predictionFromScores(capture.prediction.scores, targetEmotion);

      return {
        ...current,
        [slotId]: {
          ...capture,
          prediction: nextPrediction,
        },
      };
    });
  }

  async function startCamera() {
    setLastError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCaptureStatus("error");
      setLastError("이 브라우저는 웹캠 접근을 지원하지 않습니다.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      setCaptureStatus("idle");
      setStatusText("카메라 준비");
    } catch (error) {
      console.error(error);
      setCameraReady(false);
      setCaptureStatus("error");
      setLastError("웹캠 권한을 확인할 수 없습니다.");
    }
  }

  async function captureAndAnalyze() {
    const faceLandmarker = faceLandmarkerRef.current;
    const emotionRuntime = emotionRuntimeRef.current;
    const video = videoRef.current;

    if (!comicProject || !activeSlot) {
      setLastError("먼저 마스킹된 웹툰 이미지를 업로드해 주세요.");
      return;
    }

    if (!faceLandmarker || !emotionRuntime || !video) {
      setLastError("분석 모델이 아직 준비되지 않았습니다.");
      return;
    }

    if (!video.videoWidth || !video.videoHeight) {
      setLastError("웹캠 프레임을 아직 읽을 수 없습니다.");
      return;
    }

    setPrediction(null);
    setLastError(null);
    setCaptureStatus("capturing");
    setCaptureProgress(0);
    setCaptureElapsedMs(0);

    if (captureProgressTimerRef.current !== null) {
      window.clearInterval(captureProgressTimerRef.current);
    }

    let elapsedMs = 0;
    captureProgressTimerRef.current = window.setInterval(() => {
      elapsedMs += CAPTURE_ELAPSED_TICK_MS;
      setCaptureElapsedMs(elapsedMs);
    }, CAPTURE_ELAPSED_TICK_MS);

    const samples: SuccessfulSample[] = [];

    try {
      for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        setCaptureProgress(((index + 1) / SAMPLE_COUNT) * 100);
        setStatusText(`${activeSlot.index + 1}컷 분석 중 ${index + 1}/${SAMPLE_COUNT}`);
        const frameCanvas = captureVideoFrame(video);
        const detection = detectFace(faceLandmarker, frameCanvas);
        const landmarks = detection.faceLandmarks[0];

        if (landmarks?.length) {
          const faceRect = squareFaceRectFromLandmarks(
            landmarks,
            frameCanvas.width,
            frameCanvas.height,
          );
          const faceCanvas = cropCanvasFromRect(frameCanvas, faceRect);
          const scores = await emotionRuntime.predict(faceCanvas);
          samples.push({ scores, faceCanvas });
        }

        if (index < SAMPLE_COUNT - 1) {
          await wait(SAMPLE_DELAY_MS);
        }
      }

      if (samples.length === 0) {
        setCaptureStatus("error");
        setStatusText("얼굴 미검출");
        setLastError("얼굴 영역을 찾지 못했습니다.");
        return;
      }

      const averaged = averageEmotionScores(samples.map((sample) => sample.scores));
      const nextPrediction = predictionFromScores(averaged, activeSlot.targetEmotion);
      const strongestSample = samples[samples.length - 1];
      const nextCaptures = {
        ...captures,
        [activeSlot.id]: {
          faceCanvas: strongestSample.faceCanvas,
          prediction: nextPrediction,
        },
      };
      const nextCompositeUrl = await renderComicComposite(comicProject, nextCaptures);

      setCaptures(nextCaptures);
      setPrediction(nextPrediction);
      setCompositeUrl(nextCompositeUrl);
      setCaptureStatus("complete");
      setCaptureProgress(100);

      const nextIncompleteSlot = comicProject.slots
        .slice(activeSlot.index + 1)
        .find((slot) => !nextCaptures[slot.id]);

      if (nextIncompleteSlot) {
        setActiveSlotId(nextIncompleteSlot.id);
        setPrediction(null);
        setStatusText(`${nextIncompleteSlot.index + 1}컷 준비`);
      } else if (Object.keys(nextCaptures).length === comicProject.slots.length) {
        setStatusText("완성본 준비");
      } else {
        setStatusText(nextPrediction.matched ? "표정 일치" : "재촬영 권장");
      }
    } catch (error) {
      console.error(error);
      setCaptureStatus("error");
      setStatusText("분석 오류");
      setLastError("표정 분석 중 오류가 발생했습니다.");
    } finally {
      if (captureProgressTimerRef.current !== null) {
        window.clearInterval(captureProgressTimerRef.current);
        captureProgressTimerRef.current = null;
      }
    }
  }

  async function applySampleFace(preset: SampleFaceAsset) {
    const faceLandmarker = faceLandmarkerRef.current;
    const emotionRuntime = emotionRuntimeRef.current;

    if (!comicProject || !activeSlot) {
      setLastError("먼저 샘플 웹툰을 불러오거나 마스킹된 웹툰 이미지를 업로드해 주세요.");
      return;
    }

    if (!faceLandmarker || !emotionRuntime) {
      setLastError("분석 모델이 아직 준비되지 않았습니다.");
      return;
    }

    setPrediction(null);
    setLastError(null);
    setSampleFaceBusyId(preset.id);
    setCaptureStatus("capturing");
    setCaptureProgress(15);
    setCaptureElapsedMs(0);
    setStatusText(`${preset.name} 분석 중`);

    try {
      const frameCanvas = await loadImageCanvas(preset.imageSrc);
      setCaptureProgress(35);
      const detection = detectFace(faceLandmarker, frameCanvas);
      const landmarks = detection.faceLandmarks[0];

      if (!landmarks?.length) {
        setCaptureStatus("error");
        setStatusText("얼굴 미검출");
        setLastError(`${preset.name} 이미지에서 얼굴 영역을 찾지 못했습니다.`);
        return;
      }

      const faceRect = squareFaceRectFromLandmarks(
        landmarks,
        frameCanvas.width,
        frameCanvas.height,
      );
      const faceCanvas = cropCanvasFromRect(frameCanvas, faceRect);
      setCaptureProgress(70);
      const scores = await emotionRuntime.predict(faceCanvas);
      const nextPrediction = predictionFromScores(scores, activeSlot.targetEmotion);
      const nextCaptures = {
        ...captures,
        [activeSlot.id]: {
          faceCanvas,
          prediction: nextPrediction,
        },
      };
      const nextCompositeUrl = await renderComicComposite(comicProject, nextCaptures);

      setCaptures(nextCaptures);
      setPrediction(nextPrediction);
      setCompositeUrl(nextCompositeUrl);
      setCaptureStatus("complete");
      setCaptureProgress(100);

      const nextIncompleteSlot = comicProject.slots
        .slice(activeSlot.index + 1)
        .find((slot) => !nextCaptures[slot.id]);

      if (nextIncompleteSlot) {
        setActiveSlotId(nextIncompleteSlot.id);
        setPrediction(null);
        setStatusText(`${nextIncompleteSlot.index + 1}컷 준비`);
      } else if (Object.keys(nextCaptures).length === comicProject.slots.length) {
        setStatusText("완성본 준비");
      } else {
        setStatusText(`${preset.name} 적용`);
      }
    } catch (error) {
      console.error(error);
      setCaptureStatus("error");
      setStatusText("테스트 얼굴 오류");
      setLastError("테스트 얼굴을 분석하거나 합성하는 중 오류가 발생했습니다.");
    } finally {
      setSampleFaceBusyId(null);
    }
  }

  async function renderComicComposite(
    project: ComicProject,
    nextCaptures: Record<string, CapturedComicSlot>,
  ) {
    const sourceImage = await loadImage(project.imageSrc);
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = project.width;
    canvas.height = project.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    for (const slot of project.slots) {
      const capture = nextCaptures[slot.id];
      if (!capture) {
        continue;
      }

      const drawRect = coverRect(capture.faceCanvas.width, capture.faceCanvas.height, slot.rect);
      drawFaceIntoSlot(context, capture.faceCanvas, slot.rect, drawRect);
    }

    return canvas.toDataURL("image/png");
  }

  function renderCurrentCutCard(className?: string) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>
            <h2>현재 컷</h2>
          </CardTitle>
          <CardDescription>
            {activeSlot
              ? `${activeSlot.index + 1}/${totalSlots} · ${
                  expressionNamesKo[activeSlot.targetEmotion]
                }`
              : "업로드 대기"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="relative grid min-h-64 place-items-center overflow-hidden rounded-lg border bg-muted"
            style={{
              aspectRatio: activeSlot
                ? `${activeSlot.panelRect.width} / ${activeSlot.panelRect.height}`
                : "16 / 9",
            }}
          >
            {activeSlot ? (
              <img
                src={activeSlot.panelPreviewSrc}
                alt={`${activeSlot.index + 1}컷`}
                className="h-full w-full object-contain"
              />
            ) : (
              <ImagePlus className="size-10 text-muted-foreground" aria-hidden />
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-2 text-sm font-medium">
              목표 표정
              <select
                value={activeSlot?.targetEmotion ?? "Neutral"}
                disabled={!activeSlot || busy}
                onChange={(event) => {
                  if (activeSlot) {
                    updateSlotTarget(activeSlot.id, event.target.value as ExpressionLabel);
                  }
                }}
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {COMIC_TARGET_EXPRESSIONS.map((label) => (
                  <option key={label} value={label}>
                    {expressionNamesKo[label]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={!nextSlot || !activeCapture || busy}
              onClick={() => {
                if (nextSlot) {
                  selectSlot(nextSlot.id);
                }
              }}
            >
              <ArrowRight data-icon="inline-start" className="size-4" />
              다음 컷
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderCompletionPreview() {
    if (!allComplete || !compositeUrl) {
      return null;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>완성본</h2>
          </CardTitle>
          <CardDescription>모든 컷 촬영이 끝났습니다.</CardDescription>
          <CardAction>
            <Badge variant="default" className="font-mono">
              100%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div
            className="relative grid max-h-[72vh] place-items-center overflow-hidden rounded-lg border bg-muted"
            style={{
              aspectRatio: `${comicProject?.width ?? 1} / ${comicProject?.height ?? 1}`,
            }}
          >
            <img
              src={compositeUrl}
              alt="웹툰 완성본 미리보기"
              className="h-full w-full object-contain"
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <MetricRow label="진행" value={`${completedCount}/${totalSlots}`} />
            <MetricRow
              label="마지막 목표"
              value={activeSlot ? expressionNamesKo[activeSlot.targetEmotion] : "-"}
            />
            <MetricRow
              label="마지막 예측"
              value={prediction ? expressionNamesKo[prediction.label] : "-"}
            />
            <MetricRow
              label="신뢰도"
              value={prediction ? formatPercent(prediction.confidence) : "-"}
            />
          </div>

          <Separator className="my-4" />

          <a
            href={compositeUrl}
            download={downloadName}
            className={cn(buttonVariants({ variant: "default", size: "lg" }), "w-full")}
          >
            <Download data-icon="inline-start" className="size-4" aria-hidden />
            PNG 저장
          </a>
        </CardContent>
      </Card>
    );
  }

  if (!comicProject) {
    return (
      <main className="min-h-screen bg-background px-4 py-4 text-foreground sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl flex-col justify-center gap-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                icon={modelState === "ready" ? CheckCircle2 : LoaderCircle}
                label={modelState === "ready" ? "모델 준비" : "모델 로딩"}
                active={modelState === "ready"}
              />
              <StatusBadge icon={ShieldCheck} label="로컬 처리" active />
              <StatusBadge
                icon={uploadStatus === "analyzing" ? LoaderCircle : Upload}
                label={uploadStatus === "analyzing" ? "웹툰 분석 중" : "업로드 대기"}
                active={uploadStatus === "analyzing"}
              />
            </div>

            {testMode && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={loadSampleComic}
                disabled={busy}
              >
                <ImagePlus data-icon="inline-start" className="size-4" />
                샘플 웹툰
              </Button>
            )}
          </header>

          <input
            id="comic-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={handleComicUpload}
            disabled={busy}
          />

          <label
            htmlFor="comic-upload"
            data-testid="comic-dropzone"
            onDragOver={handleUploadDragOver}
            onDragLeave={handleUploadDragLeave}
            onDrop={handleUploadDrop}
            className={cn(
              "group grid min-h-[64vh] cursor-pointer place-items-center rounded-lg border border-dashed border-border bg-card p-6 text-center shadow-sm transition",
              "hover:border-primary/60 hover:bg-accent/35 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40",
              isDraggingUpload && "border-primary bg-primary/5 ring-3 ring-primary/20",
              busy && "pointer-events-none opacity-70",
            )}
          >
            <div className="flex max-w-xl flex-col items-center gap-5">
              <span className="grid size-16 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                {uploadStatus === "analyzing" ? (
                  <LoaderCircle className="size-8 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-8" aria-hidden />
                )}
              </span>
              <div className="grid gap-2">
                <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                  웹툰 이미지 업로드
                </h1>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                  얼굴 마스크가 들어간 웹툰 이미지를 선택하거나 이 영역으로 드롭하세요.
                </p>
              </div>
              <span className={buttonVariants({ variant: "default", size: "lg" })}>
                <ImagePlus data-icon="inline-start" className="size-4" />
                파일 선택
              </span>
              {uploadStatus === "analyzing" && (
                <div className="w-full max-w-sm">
                  <Progress value={65} aria-label="웹툰 분석 진행률" />
                </div>
              )}
            </div>
          </label>

          {lastError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden />
              <AlertTitle>처리 실패</AlertTitle>
              <AlertDescription>{lastError}</AlertDescription>
            </Alert>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" aria-hidden />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-4 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              icon={modelState === "ready" ? CheckCircle2 : LoaderCircle}
              label={modelState === "ready" ? "모델 준비" : "모델 로딩"}
              active={modelState === "ready"}
            />
            <StatusBadge icon={ShieldCheck} label="로컬 처리" active />
            <StatusBadge
              icon={uploadStatus === "analyzing" ? LoaderCircle : ImagePlus}
              label={comicProject ? `${totalSlots}컷 감지` : "웹툰 대기"}
              active={Boolean(comicProject)}
            />
          </div>
          {testMode && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={loadSampleComic}
              disabled={busy}
            >
              <ImagePlus data-icon="inline-start" className="size-4" />
              샘플 웹툰
            </Button>
          )}
        </header>

        <section className="grid gap-4 xl:grid-cols-[320px_minmax(460px,1fr)_380px]">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>
                <h2 className="flex items-center gap-2">
                  <ImagePlus className="size-5 text-primary" aria-hidden />
                  웹툰
                </h2>
              </CardTitle>
              <CardAction>
                <Badge variant="outline" className="font-mono">
                  {totalSlots > 0 ? `${completedCount}/${totalSlots}` : "0/0"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {uploadStatus === "analyzing" && (
                <div className="mb-4 grid gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">마스크 추정</span>
                    <span className="font-medium">진행 중</span>
                  </div>
                  <Progress value={65} aria-label="웹툰 분석 진행률" />
                </div>
              )}

              {comicProject ? (
                <div className="grid gap-2">
                  {comicProject.slots.map((slot) => {
                    const selected = slot.id === activeSlotId;
                    const captured = Boolean(captures[slot.id]);

                    return (
                      <Button
                        key={slot.id}
                        type="button"
                        variant={selected ? "secondary" : "ghost"}
                        onClick={() => selectSlot(slot.id)}
                        className={cn(
                          "h-auto justify-start gap-3 rounded-lg border p-2 text-left",
                          selected ? "border-primary/40" : "border-transparent",
                        )}
                      >
                        <span className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                          <img
                            src={slot.panelPreviewSrc}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{slot.index + 1}컷</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {expressionNamesKo[slot.targetEmotion]}
                          </span>
                        </span>
                        {captured && (
                          <CheckCircle2 className="size-4 text-[var(--status-good)]" aria-hidden />
                        )}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid min-h-48 place-items-center rounded-lg border border-dashed bg-muted/30 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="size-9 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium text-muted-foreground">
                      마스크 이미지 대기
                    </span>
                    {testMode && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={loadSampleComic}
                        disabled={busy}
                      >
                        <ImagePlus data-icon="inline-start" className="size-4" />
                        샘플 웹툰
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {renderCurrentCutCard("order-2 xl:hidden")}

            {testMode && (
              <Card className="order-3">
                <CardHeader>
                  <CardTitle>
                    <h2>테스트 얼굴</h2>
                  </CardTitle>
                  <CardDescription>
                    {activeSlot ? `${activeSlot.index + 1}컷에 바로 적용` : "웹툰 선택 대기"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {sampleFaces.map((preset) => {
                      const recommended = preset.expectedExpression === activeSlot?.targetEmotion;
                      const loading = sampleFaceBusyId === preset.id;

                      return (
                        <div key={preset.id} className="rounded-lg border bg-background p-2">
                          <Button
                            type="button"
                            variant={recommended ? "secondary" : "ghost"}
                            onClick={() => applySampleFace(preset)}
                            disabled={sampleFaceDisabled}
                            className="h-auto w-full justify-start gap-3 p-2 text-left"
                          >
                            <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-muted">
                              <img
                                src={preset.imageSrc}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {preset.name}
                              </span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">
                                {expressionNamesKo[preset.expectedExpression]} · {preset.role}
                              </span>
                            </span>
                            {loading ? (
                              <LoaderCircle className="size-4 animate-spin" aria-hidden />
                            ) : recommended ? (
                              <Badge variant="outline" className="h-6 rounded-md px-2">
                                추천
                              </Badge>
                            ) : null}
                          </Button>
                          <a
                            href={preset.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block truncate px-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {preset.license}
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="order-1">
              <CardHeader>
                <CardTitle>
                  <h2 className="flex items-center gap-2">
                    <ScanFace className="size-5 text-primary" aria-hidden />
                    웹캠
                  </h2>
                </CardTitle>
                <CardDescription className="font-mono">
                  {captureStatus === "capturing"
                    ? `${statusText} (${formatElapsedMs(captureElapsedMs)})`
                    : statusText}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-black">
                  <video
                    ref={videoRef}
                    className={cn("h-full w-full object-cover", cameraReady && "scale-x-[-1]")}
                    playsInline
                    muted
                  />
                  {!cameraReady && (
                    <div className="absolute inset-0 grid place-items-center bg-muted text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Video className="size-10 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-medium text-muted-foreground">
                          카메라 대기
                        </span>
                      </div>
                    </div>
                  )}
                  {captureStatus === "capturing" && (
                    <div className="absolute inset-0 grid place-items-center bg-black/50 text-white">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <LoaderCircle className="size-5 animate-spin" aria-hidden />
                        {statusText} ({formatElapsedMs(captureElapsedMs)})
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={cameraReady ? stopCamera : startCamera}
                    disabled={uploadStatus === "analyzing"}
                  >
                    {cameraReady ? (
                      <RefreshCcw data-icon="inline-start" className="size-4" />
                    ) : (
                      <Camera data-icon="inline-start" className="size-4" />
                    )}
                    {cameraReady ? "카메라 중지" : "카메라 시작"}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    onClick={captureAndAnalyze}
                    disabled={captureDisabled}
                  >
                    {captureStatus === "capturing" ? (
                      <LoaderCircle data-icon="inline-start" className="size-4 animate-spin" />
                    ) : (
                      <ScanFace data-icon="inline-start" className="size-4" />
                    )}
                    현재 컷 촬영
                  </Button>
                </div>

                {captureStatus === "capturing" && (
                  <div className="mt-4">
                    <Progress value={Math.round(captureProgress)} aria-label="표정 분석 진행률" />
                  </div>
                )}

                {lastError && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="size-4" aria-hidden />
                    <AlertTitle>처리 실패</AlertTitle>
                    <AlertDescription>{lastError}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>

          {renderCurrentCutCard("hidden self-start xl:block")}
        </section>

        {renderCompletionPreview()}
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden />
    </main>
  );
}

function StatusBadge({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
}) {
  return (
    <Badge variant={active ? "default" : "outline"} className="h-8 gap-2 rounded-lg px-3">
      <Icon className={cn("size-3.5", !active && Icon === LoaderCircle && "animate-spin")} />
      {label}
    </Badge>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function analyzeComicImage(fileName: string, imageSrc: string, image: HTMLImageElement): ComicProject {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const detectionScale = Math.min(1, MAX_DETECTION_SIDE / Math.max(width, height));
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = Math.max(1, Math.round(width * detectionScale));
  analysisCanvas.height = Math.max(1, Math.round(height * detectionScale));

  const context = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.drawImage(image, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const imageData = context.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const detectedSlots = detectComicFaceSlots(imageData);

  if (detectedSlots.length === 0) {
    throw new Error("흰색 원형 마스크를 찾지 못했습니다.");
  }

  const sourceScale = 1 / detectionScale;
  const slots = detectedSlots.map((slot, index) => {
    const rect = scaleRect(slot.rect, sourceScale);
    const panelRect = scaleRect(slot.panelRect, sourceScale);

    return {
      ...slot,
      id: `cut-${index + 1}`,
      index,
      rect,
      panelRect,
      targetEmotion: DEFAULT_COMIC_TARGETS[index] ?? "Neutral",
      panelPreviewSrc: createPanelPreview(image, panelRect),
    };
  });

  return {
    fileName,
    imageSrc,
    width,
    height,
    slots,
  };
}

function createPanelPreview(image: HTMLImageElement, rect: PixelRect) {
  const scale = Math.min(1, MAX_PANEL_PREVIEW_SIDE / Math.max(rect.width, rect.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL("image/png");
}

function drawFaceIntoSlot(
  context: CanvasRenderingContext2D,
  faceCanvas: HTMLCanvasElement,
  slot: PixelRect,
  drawRect: PixelRect,
) {
  context.save();
  context.beginPath();
  context.ellipse(
    slot.x + slot.width / 2,
    slot.y + slot.height / 2,
    slot.width / 2,
    slot.height / 2,
    0,
    0,
    Math.PI * 2,
  );
  context.clip();
  context.drawImage(faceCanvas, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  context.restore();

  context.save();
  context.strokeStyle = "rgba(24, 20, 18, 0.22)";
  context.lineWidth = Math.max(2, context.canvas.width * 0.003);
  context.beginPath();
  context.ellipse(
    slot.x + slot.width / 2,
    slot.y + slot.height / 2,
    slot.width / 2,
    slot.height / 2,
    0,
    0,
    Math.PI * 2,
  );
  context.stroke();
  context.restore();
}

function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

async function loadImageCanvas(src: string): Promise<HTMLCanvasElement> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function fileNameWithoutExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function detectFace(
  faceLandmarker: Awaited<ReturnType<typeof createFaceLandmarker>>,
  frameCanvas: HTMLCanvasElement,
) {
  return withSuppressedMediaPipeInfoLogs(() => faceLandmarker.detect(frameCanvas));
}
