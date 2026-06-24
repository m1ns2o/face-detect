import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "test-results", "idol-expression");
const harnessFile = path.join(outputDir, "harness.js");
const publicDir = path.join(rootDir, "public");

const idolCases = [
  {
    id: "jisoo-2023",
    name: "Kim Jisoo",
    group: "BLACKPINK",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/6/66/Kim_Jisoo_in_July_2023_05_%28cropped%29.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Kim_Jisoo_in_July_2023_05_(cropped).jpg",
    license: "CC BY 4.0",
  },
  {
    id: "wonyoung-produce48",
    name: "Jang Wonyoung",
    group: "IVE",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/2/21/Jang_Wonyoung_at_Produce48_9.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Jang_Wonyoung_at_Produce48_9.png",
    license: "CC BY-SA 3.0",
  },
  {
    id: "jungkook-2013",
    name: "Jeon Jung-kook",
    group: "BTS",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/5/5e/Jeon_Jung-kook_at_an_fansign_on_July_28%2C_2013.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Jeon_Jung-kook_at_an_fansign_on_July_28,_2013.jpg",
    license: "CC BY 4.0",
  },
  {
    id: "hanni-2023",
    name: "Hanni",
    group: "NewJeans",
    directUrl:
      "https://upload.wikimedia.org/wikipedia/commons/0/03/2023_MMA_NewJeans_Hanni.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:2023_MMA_NewJeans_Hanni.jpg",
    license: "CC BY-SA 4.0",
  },
];

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

await build({
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: [path.join(rootDir, "scripts", "idol-expression-harness.ts")],
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
  <head><meta charset="utf-8"><title>Idol Expression Report</title></head>
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
      const idolCase = idolCases.find((candidate) => candidate.id === id);

      if (!idolCase) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const image = await fetchCommonsImage(idolCase);
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
    () => typeof window.runIdolExpressionReport === "function",
    undefined,
    { timeout: 120_000 },
  );

  const results = await page.evaluate(
    (cases) => window.runIdolExpressionReport(cases),
    idolCases.map((idolCase) => ({
      id: idolCase.id,
      name: idolCase.name,
      group: idolCase.group,
      imageUrl: `/idol/${idolCase.id}`,
      sourceUrl: idolCase.sourceUrl,
      license: idolCase.license,
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
    path.join(outputDir, "idol-expression-report.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(outputDir, "idol-expression-report.md"), toMarkdown(payload), "utf8");

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

async function fetchCommonsImage(idolCase) {
  const cached = imageCache.get(idolCase.id);
  if (cached) {
    return cached;
  }

  const response = await fetchWithRetry(idolCase.directUrl);

  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const image = { body, contentType };
  imageCache.set(idolCase.id, image);
  return image;
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "face-detect-idol-expression-test/0.1 (local test)",
      },
    });

    if (response.ok) {
      return response;
    }

    lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
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
    "Korean idol expression report",
    `Generated: ${payload.generatedAt}`,
    "",
    ...payload.results.map((result) => {
      const topThree = result.ranked
        .slice(0, 3)
        .map((score) => `${score.labelKo} ${score.percent}`)
        .join(", ");
      return `- ${result.name} (${result.group}): ${result.topLabelKo} ${result.confidencePercent} | ${topThree}`;
    }),
    "",
    `Report: ${path.join("test-results", "idol-expression", "idol-expression-report.md")}`,
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
      return `| ${result.name} | ${result.group} | ${result.topLabelKo} | ${result.confidencePercent} | ${topThree} | [source](${result.sourceUrl}) | ${result.license} |`;
    })
    .join("\n");

  return `# Korean Idol Expression Report

- Generated: ${payload.generatedAt}
- Model: ${payload.model}
- Detector: ${payload.detector}
- Scope: test script only; images are not bundled in the web app.

| Name | Group | Top expression | Confidence | Top 3 scores | Source | License |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

Console errors: ${payload.consoleErrors.length}
Page errors: ${payload.pageErrors.length}
`;
}
