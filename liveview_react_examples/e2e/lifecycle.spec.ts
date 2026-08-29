import { expect, test, type Page } from "@playwright/test";

interface ProbeAudit {
  readonly mounts: number;
  readonly cleanups: number;
}

interface LazyAudit {
  readonly requests: number;
  readonly pending: number;
  readonly resolved: number;
}

interface LifecycleAudit {
  readonly probes: Readonly<Record<string, ProbeAudit | undefined>>;
  readonly lazy: Readonly<Record<"update" | "destroy", LazyAudit>>;
  readonly strict: {
    readonly registrations: number;
    readonly removals: number;
    readonly activeListeners: number;
    readonly deliveries: number;
  };
  readonly transport: {
    readonly corruptions: number;
  };
  readonly hookCallbacks: readonly {
    readonly lifecycle: "disconnected" | "reconnected" | "updated";
    readonly propsKind: "patch" | "snapshot" | null;
    readonly authoritativeQueuedCount: string | null;
  }[];
}

declare global {
  interface Window {
    readonly __liveViewReactE2E: {
      readonly corruptNextPropsPatch: (rootId: string) => void;
      readonly resolveLazy: (gate: "update" | "destroy") => Promise<number>;
      readonly snapshot: () => LifecycleAudit;
      readonly startReconnectTrace: (rootId: string) => void;
    };
    readonly liveSocket: {
      readonly connect: () => void;
      readonly disconnect: (callback?: () => void) => void;
    };
  }
}

async function openHarness(page: Page): Promise<void> {
  await page.goto("/e2e/lifecycle");
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("probe-a")).toBeVisible();
  await expect(page.getByTestId("probe-b")).toBeVisible();
  await expect
    .poll(async () => (await readAudit(page)).probes.a?.mounts)
    .toBe(2);
  await expect
    .poll(async () => (await readAudit(page)).probes.b?.mounts)
    .toBe(2);
}

async function readAudit(page: Page): Promise<LifecycleAudit> {
  return page.evaluate(() => window.__liveViewReactE2E.snapshot());
}

async function resolveLazy(
  page: Page,
  gate: "update" | "destroy",
): Promise<number> {
  return page.evaluate(async (gateName) => {
    const released = await window.__liveViewReactE2E.resolveLazy(gateName);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    return released;
  }, gate);
}

function capturePageErrors(page: Page): () => readonly string[] {
  let errors: readonly string[] = [];
  page.on("pageerror", (error) => {
    errors = [...errors, error.message];
  });
  return () => errors;
}

test("independent roots preserve local state and identity across server updates", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);

  const instanceA = await page.getByTestId("instance-a").textContent();
  const instanceB = await page.getByTestId("instance-b").textContent();
  expect(instanceA).not.toBe("pending");
  expect(instanceB).not.toBe("pending");

  await page.getByTestId("local-increment-a").click();
  await page.getByTestId("local-increment-a").click();
  await expect(page.getByTestId("local-a")).toHaveText("2");
  await expect(page.getByTestId("local-b")).toHaveText("0");

  await page.getByTestId("server-update-a").click();
  await expect(page.getByTestId("server-a")).toHaveText("1");
  await expect(page.getByTestId("server-b")).toHaveText("0");
  await expect(page.getByTestId("local-a")).toHaveText("2");
  await expect(page.getByTestId("instance-a")).toHaveText(instanceA ?? "");

  await page.getByTestId("server-update-b").click();
  await expect(page.getByTestId("server-b")).toHaveText("1");
  await expect(page.getByTestId("server-a")).toHaveText("1");

  const audit = await readAudit(page);
  expect(audit.probes.a).toEqual({ mounts: 2, cleanups: 1 });
  expect(audit.probes.b).toEqual({ mounts: 2, cleanups: 1 });
  expect(pageErrors()).toEqual([]);
});

test("conditional removal and LiveView navigation clean roots exactly once", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);

  await page.getByTestId("remove-b").click();
  await expect(page.locator("#e2e-root-b")).toHaveCount(0);
  await expect(page.getByTestId("removal-sequence")).toHaveText("1");
  await expect
    .poll(async () => (await readAudit(page)).probes.b?.cleanups)
    .toBe(2);

  await page.getByTestId("remove-b").click();
  await expect(page.getByTestId("removal-sequence")).toHaveText("2");
  expect((await readAudit(page)).probes.b?.cleanups).toBe(2);

  await page.getByTestId("navigate-away").click();
  await expect(page.getByTestId("lifecycle-destination")).toBeVisible();
  await expect
    .poll(async () => (await readAudit(page)).probes.a?.cleanups)
    .toBe(2);

  expect((await readAudit(page)).probes.b?.cleanups).toBe(2);
  expect(pageErrors()).toEqual([]);
});

test("a pending lazy root mounts with the latest server props", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);

  await expect
    .poll(async () => (await readAudit(page)).lazy.update.pending)
    .toBe(1);
  await expect(
    page.locator("#e2e-delayed-update [data-react-target]"),
  ).toBeEmpty();

  await page.getByTestId("update-delayed").click();
  await page.getByTestId("update-delayed").click();
  expect(await resolveLazy(page, "update")).toBe(1);

  await expect(page.getByTestId("probe-lazy-update")).toBeVisible();
  await expect(page.getByTestId("server-lazy-update")).toHaveText("2");
  await expect(page.getByTestId("instance-lazy-update")).toHaveText(
    "lazy-update-2",
  );
  expect((await readAudit(page)).probes["lazy-update"]).toEqual({
    mounts: 2,
    cleanups: 1,
  });
  expect(pageErrors()).toEqual([]);
});

test("destroying a pending lazy root prevents a late mount", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);

  await expect
    .poll(async () => (await readAudit(page)).lazy.destroy.pending)
    .toBe(1);
  await page.getByTestId("remove-delayed-destroy").click();
  await expect(page.locator("#e2e-delayed-destroy")).toHaveCount(0);

  expect(await resolveLazy(page, "destroy")).toBe(1);

  const audit = await readAudit(page);
  expect(audit.lazy.destroy).toEqual({ requests: 1, pending: 0, resolved: 1 });
  expect(audit.probes["lazy-destroy"]).toBeUndefined();
  expect(pageErrors()).toEqual([]);
});

test("reconnect consumes the join snapshot and queued patch once without remounting", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);

  await page.getByTestId("local-increment-a").click();
  await page.getByTestId("local-increment-a").click();
  await page.getByTestId("server-update-a").click();
  await expect(page.getByTestId("server-a")).toHaveText("1");
  await expect(page.getByTestId("queued-count-a")).toHaveText("0");
  const instanceBefore = await page.getByTestId("instance-a").textContent();

  await page.evaluate(() => {
    window.history.replaceState(
      window.history.state,
      "",
      "/e2e/lifecycle?queued_reconnect=true",
    );
    window.__liveViewReactE2E.startReconnectTrace("e2e-root-a");
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.liveSocket.disconnect(resolve);
      }),
  );
  await page.evaluate(() => window.liveSocket.connect());

  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("authoritative-a")).toHaveText("0");
  await expect(page.getByTestId("authoritative-queued-count")).toHaveText("1");
  await expect(page.getByTestId("server-a")).toHaveText("0");
  await expect(page.getByTestId("queued-count-a")).toHaveText("1");
  await expect(page.getByTestId("local-a")).toHaveText("2");
  await expect(page.getByTestId("instance-a")).toHaveText(instanceBefore ?? "");

  const audit = await readAudit(page);
  expect(audit.probes.a).toEqual({ mounts: 2, cleanups: 1 });
  expect(audit.hookCallbacks).toEqual([
    {
      lifecycle: "disconnected",
      propsKind: "patch",
      authoritativeQueuedCount: "0",
    },
    {
      lifecycle: "updated",
      propsKind: "snapshot",
      authoritativeQueuedCount: "0",
    },
    {
      lifecycle: "updated",
      propsKind: "patch",
      authoritativeQueuedCount: "1",
    },
    {
      lifecycle: "reconnected",
      propsKind: "patch",
      authoritativeQueuedCount: "1",
    },
  ]);
  expect(pageErrors()).toEqual([]);
});

test("a malformed patch recovers through a full rejoin snapshot without remounting", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);

  await page.getByTestId("local-increment-a").click();
  await expect(page.getByTestId("local-a")).toHaveText("1");
  const instanceBefore = await page.getByTestId("instance-a").textContent();

  await page.evaluate(() => {
    window.history.replaceState(
      window.history.state,
      "",
      "/e2e/lifecycle?malformed_recovery=true",
    );
    window.__liveViewReactE2E.startReconnectTrace("e2e-root-a");
    window.__liveViewReactE2E.corruptNextPropsPatch("e2e-root-a");
  });

  await page.getByTestId("server-update-a").click();

  await expect
    .poll(async () => (await readAudit(page)).transport.corruptions)
    .toBe(1);
  await expect(page.locator("[data-phx-main]")).toHaveClass(/phx-connected/);
  await expect(page.getByTestId("authoritative-a")).toHaveText("41");
  await expect(page.getByTestId("server-a")).toHaveText("41");
  await expect(page.getByTestId("local-a")).toHaveText("1");
  await expect(page.getByTestId("instance-a")).toHaveText(instanceBefore ?? "");

  const audit = await readAudit(page);
  expect(audit.probes.a).toEqual({ mounts: 2, cleanups: 1 });
  expect(
    audit.hookCallbacks.map(({ lifecycle, propsKind }) => [
      lifecycle,
      propsKind,
    ]),
  ).toEqual([
    ["updated", "patch"],
    ["disconnected", "patch"],
    ["updated", "snapshot"],
    ["reconnected", "snapshot"],
  ]);
  expect(pageErrors()).toEqual([]);
});

test("the StrictMode runtime option replays effects without leaking a listener", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await openHarness(page);
  await expect(page.getByTestId("strict-probe")).toBeVisible();

  await expect
    .poll(async () => (await readAudit(page)).strict)
    .toMatchObject({ registrations: 2, removals: 1, activeListeners: 1 });

  await page.getByTestId("strict-ping").click();
  await expect(page.getByTestId("strict-sequence")).toHaveText("1");
  await expect(page.getByTestId("strict-deliveries")).toHaveText("1");
  expect((await readAudit(page)).strict.deliveries).toBe(1);

  await page.getByTestId("remove-strict").click();
  await expect(page.getByTestId("strict-probe")).toHaveCount(0);
  await expect
    .poll(async () => (await readAudit(page)).strict)
    .toMatchObject({ registrations: 2, removals: 2, activeListeners: 0 });

  await page.getByTestId("strict-ping").click();
  await expect(page.getByTestId("strict-sequence")).toHaveText("2");
  expect((await readAudit(page)).strict.deliveries).toBe(1);
  expect(pageErrors()).toEqual([]);
});
