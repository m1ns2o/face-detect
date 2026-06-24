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
import { sampleFaces, type SampleFace } from "@/lib/sample-faces";
import { templates, type TemplateConfig } from "@/lib/templates";

type ModelState = "loading" | "ready" | "error";
type CaptureStatus = "idle" | "capturing" | "complete" | "error";

type SuccessfulSample = {
  scores: EmotionScores;
  faceCanvas: HTMLCanvasElement;
};

const SAMPLE_COUNT = 5;
const SAMPLE_DELAY_MS = 240;

export function ExpressionStudio() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0].id);
  const [modelState, setModelState] = useState<ModelState>("loading");
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [statusText, setStatusText] = useState("모델 준비 중");
  const [cameraReady, setCameraReady] = useState(false);
  const [prediction, setPrediction] = useState<EmotionPrediction | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const emotionRuntimeRef = useRef<EmotionRuntime | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0],
    [selectedTemplateId],
  );

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
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

    const samples: SuccessfulSample[] = [];

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
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
    setStatusText(nextPrediction.matched ? "표정 일치" : "표정 불일치");
  }

  async function applySampleFace(sample: SampleFace) {
    const faceLandmarker = faceLandmarkerRef.current;
    const emotionRuntime = emotionRuntimeRef.current;

    if (!faceLandmarker || !emotionRuntime) {
      setLastError("분석 모델이 아직 준비되지 않았습니다.");
      return;
    }

    try {
      setActiveSampleId(sample.id);
      setPrediction(null);
      setResultUrl(null);
      setLastError(null);
      setCaptureStatus("capturing");
      setStatusText("샘플 분석 중");

      const frameCanvas = await loadImageCanvas(sample.imageSrc);
      const detection = detectFace(faceLandmarker, frameCanvas);
      const landmarks = detection.faceLandmarks[0];

      if (!landmarks?.length) {
        throw new Error("샘플 사진에서 얼굴 영역을 찾지 못했습니다.");
      }

      const faceRect = squareFaceRectFromLandmarks(
        landmarks,
        frameCanvas.width,
        frameCanvas.height,
      );
      const faceCanvas = cropCanvasFromRect(frameCanvas, faceRect);
      const scores = await emotionRuntime.predict(faceCanvas);
      const nextPrediction = predictionFromScores(scores, selectedTemplate.targetEmotion);
      const nextResultUrl = await renderComposite(selectedTemplate, faceCanvas);

      setPrediction(nextPrediction);
      setResultUrl(nextResultUrl);
      setCaptureStatus("complete");
      setStatusText("샘플 적용 완료");
    } catch (error) {
      console.error(error);
      setCaptureStatus("error");
      setStatusText("샘플 오류");
      setLastError(error instanceof Error ? error.message : "샘플 사진을 적용하지 못했습니다.");
    } finally {
      setActiveSampleId(null);
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

  const busy = captureStatus === "capturing";
  const captureDisabled = modelState !== "ready" || !cameraReady || busy;
  const sampleDisabled = modelState !== "ready" || busy;

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-4 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase text-[var(--ink-soft)]">local inference</p>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              표정 캡처 스튜디오
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill
              icon={modelState === "ready" ? CheckCircle2 : LoaderCircle}
              label={modelState === "ready" ? "모델 준비" : "모델 로딩"}
              active={modelState === "ready"}
            />
            <StatusPill icon={ShieldCheck} label="로컬 처리" active />
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[300px_minmax(420px,1fr)_360px]">
          <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">템플릿</h2>
              <span className="font-mono text-xs text-[var(--ink-soft)]">{templates.length}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {templates.map((template) => {
                const selected = template.id === selectedTemplate.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setPrediction(null);
                      setResultUrl(null);
                      setCaptureStatus("idle");
                      setStatusText(modelState === "ready" ? "준비 완료" : "모델 준비 중");
                    }}
                    className={`grid grid-cols-[72px_1fr] gap-3 rounded-lg border p-2 text-left transition ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--surface-muted)]"
                        : "border-[var(--border)] bg-transparent hover:border-[var(--accent)]"
                    }`}
                  >
                    <span className="relative aspect-square overflow-hidden rounded-md bg-[var(--surface-muted)]">
                      <Image
                        src={template.imageSrc}
                        alt=""
                        fill
                        sizes="72px"
                        loading={selected ? "eager" : "lazy"}
                        className="object-cover"
                      />
                    </span>
                    <span className="min-w-0 self-center">
                      <span className="block truncate text-sm font-semibold">{template.title}</span>
                      <span className="mt-1 block text-xs text-[var(--ink-soft)]">
                        {expressionNamesKo[template.targetEmotion]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">샘플 얼굴</h2>
                <span className="font-mono text-xs text-[var(--ink-soft)]">
                  {sampleFaces.length}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {sampleFaces.map((sample) => (
                  <div
                    key={sample.id}
                    className="rounded-lg border border-[var(--border)] bg-transparent p-2"
                  >
                    <button
                      type="button"
                      disabled={sampleDisabled}
                      onClick={() => applySampleFace(sample)}
                      className="grid w-full grid-cols-[58px_1fr] gap-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="relative aspect-square overflow-hidden rounded-md bg-[var(--surface-muted)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sample.imageSrc}
                          alt=""
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="min-w-0 self-center">
                        <span className="block truncate text-sm font-semibold">{sample.name}</span>
                        <span className="mt-1 block text-xs text-[var(--ink-soft)]">
                          {expressionNamesKo[sample.expectedExpression]}
                          {activeSampleId === sample.id ? " 적용 중" : ""}
                        </span>
                      </span>
                    </button>
                    <a
                      href={sample.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate font-mono text-[11px] text-[var(--ink-soft)] underline-offset-2 hover:underline"
                    >
                      Commons · {sample.license}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ScanFace className="size-5 text-[var(--accent)]" aria-hidden />
                <h2 className="text-sm font-semibold">웹캠</h2>
              </div>
              <span className="font-mono text-xs text-[var(--ink-soft)]">{statusText}</span>
            </div>

            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[var(--border)] bg-black">
              <video
                ref={videoRef}
                className={`h-full w-full object-cover ${cameraReady ? "scale-x-[-1]" : ""}`}
                playsInline
                muted
              />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center bg-[var(--surface-muted)] text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Video className="size-10 text-[var(--ink-soft)]" aria-hidden />
                    <span className="text-sm font-medium text-[var(--ink-soft)]">카메라 대기</span>
                  </div>
                </div>
              )}
              {captureStatus === "capturing" && (
                <div className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <LoaderCircle className="size-5 animate-spin" aria-hidden />
                    {statusText}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={cameraReady ? stopCamera : startCamera}
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-4 text-sm font-semibold transition hover:border-[var(--accent)]"
              >
                {cameraReady ? <RefreshCcw className="size-4" /> : <Camera className="size-4" />}
                {cameraReady ? "카메라 중지" : "카메라 시작"}
              </button>
              <button
                type="button"
                onClick={captureAndAnalyze}
                disabled={captureDisabled}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--foreground)] px-4 text-sm font-semibold text-[var(--background)] transition disabled:cursor-not-allowed disabled:opacity-45"
              >
                {captureStatus === "capturing" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ScanFace className="size-4" />
                )}
                촬영 분석
              </button>
            </div>

            {lastError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--danger)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{lastError}</span>
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">결과</h2>
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: selectedTemplate.accent }}
                aria-hidden
              />
            </div>

            <div className="relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]">
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

            <div className="mt-3 grid gap-2">
              <MetricRow label="목표" value={expressionNamesKo[selectedTemplate.targetEmotion]} />
              <MetricRow
                label="예측"
                value={prediction ? expressionNamesKo[prediction.label] : "-"}
              />
              <MetricRow
                label="신뢰도"
                value={prediction ? formatPercent(prediction.confidence) : "-"}
              />
              {prediction && (
                <div
                  className={`rounded-lg border p-3 text-sm font-semibold ${
                    prediction.matched
                      ? "border-[var(--accent)] text-[var(--accent-strong)]"
                      : "border-[var(--warning)] text-[var(--warning)]"
                  }`}
                >
                  {prediction.matched ? "적합" : "재촬영 권장"}
                </div>
              )}
            </div>

            <a
              href={resultUrl ?? "#"}
              download={`${selectedTemplate.id}-face-compose.png`}
              aria-disabled={!resultUrl}
              onClick={(event) => {
                if (!resultUrl) {
                  event.preventDefault();
                }
              }}
              className={`mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold ${
                resultUrl
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-muted)] text-[var(--ink-soft)]"
              }`}
            >
              <Download className="size-4" aria-hidden />
              PNG 저장
            </a>
          </aside>
        </section>
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden />
    </main>
  );
}

function StatusPill({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={`inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
        active ? "border-[var(--accent)] text-[var(--accent-strong)]" : "border-[var(--border)] text-[var(--ink-soft)]"
      }`}
    >
      <Icon className={`size-3.5 ${!active && Icon === LoaderCircle ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] py-2 text-sm last:border-b-0">
      <span className="text-[var(--ink-soft)]">{label}</span>
      <span className="font-semibold">{value}</span>
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
