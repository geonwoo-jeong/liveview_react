import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

interface RootErrorAudit {
  readonly componentStack: string | null;
  readonly kind: "caught" | "recoverable" | "uncaught";
  readonly message: string;
  readonly name: string;
}

interface ReactCompatAudit {
  readonly rootErrors: readonly RootErrorAudit[];
}

interface ReactCompatGlobals {
  readonly __liveViewReactCompat: {
    readonly resolveSuspense: () => Promise<void>;
  };
  readonly __liveViewReactE2E: {
    readonly snapshot: () => ReactCompatAudit;
  };
}

interface ReactDevToolsSnapshot {
  readonly activeRootCount: number;
  readonly committedRootCount: number;
  readonly rendererCount: number;
}

declare global {
  interface Window {
    readonly __liveViewReactCompat: ReactCompatGlobals["__liveViewReactCompat"];
    readonly __reactDevToolsE2E: {
      readonly snapshot: () => ReactDevToolsSnapshot;
    };
  }
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

async function installReactDevToolsAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface FiberRoot {
      readonly current?: {
        readonly memoizedState?: {
          readonly element?: unknown;
        };
      };
    }

    interface CommittedRoot {
      readonly rendererId: number;
      readonly root: FiberRoot;
    }

    let state: Readonly<{
      readonly committedRoots: readonly CommittedRoot[];
      readonly nextRendererId: number;
      readonly rendererIds: readonly number[];
    }> = Object.freeze({
      committedRoots: Object.freeze([] as readonly CommittedRoot[]),
      nextRendererId: 1,
      rendererIds: Object.freeze([] as readonly number[]),
    });

    const snapshot = (): ReactDevToolsSnapshot =>
      Object.freeze({
        activeRootCount: state.committedRoots.filter(
          ({ root }) => root.current?.memoizedState?.element != null,
        ).length,
        committedRootCount: state.committedRoots.length,
        rendererCount: state.rendererIds.length,
      });

    Object.defineProperty(window, "__reactDevToolsE2E", {
      configurable: true,
      value: Object.freeze({ snapshot }),
    });

    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      value: {
        renderers: new Map<number, unknown>(),
        supportsFiber: true,
        inject() {
          const rendererId = state.nextRendererId;
          state = Object.freeze({
            ...state,
            nextRendererId: rendererId + 1,
            rendererIds: Object.freeze([...state.rendererIds, rendererId]),
          });
          return rendererId;
        },
        onCommitFiberRoot(rendererId: number, root: FiberRoot) {
          const alreadyRecorded = state.committedRoots.some(
            (entry) => entry.rendererId === rendererId && entry.root === root,
          );
          if (alreadyRecorded) return;

          state = Object.freeze({
            ...state,
            committedRoots: Object.freeze([
              ...state.committedRoots,
              Object.freeze({ rendererId, root }),
            ]),
          });
        },
      },
    });
  });
}

async function openHarness(page: Page): Promise<void> {
  await installReactDevToolsAudit(page);
  await page.goto("/e2e/react-compat");
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("react-compat-harness")).toBeVisible();
  await expect(page.getByTestId("compat-function")).toHaveText("function");
  await expect
    .poll(
      async () =>
        page.evaluate(() => window.__reactDevToolsE2E.snapshot().rendererCount),
      { message: "React must inject one renderer" },
    )
    .toBe(1);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => window.__reactDevToolsE2E.snapshot().activeRootCount,
        ),
      { message: "React must commit both bridge roots" },
    )
    .toBeGreaterThanOrEqual(2);
}

async function readRootErrors(page: Page): Promise<readonly RootErrorAudit[]> {
  return page.evaluate(
    () =>
      (window as unknown as ReactCompatGlobals).__liveViewReactE2E.snapshot()
        .rootErrors,
  );
}

async function resolveSuspense(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__liveViewReactCompat.resolveSuspense();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

test("preserves function, class, memo, forwardRef, and useId state in StrictMode", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await expect(page.getByTestId("compat-root-context")).toHaveText(
    "E2EReactCompatProbe:e2e-react-compat-root",
  );
  await expect(page.getByTestId("compat-class-count")).toHaveText("0");
  await expect(page.getByTestId("compat-server-version")).toHaveText("0");

  const instanceBefore = await page
    .getByTestId("compat-instance")
    .textContent();
  const reactIdBefore = await page.getByTestId("compat-id").textContent();
  const memoRendersBefore = await page
    .getByTestId("compat-memo-renders")
    .textContent();

  expect(instanceBefore).toMatch(/^compat-instance-\d+$/);
  expect(reactIdBefore).toBeTruthy();
  expect(Number(memoRendersBefore)).toBeGreaterThan(0);

  await page.getByTestId("compat-class-increment").click();
  await expect(page.getByTestId("compat-class-count")).toHaveText("1");

  await page.getByTestId("compat-controlled").fill("local state");
  await expect(page.getByTestId("compat-controlled-value")).toHaveText(
    "local state",
  );

  await page.getByTestId("compat-focus-ref").click();
  await expect(page.getByTestId("compat-ref-input")).toBeFocused();

  await page.getByTestId("server-update-compat").click();
  await expect(page.getByTestId("compat-server-authoritative")).toHaveText("1");
  await expect(page.getByTestId("compat-server-version")).toHaveText("1");
  await expect(page.getByTestId("compat-class-count")).toHaveText("1");
  await expect(page.getByTestId("compat-controlled")).toHaveValue(
    "local state",
  );
  await expect(page.getByTestId("compat-instance")).toHaveText(
    instanceBefore ?? "",
  );
  await expect(page.getByTestId("compat-id")).toHaveText(reactIdBefore ?? "");
  await expect(page.getByTestId("compat-memo-renders")).toHaveText(
    memoRendersBefore ?? "",
  );

  const devTools = await page.evaluate(() =>
    window.__reactDevToolsE2E.snapshot(),
  );
  expect(devTools.rendererCount).toBe(1);
  expect(devTools.activeRootCount).toBeGreaterThanOrEqual(2);
  expect(devTools.committedRootCount).toBeGreaterThanOrEqual(2);
  expect(browserErrors()).toEqual([]);
});

test("keeps Context and React event propagation across a portal", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  const portalHost = page.getByTestId("compat-portal-host");
  const portalButton = portalHost.getByTestId("compat-portal-button");

  await expect(portalButton).toBeVisible();
  await expect(portalHost.getByTestId("compat-portal-context")).toHaveText(
    "E2EReactCompatProbe:e2e-react-compat-root",
  );
  await expect(page.getByTestId("compat-portal-bubbles")).toHaveText("0");

  await portalButton.click();
  await expect(page.getByTestId("compat-portal-bubbles")).toHaveText("1");

  await page.getByTestId("server-update-compat").click();
  await expect(page.getByTestId("compat-server-version")).toHaveText("1");
  await expect(portalHost.getByTestId("compat-portal-context")).toHaveText(
    "E2EReactCompatProbe:e2e-react-compat-root",
  );
  await portalHost.getByTestId("compat-portal-button").click();
  await expect(page.getByTestId("compat-portal-bubbles")).toHaveText("2");
  expect(browserErrors()).toEqual([]);
});

test("resolves Suspense and processes a transition in the mounted root", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await expect(page.getByTestId("compat-suspense-fallback")).toBeVisible();
  await expect(page.getByTestId("compat-lazy-ready")).toHaveCount(0);

  await page.getByTestId("compat-transition").click();
  await expect(page.getByTestId("compat-transition-value")).toHaveText("1");

  await resolveSuspense(page);
  await expect(page.getByTestId("compat-lazy-ready")).toHaveText("ready");
  await expect(page.getByTestId("compat-suspense-fallback")).toHaveCount(0);
  expect(browserErrors()).toEqual([]);
});

test("supports Radix, controlled input, rich editing, canvas, and WebGL", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  await page.getByTestId("compat-controlled").fill("controlled");
  await expect(page.getByTestId("compat-controlled-value")).toHaveText(
    "controlled",
  );

  const slider = page
    .getByTestId("compat-third-party-slider")
    .getByRole("slider");
  await expect(page.getByTestId("compat-third-party-value")).toHaveText("25");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(page.getByTestId("compat-third-party-value")).not.toHaveText(
    "25",
  );
  const sliderValue = await page
    .getByTestId("compat-third-party-value")
    .textContent();

  await expect(page.getByTestId("compat-rich-html")).toHaveText(
    "<p>editable</p>",
  );
  await page.getByTestId("compat-rich-editor").evaluate((editor) => {
    editor.innerHTML = "<strong>edited</strong>";
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "edited",
        inputType: "insertText",
      }),
    );
  });
  await expect(page.getByTestId("compat-rich-html")).toHaveText(
    "<strong>edited</strong>",
  );

  await expect(page.getByTestId("compat-canvas-2d")).toHaveText("255,0,0,255");
  await expect(page.getByTestId("compat-webgl")).toHaveText("255,0,0,255");

  await page.getByTestId("server-update-compat").click();
  await expect(page.getByTestId("compat-server-version")).toHaveText("1");
  await expect(page.getByTestId("compat-controlled")).toHaveValue("controlled");
  await expect(page.getByTestId("compat-third-party-value")).toHaveText(
    sliderValue ?? "",
  );
  await expect(page.getByTestId("compat-rich-html")).toHaveText(
    "<strong>edited</strong>",
  );
  expect(browserErrors()).toEqual([]);
});

test("routes caught and uncaught failures through React root callbacks", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openHarness(page);

  expect(await readRootErrors(page)).toEqual([]);

  await page.getByTestId("compat-error-trigger").click();
  await expect(page.getByTestId("compat-error-fallback")).toHaveText(
    "compat boundary failure",
  );
  await expect
    .poll(async () =>
      (await readRootErrors(page)).find(({ kind }) => kind === "caught"),
    )
    .toMatchObject({
      kind: "caught",
      message: "compat boundary failure",
      name: "Error",
    });

  await page.getByTestId("crash-uncaught").click();
  await expect
    .poll(async () =>
      (await readRootErrors(page)).find(({ kind }) => kind === "uncaught"),
    )
    .toMatchObject({
      kind: "uncaught",
      message: "compat uncaught failure",
      name: "Error",
    });

  const rootErrors = await readRootErrors(page);
  expect(rootErrors.map(({ kind }) => kind)).toEqual(["caught", "uncaught"]);
  for (const rootError of rootErrors.filter(
    ({ kind }) => kind === "caught" || kind === "uncaught",
  )) {
    expect(rootError.componentStack).toEqual(expect.any(String));
    expect(rootError.componentStack).not.toBe("");
  }
  expect(browserErrors()).toEqual([]);
});
