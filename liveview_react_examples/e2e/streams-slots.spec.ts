import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const HYDRATION_DIAGNOSTIC =
  /hydration|hydrating|server rendered|recoverable error|did not match/i;

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

async function streamIds(page: Page, name: string): Promise<readonly string[]> {
  return page
    .getByTestId(`stream-${name}`)
    .locator("[data-stream-dom-id]")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-stream-dom-id") ?? ""),
    );
}

async function expectOperation(page: Page, operation: string): Promise<void> {
  await expect(page.getByTestId("server-last-operation")).toHaveText(operation);
  await expect(page.getByTestId("react-last-operation")).toHaveText(operation);
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/e2e/streams-slots");
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("streams-slots-probe")).toBeVisible();
  await expect(page.getByTestId("react-last-operation")).toHaveText("initial");
}

async function expectSameNode(
  page: Page,
  selector: string,
  node: Awaited<ReturnType<ReturnType<Page["locator"]>["elementHandle"]>>,
): Promise<void> {
  expect(node).not.toBeNull();
  expect(
    await node?.evaluate(
      (candidate, expectedSelector) =>
        candidate === document.querySelector(expectedSelector),
      selector,
    ),
  ).toBe(true);
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("SSR includes escaped inert default and named slots", async ({
    page,
  }) => {
    await page.goto("/e2e/streams-slots");

    const root = page.locator("#e2e-streams-slots-root");
    await expect(root.getByTestId("streams-slots-probe")).toBeVisible();
    await expect(root.getByTestId("default-slot-region")).toHaveAttribute(
      "data-slot-state",
      "present",
    );
    await expect(root.getByTestId("named-slot-region")).toHaveAttribute(
      "data-slot-state",
      "present",
    );
    await expect(root.getByTestId("default-slot-content")).toContainText(
      '<img src=x onerror="window.__liveViewReactSlotXss=true"> & "unsafe"',
    );
    await expect(root.getByTestId("named-slot-content")).toHaveText(
      "Named slot revision 0",
    );
    await expect(
      root.locator('[data-liveview-react-slot="default"] img'),
    ).toHaveCount(0);
    await expect(root.locator("[data-react-hydration]")).toHaveCount(1);
  });
});

test("inserts, updates, ignores a missing update-only item, and deletes immutably", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-alpha",
      "custom-primary-bravo",
      "custom-primary-charlie",
    ]);

  const stableSelector = "#custom-primary-bravo";
  const stableNode = await page.locator(stableSelector).elementHandle();
  const updatedNode = await page
    .locator("#custom-primary-alpha")
    .elementHandle();

  await page.getByTestId("insert-start").click();
  await expectOperation(page, "insert_start");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-start",
      "custom-primary-alpha",
      "custom-primary-bravo",
      "custom-primary-charlie",
    ]);
  await expectSameNode(page, stableSelector, stableNode);

  await page.getByTestId("insert-append").click();
  await expectOperation(page, "insert_append");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-start",
      "custom-primary-alpha",
      "custom-primary-bravo",
      "custom-primary-charlie",
      "custom-primary-append",
    ]);
  await expectSameNode(page, stableSelector, stableNode);

  await page.getByTestId("insert-arbitrary").click();
  await expectOperation(page, "insert_arbitrary");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-start",
      "custom-primary-alpha",
      "custom-primary-arbitrary",
      "custom-primary-bravo",
      "custom-primary-charlie",
      "custom-primary-append",
    ]);
  await expectSameNode(page, stableSelector, stableNode);

  await page.getByTestId("update-existing").click();
  await expectOperation(page, "update_existing");
  await expect(page.locator("#custom-primary-alpha")).toHaveText(
    "Alpha updated",
  );
  await expectSameNode(page, "#custom-primary-alpha", updatedNode);
  await expectSameNode(page, stableSelector, stableNode);

  const beforeMissingUpdate = await streamIds(page, "primary");
  await page.getByTestId("update-only-missing").click();
  await expectOperation(page, "update_only_missing");
  expect(await streamIds(page, "primary")).toEqual(beforeMissingUpdate);
  await expect(page.locator("#custom-primary-missing")).toHaveCount(0);
  await expectSameNode(page, stableSelector, stableNode);

  await page.getByTestId("delete-existing").click();
  await expectOperation(page, "delete_existing");
  await expect(page.locator("#custom-primary-alpha")).toHaveCount(0);
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-start",
      "custom-primary-arbitrary",
      "custom-primary-bravo",
      "custom-primary-charlie",
      "custom-primary-append",
    ]);
  await expectSameNode(page, stableSelector, stableNode);
  expect(browserErrors()).toEqual([]);
});

test("resets one stream without disturbing sibling streams", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  const positiveBefore = await streamIds(page, "positive");
  const negativeBefore = await streamIds(page, "negative");
  const positiveNode = await page.locator("#positive-two").elementHandle();

  await page.getByTestId("reset-primary").click();
  await expectOperation(page, "reset_primary");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual(["custom-primary-reset-one", "custom-primary-reset-two"]);
  expect(await streamIds(page, "positive")).toEqual(positiveBefore);
  expect(await streamIds(page, "negative")).toEqual(negativeBefore);
  await expectSameNode(page, "#positive-two", positiveNode);
  expect(browserErrors()).toEqual([]);
});

test("applies positive and negative limits to independent streams", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await page.getByTestId("positive-limit").click();
  await expectOperation(page, "positive_limit");
  await expect
    .poll(() => streamIds(page, "positive"))
    .toEqual(["positive-zero", "positive-one", "positive-two"]);

  await page.getByTestId("negative-limit").click();
  await expectOperation(page, "negative_limit");
  await expect
    .poll(() => streamIds(page, "negative"))
    .toEqual(["negative-two", "negative-three", "negative-four"]);
  expect(browserErrors()).toEqual([]);
});

test("hydrates slot HTML, updates it from the server, and removes both slot kinds", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  const root = page.locator("#e2e-streams-slots-root");
  await expect(root.locator("[data-react-hydration]")).toHaveCount(0);
  await expect(root.getByTestId("default-slot-content")).toContainText(
    '<img src=x onerror="window.__liveViewReactSlotXss=true"> & "unsafe"',
  );
  await expect(
    root.locator('[data-liveview-react-slot="default"] img'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__liveViewReactSlotXss),
  ).toBeUndefined();

  await page.getByTestId("update-slots").click();
  await expectOperation(page, "update_slots");
  await expect(root.getByTestId("default-slot-content")).toContainText(
    "Default slot revision 1",
  );
  await expect(root.getByTestId("named-slot-content")).toHaveText(
    "Named slot revision 1",
  );

  await page.getByTestId("remove-named-slot").click();
  await expectOperation(page, "remove_named_slot");
  await expect(root.getByTestId("named-slot-region")).toHaveAttribute(
    "data-slot-state",
    "absent",
  );
  await expect(root.getByTestId("named-slot-region")).toHaveText("named:none");
  await expect(root.getByTestId("named-slot-content")).toHaveCount(0);

  await page.getByTestId("remove-default-slot").click();
  await expectOperation(page, "remove_default_slot");
  await expect(root.getByTestId("default-slot-region")).toHaveAttribute(
    "data-slot-state",
    "absent",
  );
  await expect(root.getByTestId("default-slot-region")).toHaveText(
    "default:none",
  );
  await expect(root.getByTestId("default-slot-content")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__liveViewReactSlotXss),
  ).toBeUndefined();
  expect(browserErrors()).toEqual([]);
});

declare global {
  interface Window {
    readonly __liveViewReactSlotXss?: boolean;
  }
}
