import { expect, test } from "@playwright/test";

test("renders the main studio without test fixtures", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "웹툰 이미지 업로드" })).toBeVisible();
  await expect(page.getByTestId("comic-dropzone")).toBeVisible();
  await expect(page.getByText("파일 선택")).toBeVisible();
  await expect(page.getByRole("button", { name: /샘플 웹툰/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "웹캠" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "테스트 얼굴" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveCount(0);
});

test("loads a comic image by drag and drop", async ({ page }) => {
  await page.goto("/");

  const dataTransfer = await page.evaluateHandle(async () => {
    const response = await fetch("/sample-comics/classroom-webtoon.png");
    const blob = await response.blob();
    const file = new File([blob], "classroom-webtoon.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    return transfer;
  });

  await page.getByTestId("comic-dropzone").dispatchEvent("drop", { dataTransfer });

  await expect(page.getByText("7컷 감지")).toBeVisible();
  await expect(page.getByRole("button", { name: /1컷/ })).toBeVisible();
});

test("shows a camera unsupported state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/test");
  await page.getByRole("button", { name: /샘플 웹툰/ }).first().click();
  await expect(page.getByRole("button", { name: /카메라 시작/ })).toBeVisible();
  await page.getByRole("button", { name: /카메라 시작/ }).click();

  await expect(page.getByText("이 브라우저는 웹캠 접근을 지원하지 않습니다.")).toBeVisible();
});

test("detects masked comic cuts from the test route sample", async ({ page }) => {
  await page.goto("/test");

  await page.getByRole("button", { name: /샘플 웹툰/ }).first().click();

  await expect(page.getByText("7컷 감지")).toBeVisible();
  await expect(page.getByRole("button", { name: /1컷/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /7컷/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Suga/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Kim Jisoo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveCount(0);
});

test("applies a sample celebrity face from the test route", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/test");

  await page.getByRole("button", { name: /샘플 웹툰/ }).first().click();
  const sampleFaceButton = page.getByRole("button", { name: /Suga/ });

  await expect(sampleFaceButton).toBeEnabled({ timeout: 120_000 });
  await sampleFaceButton.click();

  await expect(page.getByText("2컷에 바로 적용")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveCount(0);
});
