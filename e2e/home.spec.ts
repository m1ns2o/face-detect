import { expect, test } from "@playwright/test";

test("renders the main studio without test fixtures", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "웹툰" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "현재 컷" })).toBeVisible();
  await expect(page.getByText("이미지 업로드")).toBeVisible();
  await expect(page.getByRole("button", { name: /카메라 시작/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /샘플 웹툰/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "테스트 얼굴" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("shows a camera unsupported state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");
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
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("applies a sample celebrity face from the test route", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/test");

  await page.getByRole("button", { name: /샘플 웹툰/ }).first().click();
  const sampleFaceButton = page.getByRole("button", { name: /Suga/ });

  await expect(sampleFaceButton).toBeEnabled({ timeout: 120_000 });
  await sampleFaceButton.click();

  await expect(page.getByText(/진행\s*1\/7/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
