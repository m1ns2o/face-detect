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
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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

const SAMPLE_COUNT = 5;
const SAMPLE_DELAY_MS = 240;
const CAPTURE_ELAPSED_TICK_MS = 100;
const MAX_DETECTION_SIDE = 1200;
const MAX_PANEL_PREVIEW_SIDE = 640;

export function ExpressionStudio() {
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
  const completionProgress = totalSlots > 0 ? (completedCount / totalSlots) * 100 : 0;
  const allComplete = totalSlots > 0 && completedCount === totalSlots;
  const busy = captureStatus === "capturing" || uploadStatus === "analyzing";
  const captureDisabled = modelState !== "ready" || !cameraReady || !activeSlot || busy;
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

  async function handleComicUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

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

      if (nextPrediction.matched && nextIncompleteSlot) {
        setActiveSlotId(nextIncompleteSlot.id);
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
          <label
            htmlFor="comic-upload"
            className={cn(
              buttonVariants({ variant: "default", size: "lg" }),
              busy && "pointer-events-none opacity-50",
            )}
          >
            {uploadStatus === "analyzing" ? (
              <LoaderCircle data-icon="inline-start" className="size-4 animate-spin" />
            ) : (
              <Upload data-icon="inline-start" className="size-4" />
            )}
            이미지 업로드
          </label>
          <input
            id="comic-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={handleComicUpload}
            disabled={busy}
          />
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
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
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

            <Card>
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

          <Card className="self-start">
            <CardHeader>
              <CardTitle>
                <h2>완성본</h2>
              </CardTitle>
              <CardAction>
                <Badge variant={allComplete ? "default" : "outline"} className="font-mono">
                  {Math.round(completionProgress)}%
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div
                className="relative grid min-h-64 place-items-center overflow-hidden rounded-lg border bg-muted"
                style={{
                  aspectRatio: comicProject ? `${comicProject.width} / ${comicProject.height}` : "1 / 1",
                }}
              >
                {comicProject ? (
                  <img
                    src={compositeUrl ?? comicProject.imageSrc}
                    alt="웹툰 완성본 미리보기"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-10 text-muted-foreground" aria-hidden />
                )}
              </div>

              <div className="mt-4 grid gap-3">
                <MetricRow label="진행" value={`${completedCount}/${totalSlots}`} />
                <MetricRow
                  label="목표"
                  value={activeSlot ? expressionNamesKo[activeSlot.targetEmotion] : "-"}
                />
                <MetricRow
                  label="예측"
                  value={prediction ? expressionNamesKo[prediction.label] : "-"}
                />
                <MetricRow
                  label="신뢰도"
                  value={prediction ? formatPercent(prediction.confidence) : "-"}
                />
              </div>

              <div className="mt-4">
                <Progress value={Math.round(completionProgress)} aria-label="웹툰 완성 진행률" />
              </div>

              {prediction && (
                <Badge
                  variant={prediction.matched ? "default" : "outline"}
                  className={cn(
                    "mt-4 h-7 rounded-lg px-3",
                    prediction.matched
                      ? "bg-[var(--status-good)] text-[var(--status-good-foreground)]"
                      : "border-[var(--status-warn)] text-[var(--status-warn)]",
                  )}
                >
                  {prediction.matched ? "적합" : "재촬영 권장"}
                </Badge>
              )}

              <Separator className="my-4" />

              <a
                href={allComplete && compositeUrl ? compositeUrl : "#"}
                download={downloadName}
                aria-disabled={!allComplete || !compositeUrl}
                tabIndex={allComplete && compositeUrl ? undefined : -1}
                onClick={(event) => {
                  if (!allComplete || !compositeUrl) {
                    event.preventDefault();
                  }
                }}
                className={cn(
                  buttonVariants({
                    variant: allComplete && compositeUrl ? "default" : "secondary",
                    size: "lg",
                  }),
                  "w-full",
                  (!allComplete || !compositeUrl) && "pointer-events-none opacity-50",
                )}
              >
                <Download data-icon="inline-start" className="size-4" aria-hidden />
                PNG 저장
              </a>
            </CardContent>
          </Card>
        </section>
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

function fileNameWithoutExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function detectFace(
  faceLandmarker: Awaited<ReturnType<typeof createFaceLandmarker>>,
  frameCanvas: HTMLCanvasElement,
) {
  return withSuppressedMediaPipeInfoLogs(() => faceLandmarker.detect(frameCanvas));
}
