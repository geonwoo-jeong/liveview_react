import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const HYDRATION_DIAGNOSTIC =
  /hydration|hydrating|server rendered|recoverable error|did not match/i;

interface SampleAuditGlobals {
  readonly __liveViewReactE2E: {
    readonly snapshot: () => {
      readonly rootErrors: readonly unknown[];
    };
  };
}

function captureBrowserErrors(page: Page): () => readonly string[] {
  let errors: readonly string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (
      message.type() === "error" ||
      (message.type() === "warning" &&
        HYDRATION_DIAGNOSTIC.test(message.text()))
    ) {
      errors = [...errors, `console: ${message.text()}`];
    }
  });
  page.on("pageerror", (error) => {
    errors = [...errors, `pageerror: ${error.message}`];
  });

  return () => errors;
}

async function expectNoRootErrors(page: Page, stage: string) {
  const rootErrors = await page.evaluate(
    () =>
      (window as unknown as SampleAuditGlobals).__liveViewReactE2E.snapshot()
        .rootErrors,
  );

  expect(rootErrors, `React root errors after ${stage}`).toEqual([]);
}

test("the comprehensive sample hydrates and exercises its public feature paths", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);

  await page.goto("/sample");
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);

  const root = page.locator("#all-features-demo");
  const formsRoot = page.locator("#sample-forms-uploads-demo");
  await expect(root.getByTestId("sample-connection-state")).toContainText(
    "hydrated / connected / stable",
  );
  await expect(
    formsRoot.getByTestId("sample-forms-uploads-root"),
  ).toBeVisible();
  await expect(root.getByTestId("sample-react19-capabilities")).toBeVisible();
  await expect(root.getByTestId("sample-lazy-registry")).toBeVisible();
  await expect(page.getByTestId("sample-registry-badge")).toContainText(
    "virtual:liveview-react/components",
  );
  await expect(page.getByTestId("sample-portal-content")).toBeVisible();
  await expectNoRootErrors(page, "hydration");

  await root.getByTestId("sample-r-on-increment").click();
  await expect(root.getByTestId("sample-count")).toContainText(
    "authoritative count:5",
  );
  await expect(page.locator("#sample-shell")).toHaveClass(/ring-2/);
  await expectNoRootErrors(page, "r-on event");

  await root.getByTestId("sample-stream-input").fill("Browser stream item");
  await root.getByTestId("sample-stream-append").click();
  await expect(
    root.getByText("Browser stream item", { exact: false }),
  ).toBeVisible();
  await expectNoRootErrors(page, "stream insert");

  const title = formsRoot.getByTestId("sample-form-title");
  await title.fill("x");
  await title.blur();
  await expect(formsRoot.getByTestId("sample-form-title-errors")).toContainText(
    "must be at least 3 characters",
  );
  await expectNoRootErrors(page, "invalid form validation");

  await title.fill("Browser save");
  await expect(page.getByTestId("server-validation-applied")).toContainText(
    "Browser save",
  );
  await formsRoot.getByTestId("sample-form-submit").click();
  await expect(page.getByTestId("server-last-submit")).toContainText(
    "Browser save",
  );
  await expect(formsRoot.getByTestId("sample-form-submit-state")).toContainText(
    '"status":"saved"',
  );
  await expectNoRootErrors(page, "form submit");

  await root.getByRole("button", { name: "useLiveNavigation.patch" }).click();
  await expect(page).toHaveURL(/\/sample\?step=react-patch$/);
  await expect(root).toContainText("step react-patch");
  await expectNoRootErrors(page, "LiveView patch");
  expect(browserErrors()).toEqual([]);
});
