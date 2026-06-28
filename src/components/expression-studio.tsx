"use client";

import Image from "next/image";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCcw,
  ScanFace,
  ShieldCheck,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@/lib/emotions";
import {
  coverRect,
  cropCanvasFromRect,
  normalizedSlotToPixels,
  squareFaceRectFromLandmarks,
  type PixelRect,
} from "@/lib/canvas";
import { templates, type TemplateConfig } from "@/lib/templates";
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

type SuccessfulSample = {
  scores: EmotionScores;
  faceCanvas: HTMLCanvasElement;
};

const SAMPLE_COUNT = 5;
const SAMPLE_DELAY_MS = 240;
const CAPTURE_ELAPSED_TICK_MS = 100;

export function ExpressionStudio() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0].id);
  const [modelState, setModelState] = useState<ModelState>("loading");
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [statusText, setStatusText] = useState("모델 준비 중");
  const [cameraReady, setCameraReady] = useState(false);
  const [prediction, setPrediction] = useState<EmotionPrediction | null>(null);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [captureElapsedMs, setCaptureElapsedMs] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const emotionRuntimeRef = useRef<EmotionRuntime | null>(null);
  const captureProgressTimerRef = useRef<number | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId],
  );

  const busy = captureStatus === "capturing";
  const captureDisabled = modelState !== "ready" || !cameraReady || busy;
  const confidenceValue = prediction ? Math.round(prediction.confidence * 100) : 0;
  const displayProgressValue = prediction ? confidenceValue : captureProgress;

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

    if (!faceLandmarker || !emotionRuntime || !video) {
      setLastError("분석 모델이 아직 준비되지 않았습니다.");
      return;
    }

    if (!video.videoWidth || !video.videoHeight) {
      setLastError("웹캠 프레임을 아직 읽을 수 없습니다.");
      return;
    }

    setPrediction(null);
    setResultUrl(null);
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
        setStatusText(`분석 중 ${index + 1}/${SAMPLE_COUNT}`);
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
      const nextPrediction = predictionFromScores(averaged, selectedTemplate.targetEmotion);
      const strongestSample = samples[samples.length - 1];
      const nextResultUrl = await renderComposite(selectedTemplate, strongestSample.faceCanvas);

      setPrediction(nextPrediction);
      setResultUrl(nextResultUrl);
      setCaptureStatus("complete");
      setCaptureProgress(100);
      setStatusText(nextPrediction.matched ? "표정 일치" : "표정 불일치");
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

  async function renderComposite(template: TemplateConfig, faceCanvas: HTMLCanvasElement) {
    const templateImage = await loadImage(template.imageSrc);
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = templateImage.naturalWidth;
    canvas.height = templateImage.naturalHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(templateImage, 0, 0, canvas.width, canvas.height);

    const slot = normalizedSlotToPixels(template.faceSlot, canvas.width, canvas.height);
    const drawRect = coverRect(faceCanvas.width, faceCanvas.height, slot);

    drawFaceIntoSlot(context, faceCanvas, slot, drawRect, template.faceSlot.rotation);
    return canvas.toDataURL("image/png");
  }

  return (
    <main className="min-h-screen bg-background px-4 py-4 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              icon={modelState === "ready" ? CheckCircle2 : LoaderCircle}
              label={modelState === "ready" ? "모델 준비" : "모델 로딩"}
              active={modelState === "ready"}
            />
            <StatusBadge icon={ShieldCheck} label="로컬 처리" active />
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[300px_minmax(420px,1fr)_360px]">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>
                <h2>템플릿</h2>
              </CardTitle>
              <CardAction>
                <Badge variant="outline" className="font-mono">
                  {templates.length}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {templates.map((template) => {
                const selected = template.id === selectedTemplate.id;
                return (
                  <Button
                    key={template.id}
                    type="button"
                    variant={selected ? "secondary" : "ghost"}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setPrediction(null);
                      setResultUrl(null);
                      setCaptureProgress(0);
                      setCaptureElapsedMs(0);
                      setCaptureStatus("idle");
                      setStatusText(modelState === "ready" ? "준비 완료" : "모델 준비 중");
                    }}
                    className={cn(
                      "h-auto justify-start gap-3 rounded-lg border p-2 text-left",
                      selected ? "border-primary/40" : "border-transparent",
                    )}
                  >
                    <span className="relative aspect-square size-[72px] shrink-0 overflow-hidden rounded-md bg-muted">
                      <Image
                        src={template.imageSrc}
                        alt=""
                        fill
                        sizes="72px"
                        loading={selected ? "eager" : "lazy"}
                        className="object-cover"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{template.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {expressionNamesKo[template.targetEmotion]}
                      </span>
                    </span>
                  </Button>
                );
              })}
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
                {busy && (
                  <div className="absolute inset-0 grid place-items-center bg-black/50 text-white">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <LoaderCircle className="size-5 animate-spin" aria-hidden />
                      {captureStatus === "capturing"
                        ? `${statusText} (${formatElapsedMs(captureElapsedMs)})`
                        : statusText}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="lg" onClick={cameraReady ? stopCamera : startCamera}>
                  {cameraReady ? (
                    <RefreshCcw data-icon="inline-start" className="size-4" />
                  ) : (
                    <Camera data-icon="inline-start" className="size-4" />
                  )}
                  {cameraReady ? "카메라 중지" : "카메라 시작"}
                </Button>
                <Button type="button" size="lg" onClick={captureAndAnalyze} disabled={captureDisabled}>
                  {busy ? (
                    <LoaderCircle data-icon="inline-start" className="size-4 animate-spin" />
                  ) : (
                    <ScanFace data-icon="inline-start" className="size-4" />
                  )}
                  촬영 분석
                </Button>
              </div>

              {lastError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertTitle>처리 실패</AlertTitle>
                  <AlertDescription>{lastError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card className="self-start">
            <CardHeader>
              <CardTitle>
                <h2>결과</h2>
              </CardTitle>
              <CardAction>
                <span
                  className="block size-2.5 rounded-full"
                  style={{ backgroundColor: selectedTemplate.accent }}
                  aria-hidden
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                {resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resultUrl} alt="합성 결과" className="h-full w-full object-cover" />
                ) : (
                  <Image
                    src={selectedTemplate.imageSrc}
                    alt=""
                    fill
                    sizes="360px"
                    className="object-cover"
                    loading="eager"
                  />
                )}
              </div>

              <div className="mt-4 grid gap-3">
                <MetricRow label="목표" value={expressionNamesKo[selectedTemplate.targetEmotion]} />
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
                <Progress
                  value={Math.round(displayProgressValue)}
                  aria-label={prediction ? "표정 신뢰도" : "진행률"}
                />
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
                href={resultUrl ?? "#"}
                download={`${selectedTemplate.id}-face-compose.png`}
                aria-disabled={!resultUrl}
                tabIndex={resultUrl ? undefined : -1}
                onClick={(event) => {
                  if (!resultUrl) {
                    event.preventDefault();
                  }
                }}
                className={cn(
                  buttonVariants({
                    variant: resultUrl ? "default" : "secondary",
                    size: "lg",
                  }),
                  "w-full",
                  !resultUrl && "pointer-events-none opacity-50",
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

function drawFaceIntoSlot(
  context: CanvasRenderingContext2D,
  faceCanvas: HTMLCanvasElement,
  slot: PixelRect,
  drawRect: PixelRect,
  rotation: number,
) {
  context.save();
  context.beginPath();
  context.ellipse(
    slot.x + slot.width / 2,
    slot.y + slot.height / 2,
    slot.width / 2,
    slot.height / 2,
    rotation,
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
    rotation,
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

function detectFace(
  faceLandmarker: Awaited<ReturnType<typeof createFaceLandmarker>>,
  frameCanvas: HTMLCanvasElement,
) {
  return withSuppressedMediaPipeInfoLogs(() => faceLandmarker.detect(frameCanvas));
}
