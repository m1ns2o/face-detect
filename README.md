# Face Detect

웹캠으로 얼굴을 촬영해 표정을 추론하고, 템플릿 슬롯에 얼굴을 합성해 PNG로 저장하는 브라우저 전용 애플리케이션입니다.

## 목표

- 사용자 얼굴은 브라우저 메모리에서만 처리하고 서버로 업로드하지 않습니다.
- 얼굴 탐지 + 표정 추론 + 합성의 전 과정을 클라이언트에서 수행합니다.
- 미리 준비한 템플릿(학습용 빈 슬롯)에 적절한 표정이 들어왔는지 즉시 확인합니다.
- 테스트 이미지나 테스트 템플릿은 앱 번들에 넣지 않고, 오직 테스트 스크립트에서만 사용합니다.

## 실행 화면 핵심 흐름

1. 앱 진입 시 모델 로딩 (`MediaPipe Face Landmarker`, `EmotiEffLib ONNX`)
2. 카메라 시작
3. 템플릿 선택 (목표 표정 지정)
4. 촬영 시작
5. 매 프레임 얼굴 탐지 후 얼굴만 크롭
6. 5개 프레임(기본) 결과를 평균 내어 최종 표정 점수 산출
7. 슬롯 영역에 얼굴을 타원 마스크로 합성
8. 최종 결과물 미리보기 및 PNG 다운로드

## 기술 스택

- `Next.js 16` + `TypeScript`
- `@mediapipe/tasks-vision`
- `onnxruntime-web`
- `shadcn/ui`
- `lucide-react`
- `Tailwind CSS`
- `vitest` + `@playwright/test`

## 프로젝트 구조

- `src/app`
  - 앱 라우팅(메인 페이지)와 레이아웃
- `src/components/expression-studio.tsx`
  - 카메라 제어, 캡처, 추론, 합성, 결과 다운로드가 한 곳에 구현된 핵심 컴포넌트
- `src/lib/browser-models.ts`
  - `createFaceLandmarker()` / `createEmotionRuntime()` / 입력 전처리 및 ONNX 세션 실행
- `src/lib/emotions.ts`
  - 감정 라벨 타입, softmax, 스코어 집계, 매칭 규칙, 표시명 맵핑
- `src/lib/canvas.ts`
  - 얼굴 정규화 크롭, 슬롯 좌표 변환, 커버/클램프 유틸리티
- `src/lib/templates.ts`
  - 템플릿 메타데이터 (`id`, `title`, `targetEmotion`, `faceSlot`)
- `src/components/ui/*`
  - `shadcn` 기반 UI 컴포넌트
- `public/models`
  - `emotieff/enet_b0_8_best_vgaf.onnx`
  - `mediapipe/face_landmarker.task`
- `public/wasm`
  - `ort/`, `mediapipe/` 런타임 파일
- `scripts/korean-idol-expression-report.mjs`
  - 한국인 아이돌 표정 테스트를 실행해 레포트 생성
- `scripts/korean-idol-expression-harness.ts`
  - 테스트 페이지에서 `expression-studio`와 동일한 판별 경로를 브라우저 기준으로 재현
- `test-results/korean-idol-expression/`
  - 테스트 실행 산출물 (`.md`, `.json`, `harness.js`)

## 추론 파이프라인 상세

- 얼굴 검출
  - `MediaPipe Face Landmarker`로 얼굴 랜드마크 탐지
  - 랜드마크 바운딩 박스를 정사각형으로 확장한 뒤 얼굴 영역을 `cropCanvasFromRect`로 크롭
- 표정 추론
  - 크롭된 얼굴을 224x224로 리사이징
  - `ImageNet mean/std` 정규화 적용
  - `onnxruntime-web`에서 `enet_b0_8_best_vgaf.onnx` 추론
  - 출력 로짓에 softmax 적용해 감정 확률 벡터 생성
  - 5개 프레임 평균치 기반으로 최종 판별
- 매칭 규칙
  - `TARGET_EXPRESSIONS`: `Neutral`, `Happiness`, `Sadness`, `Anger`, `Surprise`
  - 기본 임계값: `0.45`
  - `matched = topLabel === targetEmotion && confidence >= 0.45`
- 합성
  - 템플릿 이미지에 얼굴 슬롯(정규화 좌표)을 픽셀 단위로 변환
  - 슬롯 크기 비율에 맞게 얼굴을 cover 방식으로 맞춘 뒤, 타원 마스크로 컷팅
  - 캔버스 출력물을 PNG Data URL로 생성

## 프라이버시 정책

- 업로드 없음: 사용자의 웹캠 프레임/이미지는 서버로 전송되지 않습니다.
- 처리 위치: 브라우저 메모리(클라이언트)에서만 동작
- 저장: 사용자가 다운로드 버튼을 누른 경우에만 합성 결과 PNG가 저장됩니다.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속 후 카메라 권한을 허용하세요.

## 주요 명령어

- `npm run dev` : 개발 서버 실행
- `npm run build` : 프로덕션 빌드
- `npm run lint` : 린트
- `npm run start` : 빌드 결과 실행
- `npm run test` : 단위 테스트(vitest)
- `npm run test:e2e` : Playwright e2e
- `npm run test:korean-idols` : 한국인 아이돌 표정 테스트(리포트 생성)
- `npm run test:expressions` : 위 명령의 alias

### 테스트 결과 산출물

- `npm run test:korean-idols` 실행 시 아래 경로가 생성됩니다.
  - `test-results/korean-idol-expression/korean-idol-expression-report.md`
  - `test-results/korean-idol-expression/korean-idol-expression-report.json`
  - `test-results/korean-idol-expression/harness.js`

## 주의사항

- 라벨은 모델 내부 라벨과 UI 표시 라벨이 구분됩니다. (`Neutral` → UI 문자열: `무표정` 등)
- 카메라 미노출/조명 부족/얼굴 일부 가림은 탐지 실패로 이어질 수 있습니다.
- 한 프레임 실패보다 여러 프레임 평균 방식으로 안정성을 확보했지만, 조명과 각도에 따라 오차가 남을 수 있습니다.

## 배포 가이드 (Vercel)

`git` 정리 후 Vercel에 새 프로젝트로 연결하여 배포합니다.

권장 순서:
1. Vercel에서 신규 프로젝트 생성
2. Next.js 프레임워크 자동 감지 확인
3. 환경변수는 특별히 필요 없음(정적 모델/번들 사용)
4. 배포 완료 후 `/` 접근, 카메라 권한 팝업, 모델 로딩, 기본 화면 렌더링을 확인

## 라이선스

- 모델/텍스트/이미지 라이선스는 각 저장소/출처의 규정을 따릅니다.
- 앱 코드 자체는 프로젝트 현재 저장소 정책을 따릅니다.
