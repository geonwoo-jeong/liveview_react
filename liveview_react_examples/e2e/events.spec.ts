import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __eventsDocumentToken?: string;
    readonly __liveViewReactEventsE2E: {
      readonly invokeRetainedIncrement: (payload: {
        readonly by: number;
        readonly label: string;
      }) => void;
      readonly snapshot: () => {
        readonly serverEventDeliveries: readonly number[];
      };
    };
    readonly liveSocket: {
      readonly connect: () => void;
      readonly disconnect: (callback?: () => void) => void;
    };
  }
}

function captureBrowserErrors(page: Page): () => readonly string[] {
  let errors: readonly string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors = [...errors, `console: ${message.text()}`];
    }
  });
  page.on("pageerror", (error) => {
    errors = [...errors, `pageerror: ${error.message}`];
  });
  return () => errors;
}

async function openEventsHarness(page: Page): Promise<void> {
  await page.goto("/e2e/events");
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("events-probe")).toBeVisible();
  await expect(page.getByTestId("connection-state")).toHaveText(
    "connected:stable",
  );
}

test("bridges callback JS, programmatic replies, and React phx-click", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);

  await page.getByTestId("callback-increment").click();
  await expect(page.getByTestId("callback-loading")).toHaveClass(
    /phx-hook-loading/,
  );
  await expect(page.getByTestId("callback-transition")).toHaveClass(
    /e2e-transition-active/,
  );
  await expect(page.getByTestId("callback-count")).toHaveText("2");
  await expect(page.getByTestId("callback-payload")).toHaveText(
    "by=2,label=react,static=server",
  );
  await expect(page.getByTestId("callback-loading")).not.toHaveClass(
    /phx-hook-loading/,
  );

  await page.getByTestId("programmatic-push").click();
  await expect(page.getByTestId("programmatic-reply")).toHaveText(
    "programmatic:6",
  );

  await page.getByTestId("event-reply").click();
  await expect(page.getByTestId("event-reply-result")).toHaveText("REACT");
  await expect(page.getByTestId("event-reply-loading")).toHaveText("idle");

  await page.getByTestId("react-phx-click").click();
  await expect(page.getByTestId("server-phx-count")).toHaveText("4");
  expect(browserErrors()).toEqual([]);
});

test("restores server events and connection state once after reconnect", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);

  await page.getByTestId("emit-server-event").click();
  await expect(page.getByTestId("server-event-deliveries")).toHaveText("1");

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.liveSocket.disconnect(resolve);
      }),
  );
  await expect(page.getByTestId("connection-state")).toHaveText(
    "disconnected:reconnecting",
  );

  await page.evaluate(() => window.liveSocket.connect());
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("connection-state")).toHaveText(
    "connected:stable",
  );
  await expect(page.getByTestId("server-push-sequence")).toHaveText("100");

  await page.getByTestId("emit-server-event").click();
  await expect(page.getByTestId("server-push-sequence")).toHaveText("101");
  await expect(page.getByTestId("server-event-deliveries")).toHaveText("1,101");
  expect(browserErrors()).toEqual([]);
});

test("destroyed callback props no longer execute Phoenix commands", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);

  await page.getByTestId("callback-increment").click();
  await expect(page.getByTestId("callback-count")).toHaveText("2");
  await page.getByTestId("emit-server-event").click();
  await expect(page.getByTestId("server-event-deliveries")).toHaveText("1");
  await page.getByTestId("remove-events-root").click();
  await expect(page.locator("#e2e-events-root")).toHaveCount(0);

  await page.evaluate(() => {
    window.__liveViewReactEventsE2E.invokeRetainedIncrement({
      by: 9,
      label: "destroyed",
    });
  });
  await page.getByTestId("callback-barrier").click();
  await expect(page.getByTestId("callback-barrier-sequence")).toHaveText("1");
  await page.getByTestId("emit-server-event").click();
  await expect(page.getByTestId("server-push-sequence")).toHaveText("2");

  await expect(page.getByTestId("callback-count")).toHaveText("2");
  expect(
    await page.evaluate(
      () => window.__liveViewReactEventsE2E.snapshot().serverEventDeliveries,
    ),
  ).toEqual([1]);
  expect(browserErrors()).toEqual([]);
});

test("useLiveNavigation and Link patch without replacing the document", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);
  await page.evaluate(() => {
    window.__eventsDocumentToken = "preserved";
  });

  await page.getByTestId("programmatic-patch").click();
  await expect(page).toHaveURL(/\/e2e\/events\?step=programmatic$/);
  await expect(page.getByTestId("react-patch-step")).toHaveText("programmatic");

  await page.getByTestId("link-patch").click();
  await expect(page).toHaveURL(/\/e2e\/events\?step=link$/);
  await expect(page.getByTestId("server-patch-step")).toHaveText("link");
  expect(await page.evaluate(() => window.__eventsDocumentToken)).toBe(
    "preserved",
  );
  expect(browserErrors()).toEqual([]);
});

test("programmatic navigation and Link navigate preserve the current document", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);
  await page.evaluate(() => {
    window.__eventsDocumentToken = "programmatic";
  });

  await page.getByTestId("programmatic-navigate").click();
  await expect(page.getByTestId("events-destination")).toBeVisible();
  await expect(page.getByTestId("destination-via")).toHaveText("programmatic");
  expect(await page.evaluate(() => window.__eventsDocumentToken)).toBe(
    "programmatic",
  );

  await page.getByTestId("return-to-events").click();
  await expect(page.getByTestId("events-probe")).toBeVisible();
  await page.evaluate(() => {
    window.__eventsDocumentToken = "link";
  });
  await page.getByTestId("link-navigate").click();
  await expect(page.getByTestId("destination-via")).toHaveText("link");
  expect(await page.evaluate(() => window.__eventsDocumentToken)).toBe("link");
  expect(browserErrors()).toEqual([]);
});

test("Link href performs a native full-page navigation", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);
  await page.evaluate(() => {
    window.__eventsDocumentToken = "must-be-replaced";
  });

  await page.getByTestId("link-href").click();
  await expect(page.getByTestId("events-destination")).toBeVisible();
  await expect(page.getByTestId("destination-via")).toHaveText("href");
  expect(
    await page.evaluate(() => window.__eventsDocumentToken),
  ).toBeUndefined();
  expect(browserErrors()).toEqual([]);
});

test("Link leaves target and modified clicks to the browser", async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page);
  await openEventsHarness(page);

  const [targetPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByTestId("link-target").click(),
  ]);
  await targetPage.waitForLoadState("domcontentloaded");
  await expect(targetPage).toHaveURL(/\/e2e\/events\?step=target$/);
  await expect(page).toHaveURL(/\/e2e\/events$/);
  await targetPage.close();

  const [modifiedClickWasPrevented] = await Promise.all([
    page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.addEventListener(
            "click",
            (event) => {
              resolve(event.defaultPrevented);
              // Observe Link's decision, then suppress browser navigation so
              // this assertion does not depend on headless popup policy.
              event.preventDefault();
            },
            { once: true },
          );
        }),
    ),
    page.getByTestId("link-modified").click({ modifiers: ["ControlOrMeta"] }),
  ]);
  expect(modifiedClickWasPrevented).toBe(false);
  await expect(page).toHaveURL(/\/e2e\/events$/);
  expect(browserErrors()).toEqual([]);
});
