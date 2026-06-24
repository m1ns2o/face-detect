import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "test-results", "korean-idol-expression");
const harnessFile = path.join(outputDir, "harness.js");
const publicDir = path.join(rootDir, "public");

const expressionCases = [
  {
    id: "neutral-suga-bts",
    name: "Suga",
    role: "BTS",
    expectedExpression: "Neutral",
    visualCue: "Fanmeeting portrait with a relaxed mouth and focused gaze.",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/3/3b/Suga_at_a_fanmeeting%2C_22_September_2013.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Suga_at_a_fanmeeting,_22_September_2013.jpg",
    license: "CC BY 4.0",
  },
  {
    id: "happy-kim-jisoo-blackpink",
    name: "Kim Jisoo",
    role: "BLACKPINK",
    expectedExpression: "Happiness",
    visualCue: "Bright airport portrait with a visible smile.",
    directUrl: "https://upload.wikimedia.org/wikipedia/commons/6/66/Kim_Jisoo_in_July_2023_05_%28cropped%29.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Kim_Jisoo_in_July_2023_05_(cropped).jpg",
    license: "CC BY 4.0",
  },
  {
    id: "sad-jennie-blackpink",
    name: "Jennie Kim",
    role: "BLACKPINK",
    expectedExpression: "Sadness",
    visualCue: "STAY stage still with a downcast, solemn look.",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/6/63/171028_%ED%8F%89%EC%B0%BD_%EB%AE%A4%EC%A7%81%ED%8E%98%EC%8A%A4%ED%83%80_-_%EC%A0%9C%EB%8B%88%28%EB%B8%94%EB%9E%99%ED%95%91%ED%81%AC%29_%27STAY%27_4K_60P_%EC%A7%81%EC%BA%A0_by_DaftTaengk_%281%29.png",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File%3A171028_%ED%8F%89%EC%B0%BD_%EB%AE%A4%EC%A7%81%ED%8E%98%EC%8A%A4%ED%83%80_-_%EC%A0%9C%EB%8B%88%28%EB%B8%94%EB%9E%99%ED%95%91%ED%81%AC%29_%27STAY%27_4K_60P_%EC%A7%81%EC%BA%A0_by_DaftTaengk_%281%29.png",
    license: "CC BY 3.0",
  },
  {
    id: "anger-byun-baekhyun-exo",
    name: "Byun Baekhyun",
    role: "EXO",
    expectedExpression: "Anger",
    visualCue: "Performance portrait selected for a firm, intense expression.",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/c/cd/Byun_Baek-hyun_at_Korea_Music_Festival_on_October%2C_1_2017_%281%29.png",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Byun_Baek-hyun_at_Korea_Music_Festival_on_October,_1_2017_(1).png",
    license: "CC BY 3.0",
  },
  {
    id: "surprise-jang-wonyoung-ive",
    name: "Jang Wonyoung",
    role: "IVE",
    expectedExpression: "Surprise",
    visualCue: "Wide-eyed Produce48 still selected as the surprise target.",
    directUrl: "https://upload.wikimedia.org/wikipedia/commons/2/21/Jang_Wonyoung_at_Produce48_9.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Jang_Wonyoung_at_Produce48_9.png",
    license: "CC BY-SA 3.0",
  },
];

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

await build({
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: [path.join(rootDir, "scripts", "korean-idol-expression-harness.ts")],
  format: "esm",
  outfile: harnessFile,
  platform: "browser",
  sourcemap: false,
  target: ["chrome120"],
  tsconfig: path.join(rootDir, "tsconfig.json"),
});

const imageCache = new Map();
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8"><title>Korean Idol Expression Report</title></head>
  <body><script type="module" src="/harness.js"></script></body>
</html>`);
      return;
    }

    if (pathname === "/harness.js") {
      await sendFile(response, harnessFile, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname.startsWith("/models/") || pathname.startsWith("/wasm/")) {
      await sendPublicAsset(response, pathname);
      return;
    }

    if (pathname.startsWith("/idol/")) {
      const id = pathname.replace("/idol/", "");
      const testCase = expressionCases.find((candidate) => candidate.id === id);

      if (!testCase) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const image = await fetchTestImage(testCase);
      response.writeHead(200, {
        "content-type": image.contentType,
        "cache-control": "no-store",
      });
      response.end(image.body);
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.stack : String(error));
  }
});

const port = await listen(server);
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => {
  pageErrors.push(error.stack ?? error.message);
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => typeof window.runKoreanIdolExpressionReport === "function",
    undefined,
    { timeout: 120_000 },
  );

  const results = await page.evaluate(
    (cases) => window.runKoreanIdolExpressionReport(cases),
    expressionCases.map((testCase) => ({
      id: testCase.id,
      name: testCase.name,
      role: testCase.role,
      expectedExpression: testCase.expectedExpression,
      visualCue: testCase.visualCue,
      imageUrl: `/idol/${testCase.id}`,
      sourceUrl: testCase.sourceUrl,
      license: testCase.license,
    })),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    model: "EmotiEffLib enet_b0_8_best_vgaf.onnx",
    detector: "MediaPipe Face Landmarker",
    matchRule: "Top label must equal the expected expression and confidence must be at least 45%.",
    note: "Images are fetched only by this test script and are not bundled in the web app.",
    consoleErrors,
    pageErrors,
    results,
  };

  await writeFile(
    path.join(outputDir, "korean-idol-expression-report.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "korean-idol-expression-report.md"),
    toMarkdown(payload),
    "utf8",
  );

  console.log(toConsoleSummary(payload));
} finally {
  await browser.close();
  server.close();
}

async function sendPublicAsset(response, pathname) {
  const relativePath = pathname.replace(/^\/+/, "");
  const assetPath = path.resolve(publicDir, relativePath);

  if (!assetPath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  await sendFile(response, assetPath, mimeFor(assetPath));
}

async function sendFile(response, filePath, contentType) {
  const body = await readFile(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

async function fetchTestImage(testCase) {
  const cached = imageCache.get(testCase.id);
  if (cached) {
    return cached;
  }

  const response = await fetchWithRetry(testCase.directUrl);
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const image = { body, contentType };
  imageCache.set(testCase.id, image);
  return image;
}

async function fetchWithRetry(url, attempts = 6) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: "https://commons.wikimedia.org/",
        "user-agent": "face-detect-korean-idol-expression-test/0.1 (local test)",
      },
    });

    if (response.ok) {
      return response;
    }

    lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function listen(serverInstance) {
  return new Promise((resolve) => {
    serverInstance.listen(0, "127.0.0.1", () => {
      const address = serverInstance.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not resolve local server address");
      }
      resolve(address.port);
    });
  });
}

function mimeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".js" || extension === ".mjs") return "application/javascript";
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".onnx") return "application/octet-stream";
  if (extension === ".task") return "application/octet-stream";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function toConsoleSummary(payload) {
  const lines = [
    "Korean idol expression test report",
    `Generated: ${payload.generatedAt}`,
    "",
    ...payload.results.map((result) => {
      const topThree = result.ranked
        .slice(0, 3)
        .map((score) => `${score.labelKo} ${score.percent}`)
        .join(", ");
      const matched = result.matched
        ? "MATCH"
        : result.topLabelMatched
          ? "TOP MATCH, LOW CONF"
          : "MISS";
      return `- ${result.expectedExpressionKo} / ${result.name}: ${result.topLabelKo} ${result.confidencePercent} (${matched}) | ${topThree}`;
    }),
    "",
    `Report: ${path.join(
      "test-results",
      "korean-idol-expression",
      "korean-idol-expression-report.md",
    )}`,
  ];

  if (payload.consoleErrors.length > 0) {
    lines.push(`Console errors: ${payload.consoleErrors.length}`);
  }
  if (payload.pageErrors.length > 0) {
    lines.push(`Page errors: ${payload.pageErrors.length}`);
  }

  return lines.join("\n");
}

function toMarkdown(payload) {
  const rows = payload.results
    .map((result) => {
      const topThree = result.ranked
        .slice(0, 3)
        .map((score) => `${score.labelKo} ${score.percent}`)
        .join("<br>");
      return `| ${result.expectedExpressionKo} | ${result.name} | ${result.role} | ${result.topLabelKo} | ${result.confidencePercent} | ${result.topLabelMatched ? "yes" : "no"} | ${result.matched ? "yes" : "no"} | ${result.visualCue} | ${topThree} | [source](${result.sourceUrl}) | ${result.license} |`;
    })
    .join("\n");

  return `# Korean Idol Expression Test Report

- Generated: ${payload.generatedAt}
- Model: ${payload.model}
- Detector: ${payload.detector}
- Match rule: ${payload.matchRule}
- Scope: test script only; images are not bundled in the web app.

| Expected | Idol | Group | Predicted | Confidence | Top match | App match | Visual cue | Top 3 scores | Source | License |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

Console errors: ${payload.consoleErrors.length}
Page errors: ${payload.pageErrors.length}
`;
}
