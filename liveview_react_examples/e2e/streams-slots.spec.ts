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

interface ObservedStreamItem {
  readonly id: string;
  readonly label: string;
}

const INITIAL_COMPARISON_ITEMS = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
  { id: "three", label: "Three" },
  { id: "four", label: "Four" },
] as const;

const NATIVE_STREAM_SCENARIOS = [
  {
    title: "updates an existing ordinary item without applying its limit",
    button: "compare-update-limit",
    operation: "compare_update_limit",
    react: "react-update-limit",
    reactDomPrefix: "react_update_limit-",
    native: "native-update-limit",
    nativeDomPrefix: "native_update_limit-",
    expectedNative: [
      { id: "one", label: "One" },
      { id: "two", label: "Two ordinary updated" },
      { id: "three", label: "Three" },
      { id: "four", label: "Four" },
    ],
  },
  {
    title: "updates an existing update-only item without applying its limit",
    button: "compare-update-only-limit",
    operation: "compare_update_only_limit",
    react: "react-update-only-limit",
    reactDomPrefix: "react_update_only_limit-",
    native: "native-update-only-limit",
    nativeDomPrefix: "native_update_only_limit-",
    expectedNative: [
      { id: "one", label: "One" },
      { id: "two", label: "Two update-only updated" },
      { id: "three", label: "Three" },
      { id: "four", label: "Four" },
    ],
  },
  {
    title: "skips a missing update-only item and its limit",
    button: "compare-missing-update-only-limit",
    operation: "compare_missing_update_only_limit",
    react: "react-missing-update-only-limit",
    reactDomPrefix: "react_missing_update_only_limit-",
    native: "native-missing-update-only-limit",
    nativeDomPrefix: "native_missing_update_only_limit-",
    expectedNative: [
      { id: "one", label: "One" },
      { id: "two", label: "Two" },
      { id: "three", label: "Three" },
      { id: "four", label: "Four" },
    ],
  },
  {
    title: "restores an existing update-only item across reset",
    button: "compare-reset-update-only",
    operation: "compare_reset_update_only",
    react: "react-reset-update-only",
    reactDomPrefix: "react_reset_update_only-",
    native: "native-reset-update-only",
    nativeDomPrefix: "native_reset_update_only-",
    expectedNative: [{ id: "two", label: "Two reset update-only" }],
  },
] as const;

async function streamItems(
  page: Page,
  name: string,
): Promise<readonly ObservedStreamItem[]> {
  return page
    .getByTestId(`stream-${name}`)
    .locator("[data-stream-logical-id]")
    .evaluateAll((items) =>
      items.map((item) => ({
        id: item.getAttribute("data-stream-logical-id") ?? "",
        label: item.textContent?.trim() ?? "",
      })),
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

  test("SSR includes initial streams plus escaped inert default and named slots", async ({
    page,
  }) => {
    await page.goto("/e2e/streams-slots");

    const root = page.locator("#e2e-streams-slots-root");
    await expect(root.getByTestId("streams-slots-probe")).toBeVisible();
    await expect(
      root.getByTestId("stream-primary").locator("[data-stream-dom-id]"),
    ).toHaveText(["Alpha", "Bravo", "Charlie"]);
    await expect(
      root.getByTestId("stream-positive").locator("[data-stream-dom-id]"),
    ).toHaveText(["One", "Two", "Three"]);
    await expect(
      root.getByTestId("stream-negative").locator("[data-stream-dom-id]"),
    ).toHaveText(["One", "Two", "Three"]);
    await expect(root.locator("#custom-primary-alpha")).toHaveAttribute(
      "data-stream-dom-id",
      "custom-primary-alpha",
    );
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

    const clientOnlyRoot = page.locator("#e2e-client-only-stream-root");
    await expect(clientOnlyRoot.locator("[data-react-target]")).toBeEmpty();
    await expect(clientOnlyRoot.locator("[data-react-hydration]")).toHaveCount(
      0,
    );
  });
});

test("hydrates the exact dead stream DOM before applying the delayed connected snapshot", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  const clientEntryGate = Promise.withResolvers<void>();

  await page.route("http://127.0.0.1:4011/js/app.ts", async (route) => {
    await clientEntryGate.promise;
    await route.continue();
  });
  await page.goto("/e2e/streams-slots?dead_connected=true", {
    waitUntil: "commit",
  });

  const root = page.locator("#e2e-streams-slots-root");
  const probe = root.getByTestId("streams-slots-probe");
  const deadSelector = "#custom-primary-dead-alpha";
  const deadNode = await page.locator(deadSelector).elementHandle();

  expect(deadNode).not.toBeNull();
  await deadNode?.evaluate((node, selector) => {
    Object.defineProperty(window, "__liveViewReactStreamHydrationCapture", {
      configurable: true,
      value: Object.freeze({ node, selector }),
    });
  }, deadSelector);
  await expect(page.getByTestId("server-mount-phase")).toHaveText("dead");
  await expect(root.getByTestId("react-mount-phase")).toHaveText("dead");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual(["custom-primary-dead-alpha", "custom-primary-dead-bravo"]);
  await expect(probe).toHaveAttribute("data-react-committed", "false");
  await expect(root.locator("[data-react-hydration]")).toHaveCount(1);

  clientEntryGate.resolve();
  await page.waitForLoadState("domcontentloaded");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__liveViewReactStreamHydrationEvidence ?? null,
      ),
    )
    .toEqual({
      mountPhase: "dead",
      nodePreserved: true,
      streamIds: ["custom-primary-dead-alpha", "custom-primary-dead-bravo"],
    });
  await expect(root.locator("[data-react-hydration]")).toHaveCount(0);

  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("server-mount-phase")).toHaveText("connected");
  await expect(root.getByTestId("react-mount-phase")).toHaveText("connected");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-connected-alpha",
      "custom-primary-connected-bravo",
    ]);
  await expect(page.locator(deadSelector)).toHaveCount(0);
  expect(browserErrors()).toEqual([]);
});

test("mounts an SSR-disabled client-only stream root", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  const root = page.locator("#e2e-client-only-stream-root");
  await expect(root.locator("[data-react-hydration]")).toHaveCount(0);
  await expect(root.getByTestId("client-only-stream-probe")).toBeVisible();
  await expect
    .poll(() => streamIds(page, "client-only"))
    .toEqual(["client_only-client"]);
  await expect(root.locator("#client_only-client")).toHaveText(
    "Client only initial",
  );
  expect(browserErrors()).toEqual([]);
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
  const clientOnlyBefore = await streamIds(page, "client-only");
  const positiveNode = await page.locator("#positive-two").elementHandle();
  const clientOnlyNode = await page
    .locator("#client_only-client")
    .elementHandle();

  await page.getByTestId("reset-primary").click();
  await expectOperation(page, "reset_primary");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual(["custom-primary-reset-one", "custom-primary-reset-two"]);
  expect(await streamIds(page, "positive")).toEqual(positiveBefore);
  expect(await streamIds(page, "negative")).toEqual(negativeBefore);
  expect(await streamIds(page, "client-only")).toEqual(clientOnlyBefore);
  await expectSameNode(page, "#positive-two", positiveNode);
  await expectSameNode(page, "#client_only-client", clientOnlyNode);
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

test.describe("native LiveView stream browser parity", () => {
  for (const scenario of NATIVE_STREAM_SCENARIOS) {
    test(scenario.title, async ({ page }, testInfo) => {
      const browserErrors = captureBrowserErrors(page);
      await openHarness(page);

      const [reactItems, nativeItems, reactDomIds, nativeDomIds] =
        await Promise.all([
          streamItems(page, scenario.react),
          streamItems(page, scenario.native),
          streamIds(page, scenario.react),
          streamIds(page, scenario.native),
        ]);

      expect(reactItems).toEqual(INITIAL_COMPARISON_ITEMS);
      expect(nativeItems).toEqual(INITIAL_COMPARISON_ITEMS);
      expect(new Set([...reactDomIds, ...nativeDomIds]).size).toBe(8);

      const reactStableSelector = `#${scenario.reactDomPrefix}two`;
      const nativeStableSelector = `#${scenario.nativeDomPrefix}two`;
      const [reactStableNode, nativeStableNode] = await Promise.all([
        page.locator(reactStableSelector).elementHandle(),
        page.locator(nativeStableSelector).elementHandle(),
      ]);

      await page.getByTestId(scenario.button).click();
      await expectOperation(page, scenario.operation);

      const result = {
        expectedNative: scenario.expectedNative,
        operation: scenario.operation,
        react: await streamItems(page, scenario.react),
        reactDomIds: await streamIds(page, scenario.react),
        native: await streamItems(page, scenario.native),
        nativeDomIds: await streamIds(page, scenario.native),
      };

      await testInfo.attach(`stream-parity-${scenario.operation}`, {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
      expect(result.native, `${result.operation}: native contract`).toEqual(
        result.expectedNative,
      );
      expect(result.nativeDomIds).toEqual(
        result.expectedNative.map(
          ({ id }) => `${scenario.nativeDomPrefix}${id}`,
        ),
      );
      await expectSameNode(page, reactStableSelector, reactStableNode);
      await expectSameNode(page, nativeStableSelector, nativeStableNode);
      expect(browserErrors()).toEqual([]);
      expect(result.react, result.operation).toEqual(result.native);
      expect(result.reactDomIds).toEqual(
        result.expectedNative.map(
          ({ id }) => `${scenario.reactDomPrefix}${id}`,
        ),
      );
    });
  }
});

test("reconnect replaces every stale stream with one authoritative snapshot", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await page.getByTestId("insert-start").click();
  await expectOperation(page, "insert_start");
  await page.getByTestId("positive-limit").click();
  await expectOperation(page, "positive_limit");
  await expect(page.locator("#custom-primary-start")).toBeVisible();
  await expect(page.locator("#positive-zero")).toBeVisible();

  await page.evaluate(() => {
    window.history.replaceState(
      window.history.state,
      "",
      "/e2e/streams-slots?stream_reconnect=true",
    );
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.liveSocket.disconnect(resolve);
      }),
  );
  await page.evaluate(() => window.liveSocket.connect());

  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("server-mount-phase")).toHaveText(
    "reconnected",
  );
  await expect(page.getByTestId("react-mount-phase")).toHaveText("reconnected");
  await expect
    .poll(() => streamIds(page, "primary"))
    .toEqual([
      "custom-primary-reconnect-alpha",
      "custom-primary-reconnect-bravo",
    ]);
  await expect
    .poll(() => streamIds(page, "positive"))
    .toEqual(["positive-reconnect-positive"]);
  await expect
    .poll(() => streamIds(page, "negative"))
    .toEqual(["negative-reconnect-negative"]);
  await expect
    .poll(() => streamIds(page, "client-only"))
    .toEqual(["client_only-reconnect-client"]);
  await expect(page.locator("#custom-primary-start")).toHaveCount(0);
  await expect(page.locator("#positive-zero")).toHaveCount(0);
  await expect(page.locator("#e2e-streams-slots-root")).toHaveAttribute(
    "data-streams-kind",
    "snapshot",
  );
  expect(browserErrors()).toEqual([]);
});

async function expectNoSidebarProp(page: Page): Promise<void> {
  const transport = await page
    .locator("#e2e-streams-slots-root")
    .evaluate((element) => ({
      props: element.getAttribute("data-props") ?? "",
      diff: element.getAttribute("data-props-diff") ?? "",
    }));

  expect(transport.props).not.toContain("sidebar");
  expect(transport.diff).not.toContain("/sidebar");
}

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

  // A removed named slot must not reappear as an ordinary prop. Assert the
  // transport directly: a component that treats [] like an absent slot would
  // hide the leak from a rendered-output assertion.
  await expectNoSidebarProp(page);

  // Restoring the slot must not collide with a stale ordinary prop.
  await page.getByTestId("restore-named-slot").click();
  await expectOperation(page, "restore_named_slot");
  await expect(root.getByTestId("named-slot-content")).toHaveText(
    "Named slot revision 1",
  );
  await expectNoSidebarProp(page);

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
    readonly __liveViewReactStreamHydrationCapture?: {
      readonly node: Element;
      readonly selector: string;
    };
    readonly __liveViewReactStreamHydrationEvidence?: {
      readonly mountPhase: string | null | undefined;
      readonly nodePreserved: boolean;
      readonly streamIds: readonly (string | null)[];
    };
    readonly liveSocket: {
      readonly connect: () => void;
      readonly disconnect: (callback?: () => void) => void;
    };
  }
}
