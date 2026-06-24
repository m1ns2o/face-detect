import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "test-results", "celebrity-expression");
const harnessFile = path.join(outputDir, "harness.js");
const publicDir = path.join(rootDir, "public");

const expressionCases = [
  {
    id: "neutral-buster-keaton",
    name: "Buster Keaton",
    role: "actor",
    expectedExpression: "Neutral",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/5/5a/Buster_Keaton_in_Photoplay%2C_December_1924.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Buster_Keaton_in_Photoplay,_December_1924.jpg",
    license: "Public domain",
  },
  {
    id: "happy-marilyn-monroe",
    name: "Marilyn Monroe",
    role: "actor",
    expectedExpression: "Happiness",
    directUrl: "https://upload.wikimedia.org/wikipedia/commons/1/15/Marilyn_Monroe_1952.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Marilyn_Monroe_1952.jpg",
    license: "Public domain",
  },
  {
    id: "sad-hilda-dokubo",
    name: "Hilda Dokubo",
    role: "actor",
    expectedExpression: "Sadness",
    directUrl: "https://upload.wikimedia.org/wikipedia/commons/0/05/Hilda_Dokubo_crying_1.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Hilda_Dokubo_crying_1.jpg",
    license: "CC BY-SA 3.0 or GFDL",
  },
  {
    id: "anger-william-forrest",
    name: "William Forrest",
    role: "actor",
    expectedExpression: "Anger",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/2/2e/William_Forrest_in_Rage_at_Dawn.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:William_Forrest_in_Rage_at_Dawn.jpg",
    license: "Public domain",
  },
  {
    id: "surprise-audrey-hepburn",
    name: "Audrey Hepburn",
    role: "actor",
    expectedExpression: "Surprise",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/1/12/Harry_Stradling-Audrey_Hepburn_in_My_Fair_Lady_%28cropped%29.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Harry_Stradling-Audrey_Hepburn_in_My_Fair_Lady_(cropped).jpg",
    license: "Public domain",
  },
];

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

await build({
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: [path.join(rootDir, "scripts", "celebrity-expression-harness.ts")],
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
  <head><meta charset="utf-8"><title>Celebrity Expression Report</title></head>
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

    if (pathname.startsWith("/celebrity/")) {
      const id = pathname.replace("/celebrity/", "");
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
    () => typeof window.runCelebrityExpressionReport === "function",
    undefined,
    { timeout: 120_000 },
  );

  const results = await page.evaluate(
    (cases) => window.runCelebrityExpressionReport(cases),
    expressionCases.map((testCase) => ({
      id: testCase.id,
      name: testCase.name,
      role: testCase.role,
      expectedExpression: testCase.expectedExpression,
      imageUrl: `/celebrity/${testCase.id}`,
      sourceUrl: testCase.sourceUrl,
      license: testCase.license,
    })),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    model: "EmotiEffLib enet_b0_8_best_vgaf.onnx",
    detector: "MediaPipe Face Landmarker",
    note: "Images are fetched only by this test script and are not bundled in the web app.",
    consoleErrors,
    pageErrors,
    results,
  };

  await writeFile(
    path.join(outputDir, "celebrity-expression-report.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "celebrity-expression-report.md"),
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
        "user-agent": "face-detect-celebrity-expression-test/0.1 (local test)",
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
    "Celebrity expression test report",
    `Generated: ${payload.generatedAt}`,
    "",
    ...payload.results.map((result) => {
      const topThree = result.ranked
        .slice(0, 3)
        .map((score) => `${score.labelKo} ${score.percent}`)
        .join(", ");
      const matched = result.matched ? "MATCH" : "MISS";
      return `- ${result.expectedExpressionKo} / ${result.name}: ${result.topLabelKo} ${result.confidencePercent} (${matched}) | ${topThree}`;
    }),
    "",
    `Report: ${path.join(
      "test-results",
      "celebrity-expression",
      "celebrity-expression-report.md",
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
      return `| ${result.expectedExpressionKo} | ${result.name} | ${result.topLabelKo} | ${result.confidencePercent} | ${result.matched ? "yes" : "no"} | ${topThree} | [source](${result.sourceUrl}) | ${result.license} |`;
    })
    .join("\n");

  return `# Celebrity Expression Test Report

- Generated: ${payload.generatedAt}
- Model: ${payload.model}
- Detector: ${payload.detector}
- Scope: test script only; images are not bundled in the web app.

| Expected | Celebrity | Predicted | Confidence | Match | Top 3 scores | Source | License |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

Console errors: ${payload.consoleErrors.length}
Page errors: ${payload.pageErrors.length}
`;
}
