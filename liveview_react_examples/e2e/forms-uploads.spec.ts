import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

interface TestFilePayload {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly name: string;
}

declare global {
  interface Window {
    readonly liveSocket: {
      readonly connect: () => void;
      readonly disconnect: (callback?: () => void) => void;
    };
  }
}

function textFile(name: string, contents: string): TestFilePayload {
  return {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(contents),
  };
}

function captureBrowserErrors(page: Page): () => readonly string[] {
  let errors: readonly string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors = [...errors, `console: ${message.text()}`];
    }
  });
  page.on("pageerror", (error) => {
    errors = [...errors, `pageerror: ${error.message}`];
  });

  return () => errors;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/e2e/forms-uploads");
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("forms-uploads-probe")).toBeVisible();
  await expect(page.getByTestId("connection-state")).toHaveText(
    "connected:stable",
  );
  await expect(page.getByTestId("manual-config")).toHaveText("manual:2:.txt");
  await expect(page.getByTestId("auto-config")).toHaveText("auto:1:.txt");
}

async function chooseFile(
  page: Page,
  buttonTestId: string,
  file: TestFilePayload,
): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId(buttonTestId).click(),
  ]);
  await chooser.setFiles(file);
}

async function dropTextFile(
  page: Page,
  targetTestId: string,
  name: string,
  contents: string,
): Promise<void> {
  await page.getByTestId(targetTestId).evaluate(
    (target, file) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([file.contents], file.name, {
          lastModified: 1,
          type: "text/plain",
        }),
      );
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    },
    { contents, name },
  );
}

test("keeps typing local, ignores stale validation, and resolves submit metadata", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  const title = page.getByTestId("form-title");
  await title.fill("slow");
  await expect(page.getByTestId("form-title-value")).toHaveText("slow");
  await expect(page.getByTestId("form-dirty")).toHaveText("true");
  await expect(page.getByTestId("server-validation-received")).toHaveText(
    "1:slow",
  );

  await title.fill("fresh");
  await expect(page.getByTestId("form-title-value")).toHaveText("fresh");
  await expect(page.getByTestId("server-validation-received")).toHaveText(
    "2:fresh",
  );
  await expect(page.getByTestId("server-validation-applied")).toHaveText(
    "2:fresh",
  );
  await expect(page.getByTestId("form-valid")).toHaveText("true");

  await expect(page.getByTestId("server-validation-applied")).toHaveText(
    "1:slow",
  );
  await expect(page.getByTestId("form-title-value")).toHaveText("fresh");
  await expect(page.getByTestId("form-valid")).toHaveText("true");
  await expect(page.getByTestId("form-title-errors")).toHaveText("none");

  await title.fill("x");
  await expect(page.getByTestId("server-validation-applied")).toHaveText("3:x");
  await title.blur();
  await expect(page.getByTestId("form-title-errors")).toHaveText(
    "must be at least 3 characters",
  );

  await title.fill("saved");
  await expect(page.getByTestId("server-validation-applied")).toHaveText(
    "4:saved",
  );
  await page.getByTestId("submit-form").click();

  await expect(page.getByTestId("server-last-submit")).toHaveText("4:saved");
  await expect(page.getByTestId("form-submit-result")).toContainText(
    '"status":"saved"',
  );
  await expect(page.getByTestId("form-submit-result")).toContainText(
    '"title":"saved"',
  );
  await expect(page.getByTestId("form-submit-reply")).toContainText(
    '"revision":4',
  );
  await expect(page.getByTestId("form-submitting")).toHaveText("false");
  expect(browserErrors()).toEqual([]);
});

test("selects and drops multiple manual files, reports errors, and cancels entries", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await chooseFile(
    page,
    "open-manual-dialog",
    textFile("picker.txt", "picker"),
  );
  await expect(page.getByTestId("manual-entry")).toHaveCount(1);
  await expect(page.getByTestId("manual-entry").first()).toContainText(
    "picker.txt",
  );

  await dropTextFile(page, "manual-dropzone", "dropped.txt", "dropped");
  await expect(page.getByTestId("manual-entry")).toHaveCount(2);
  await expect(page.getByTestId("manual-entries")).toContainText("dropped.txt");

  const pickerEntry = page
    .getByTestId("manual-entry")
    .filter({ hasText: "picker.txt" });
  await pickerEntry.getByRole("button", { name: "cancel picker.txt" }).click();
  await expect(pickerEntry).toHaveCount(0);
  await expect(page.getByTestId("cancel-reply")).toContainText('"cancelled"');

  await page.getByTestId("cancel-all-manual").click();
  await expect(page.getByTestId("manual-entry")).toHaveCount(0);

  await page
    .getByTestId("manual-native-input")
    .setInputFiles(textFile("too-large.txt", "x".repeat(100)));
  await expect(page.getByTestId("manual-errors")).toContainText("too_large");

  const invalidEntry = page
    .getByTestId("manual-entry")
    .filter({ hasText: "too-large.txt" });
  await invalidEntry
    .getByRole("button", { name: "cancel too-large.txt" })
    .click();
  await expect(page.getByTestId("manual-errors")).toHaveText("[]");
  expect(browserErrors()).toEqual([]);
});

test("uploads and consumes multiple manual files on the real form submit", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await page.getByTestId("form-title").fill("uploads");
  await expect(page.getByTestId("server-validation-applied")).toHaveText(
    "1:uploads",
  );
  await page
    .getByTestId("manual-native-input")
    .setInputFiles([
      textFile("alpha.txt", "alpha"),
      textFile("bravo.txt", "bravo"),
    ]);
  await expect(page.getByTestId("manual-entry")).toHaveCount(2);

  await page.getByTestId("submit-form").click();
  await expect(page.getByTestId("server-uploaded-files")).toContainText(
    "manual:alpha.txt",
  );
  await expect(page.getByTestId("server-uploaded-files")).toContainText(
    "manual:bravo.txt",
  );
  await expect(page.getByTestId("manual-entry")).toHaveCount(0);
  await expect(page.getByTestId("form-submit-result")).toContainText(
    '"manual_files":["alpha.txt","bravo.txt"]',
  );
  expect(browserErrors()).toEqual([]);
});

test("auto uploads through Phoenix and exposes real progress before consumption", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await chooseFile(
    page,
    "open-auto-dialog",
    textFile("automatic.txt", "automatic"),
  );

  await expect(page.getByTestId("server-auto-progress")).toContainText(
    "automatic.txt:100",
  );
  await expect(page.getByTestId("react-auto-progress")).toContainText(
    "automatic.txt:100",
  );
  await expect(page.getByTestId("server-uploaded-files")).toContainText(
    "auto:automatic.txt",
  );
  await expect(page.getByTestId("react-uploaded-files")).toContainText(
    "auto:automatic.txt",
  );
  await expect(page.getByTestId("auto-entry")).toHaveCount(0);
  await expect(page.getByTestId("auto-selections")).toHaveText("none");
  expect(browserErrors()).toEqual([]);
});

test("preserves dirty form state and requires explicit upload retry after reconnect", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await page.getByTestId("form-title").fill("offline-edit");
  await expect(page.getByTestId("server-validation-applied")).toHaveText(
    "1:offline-edit",
  );
  await page
    .getByTestId("manual-native-input")
    .setInputFiles(textFile("retry.txt", "retry"));
  await expect(page.getByTestId("manual-entry")).toHaveCount(1);
  const initialManualInputId = await page
    .getByTestId("manual-input-id")
    .innerText();
  await expect(page.getByTestId("manual-selections")).toContainText(
    "retry.txt:selected",
  );

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.liveSocket.disconnect(resolve);
      }),
  );
  await expect(page.getByTestId("connection-state")).toHaveText(
    "disconnected:reconnecting",
  );
  await expect(page.getByTestId("manual-selections")).toContainText(
    "retry.txt:interrupted",
  );

  await page.evaluate(() => window.liveSocket.connect());
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("connection-state")).toHaveText(
    "connected:stable",
  );
  await expect(page.getByTestId("server-mount-generation")).not.toHaveText("0");
  await expect(page.getByTestId("manual-input-id")).not.toHaveText(
    initialManualInputId,
  );
  await expect(page.getByTestId("form-title-value")).toHaveText("offline-edit");
  await expect(page.getByTestId("form-dirty")).toHaveText("true");
  await expect(page.getByTestId("manual-selections")).toContainText(
    "retry.txt:interrupted:pending",
  );
  await expect(page.getByTestId("server-validation-received")).toHaveText(
    "1:offline-edit",
  );
  await expect(page.getByTestId("server-validation-applied")).toHaveText(
    "1:offline-edit",
  );

  const retry = page.getByTestId("retry-manual");
  await retry.focus();
  await expect(page.getByTestId("form-touched")).toHaveText("true");
  await retry.click();
  await expect(page.getByTestId("retry-result")).toHaveText("retried");
  await expect(page.getByTestId("manual-entry")).toHaveCount(1);
  await expect(page.getByTestId("manual-selections")).toContainText(
    "retry.txt:selected",
  );
  await page.getByTestId("cancel-all-manual").click();
  await expect(page.getByTestId("manual-entry")).toHaveCount(0);
  expect(browserErrors()).toEqual([]);
});
