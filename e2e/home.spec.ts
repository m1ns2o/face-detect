import { expect, test } from "@playwright/test";

test("renders the studio shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "표정 캡처 스튜디오" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "템플릿" })).toBeVisible();
  await expect(page.getByRole("button", { name: /카메라 시작/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /PNG 저장/ })).toHaveAttribute("aria-disabled", "true");
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
