import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const HYDRATION_DIAGNOSTIC =
  /hydration|hydrating|server rendered|recoverable error|did not match/i;

function captureHydrationDiagnostics(page: Page): () => readonly string[] {
  let diagnostics: readonly string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (
      (message.type() === "warning" || message.type() === "error") &&
      HYDRATION_DIAGNOSTIC.test(message.text())
    ) {
      diagnostics = [...diagnostics, message.text()];
    }
  });
  page.on("pageerror", (error) => {
    diagnostics = [...diagnostics, error.message];
  });

  return () => diagnostics;
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("renders the SSR root and React resource hints only", async ({
    page,
  }) => {
    await page.goto("/e2e/ssr");

    const serverRoot = page.locator("#e2e-ssr-root");
    const secondServerRoot = page.locator("#e2e-ssr-root-two");
    const clientRoot = page.locator("#e2e-client-root");

    await expect(serverRoot.getByTestId("ssr-probe")).toBeVisible();
    await expect(serverRoot.getByTestId("ssr-phase")).toHaveText("dead");
    await expect(serverRoot.getByTestId("ssr-provider")).toHaveText("server");
    await expect(serverRoot.getByTestId("ssr-live-event")).toHaveText(
      "pending",
    );
    await expect(secondServerRoot.getByTestId("ssr-probe")).toBeVisible();
    await expect(secondServerRoot.getByTestId("ssr-provider")).toHaveText(
      "server",
    );
    await expect(clientRoot.locator("[data-react-target]")).toBeEmpty();
    await expect(
      serverRoot.locator(
        'link[rel="preload"][href="/assets/app.css"][as="style"]',
      ),
    ).toHaveCount(1);
    await expect(
      serverRoot.locator('link[rel="modulepreload"][href="/assets/app.js"]'),
    ).toHaveCount(1);
  });
});

test("hydrates in place before applying connected props and context", async ({
  page,
}) => {
  const diagnostics = captureHydrationDiagnostics(page);
  const clientEntryGate = Promise.withResolvers<void>();

  await page.route("http://127.0.0.1:4011/js/app.js", async (route) => {
    await clientEntryGate.promise;
    await route.continue();
  });
  await page.goto("/e2e/ssr", { waitUntil: "commit" });

  const serverRoot = page.locator("#e2e-ssr-root");
  const secondServerRoot = page.locator("#e2e-ssr-root-two");
  const clientRoot = page.locator("#e2e-client-root");
  const serverTarget = serverRoot.locator("[data-react-target]");
  const input = serverRoot.getByTestId("ssr-input");
  const secondInput = secondServerRoot.getByTestId("ssr-input");
  const inputBeforeHydration = await input.elementHandle();
  const secondInputBeforeHydration = await secondInput.elementHandle();

  expect(inputBeforeHydration).not.toBeNull();
  expect(secondInputBeforeHydration).not.toBeNull();
  await expect(serverTarget).toHaveAttribute("data-react-hydration", /.+/);
  await expect(serverRoot.getByTestId("ssr-phase")).toHaveText("dead");
  await expect(serverRoot.getByTestId("ssr-provider")).toHaveText("server");
  await expect(serverRoot.getByTestId("ssr-live-event")).toHaveText("pending");

  const inputId = await input.getAttribute("id");
  const secondInputId = await secondInput.getAttribute("id");
  expect(inputId).toBeTruthy();
  expect(secondInputId).toBeTruthy();
  expect(inputId).toContain("liveview-react-e2e-ssr-root-");
  expect(secondInputId).toContain("liveview-react-e2e-ssr-root-two-");
  expect(secondInputId).not.toBe(inputId);
  await expect(serverRoot.getByTestId("ssr-label")).toHaveAttribute(
    "for",
    inputId ?? "",
  );

  clientEntryGate.resolve();
  await page.waitForLoadState("domcontentloaded");
  await expect(serverRoot.getByTestId("ssr-phase")).toHaveText("dead");
  expect(
    await inputBeforeHydration?.evaluate(
      (node) => node === document.querySelector("#e2e-ssr-root input"),
    ),
    "client bootstrap must not replace the SSR input while the join is pending",
  ).toBe(true);
  expect(
    await secondInputBeforeHydration?.evaluate(
      (node) => node === document.querySelector("#e2e-ssr-root-two input"),
    ),
    "client bootstrap must preserve every SSR root while the join is pending",
  ).toBe(true);

  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  const hydrationMounts = await page.evaluate(
    () => window.__liveViewReactE2E.snapshot().hydrationMounts,
  );
  expect(hydrationMounts).toContainEqual({
    rootId: "e2e-ssr-root",
    descriptorPresent: true,
    childElementCount: 3,
    inputId,
  });
  expect(hydrationMounts).toContainEqual({
    rootId: "e2e-ssr-root-two",
    descriptorPresent: true,
    childElementCount: 3,
    inputId: secondInputId,
  });
  await expect(serverRoot.getByTestId("ssr-phase")).toHaveText("connected");
  await expect(serverRoot.getByTestId("ssr-provider")).toHaveText(
    "e2e-ssr-root",
  );
  await expect(secondServerRoot.getByTestId("ssr-provider")).toHaveText(
    "e2e-ssr-root-two",
  );
  await expect(clientRoot.getByTestId("ssr-phase")).toHaveText("connected");
  await expect(clientRoot.getByTestId("ssr-provider")).toHaveText(
    "e2e-client-root",
  );
  await expect(serverRoot.getByTestId("ssr-live-event")).toHaveText("received");
  await expect(secondServerRoot.getByTestId("ssr-live-event")).toHaveText(
    "received",
  );
  await expect(clientRoot.getByTestId("ssr-live-event")).toHaveText("received");
  await expect(input).toHaveValue("preserved");
  expect(
    await inputBeforeHydration?.evaluate(
      (node) => node === document.querySelector("#e2e-ssr-root input"),
    ),
  ).toBe(true);
  expect(await input.getAttribute("id")).toBe(inputId);
  expect(await secondInput.getAttribute("id")).toBe(secondInputId);
  expect(diagnostics()).toEqual([]);
});
