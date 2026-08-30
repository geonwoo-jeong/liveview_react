import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireNavigationDestroyLease,
  captureNavigationVisualSnapshot,
  type NavigationDestroyLease,
  NAVIGATION_UNMOUNT_TIMEOUT_MS,
} from "./navigation-destroy";

interface TestIsland {
  readonly element: HTMLElement;
  readonly main: HTMLElement;
  readonly target: HTMLElement;
}

function createIsland(main?: HTMLElement): TestIsland {
  const owner = main ?? document.createElement("main");
  owner.setAttribute("data-phx-main", "true");
  const element = document.createElement("section");
  const target = document.createElement("div");
  target.setAttribute("data-react-target", "");
  element.append(target);
  owner.append(element);
  if (!owner.isConnected) document.body.append(owner);
  return { element, main: owner, target };
}

function dispatchBeforeNavigate(
  href: string,
  options: { patch?: boolean; pop?: boolean } = {},
): CustomEvent {
  const event = new CustomEvent("phx:before-navigate", {
    cancelable: true,
    detail: {
      href,
      patch: options.patch ?? false,
      pop: options.pop ?? false,
    },
  });
  window.dispatchEvent(event);
  return event;
}

function dispatchPageLoading(
  phase: "start" | "stop",
  to: string,
  kind = "redirect",
): void {
  window.dispatchEvent(
    new CustomEvent(`phx:page-loading-${phase}`, {
      detail: { kind, to },
    }),
  );
}

describe("navigation teardown", () => {
  const leases: NavigationDestroyLease[] = [];

  const acquire = (element: HTMLElement): NavigationDestroyLease => {
    const lease = acquireNavigationDestroyLease(element);
    leases.push(lease);
    return lease;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    for (const lease of leases.splice(0)) lease.release();
    vi.runOnlyPendingTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("installs one lazy listener set per Window and releases it with the final owner", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const first = createIsland();
    const second = createIsland(first.main);

    const firstLease = acquire(first.element);
    const secondLease = acquire(second.element);

    for (const name of [
      "phx:before-navigate",
      "phx:page-loading-start",
      "phx:page-loading-stop",
    ]) {
      expect(add.mock.calls.filter(([event]) => event === name)).toHaveLength(
        1,
      );
    }

    expect(firstLease.release()).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(secondLease.release()).toBe(true);
    expect(secondLease.release()).toBe(false);
    for (const name of [
      "phx:before-navigate",
      "phx:page-loading-start",
      "phx:page-loading-stop",
    ]) {
      expect(
        remove.mock.calls.filter(([event]) => event === name),
      ).toHaveLength(1);
    }
  });

  it("keeps ordinary removal and LiveView patches on the immediate path", () => {
    const island = createIsland();
    const lease = acquire(island.element);

    expect(lease.reserve(island.element)).toBeNull();
    dispatchBeforeNavigate("/patch", { patch: true });
    dispatchPageLoading("start", "/patch", "patch");
    expect(lease.reserve(island.element)).toBeNull();
  });

  it("retains only an inert DOM snapshot while React can unmount immediately", async () => {
    const island = createIsland();
    const probe = document.createElement("button");
    probe.textContent = "outgoing";
    probe.setAttribute("data-react-probe", "true");
    const click = vi.fn();
    probe.addEventListener("click", click);
    island.target.append(probe);
    const lease = acquire(island.element);

    dispatchBeforeNavigate("/destination");
    dispatchPageLoading("start", "/destination");
    const reservation = lease.reserve(island.element);
    expect(reservation).not.toBeNull();
    const snapshot = captureNavigationVisualSnapshot(island.target);

    // This models root.unmount(): the live React DOM and its listeners are gone.
    island.target.replaceChildren();
    expect(snapshot.restore()).toBe(true);
    const remove = vi.fn(snapshot.remove);
    expect(reservation?.commit(remove)).toBe(true);

    const retained = island.target.querySelector("[data-react-probe]");
    expect(retained?.textContent).toBe("outgoing");
    expect(island.target.hasAttribute("inert")).toBe(true);
    expect(island.element.hasAttribute("inert")).toBe(true);
    retained?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(click).not.toHaveBeenCalled();

    island.main.remove();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(snapshot.remove()).toBe(false);
  });

  it("copies live form, scroll, and canvas state into the visual snapshot", () => {
    const island = createIsland();
    island.target.scrollLeft = 5;
    island.target.scrollTop = 8;
    island.target.innerHTML = `
      <div data-scroll><input><input type="checkbox"><textarea></textarea>
      <select><option>first</option><option>second</option></select><canvas></canvas></div>
    `;
    const scroll = island.target.querySelector<HTMLElement>("[data-scroll]")!;
    scroll.scrollLeft = 13;
    scroll.scrollTop = 21;
    const inputs = island.target.querySelectorAll("input");
    inputs[0]!.value = "typed";
    inputs[1]!.checked = true;
    inputs[1]!.indeterminate = true;
    island.target.querySelector("textarea")!.value = "draft";
    island.target.querySelector("select")!.selectedIndex = 1;
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);

    const snapshot = captureNavigationVisualSnapshot(island.target);
    island.target.replaceChildren();
    snapshot.restore();

    const copies = island.target.querySelectorAll("input");
    expect(copies[0]?.value).toBe("typed");
    expect(copies[1]?.checked).toBe(true);
    expect(copies[1]?.indeterminate).toBe(true);
    expect(island.target.querySelector("textarea")?.value).toBe("draft");
    expect(island.target.querySelector("select")?.selectedIndex).toBe(1);
    expect(
      island.target.querySelector<HTMLElement>("[data-scroll]")?.scrollLeft,
    ).toBe(13);
    expect(
      island.target.querySelector<HTMLElement>("[data-scroll]")?.scrollTop,
    ).toBe(21);
    expect(island.target.scrollLeft).toBe(5);
    expect(island.target.scrollTop).toBe(8);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("neutralizes active elements instead of reconnecting their behavior", () => {
    const island = createIsland();
    const tagName = "liveview-react-navigation-probe";
    let constructed = 0;
    let connected = 0;
    class ActiveProbe extends HTMLElement {
      constructor() {
        super();
        constructed += 1;
      }

      connectedCallback(): void {
        connected += 1;
      }
    }
    if (!customElements.get(tagName))
      customElements.define(tagName, ActiveProbe);

    const probe = document.createElement(tagName);
    probe.textContent = "custom content";
    island.target.append(probe);
    const initialConstructed = constructed;
    const initialConnected = connected;

    const snapshot = captureNavigationVisualSnapshot(island.target);
    island.target.replaceChildren();
    snapshot.restore();

    expect(constructed).toBe(initialConstructed);
    expect(connected).toBe(initialConnected);
    expect(island.target.querySelector(tagName)).toBeNull();
    expect(
      island.target.querySelector(
        '[data-liveview-react-navigation-placeholder="liveview-react-navigation-probe"]',
      )?.textContent,
    ).toBe("custom content");
  });

  it("strips inline handlers and active embedded documents from snapshots", () => {
    const island = createIsland();
    island.target.innerHTML =
      '<button onclick="window.__snapshotExecuted = true">safe</button><iframe srcdoc="active"></iframe>';

    const snapshot = captureNavigationVisualSnapshot(island.target);
    island.target.replaceChildren();
    snapshot.restore();

    expect(island.target.querySelector("button")?.hasAttribute("onclick")).toBe(
      false,
    );
    expect(island.target.querySelector("iframe")).toBeNull();
    expect(
      island.target.querySelector(
        '[data-liveview-react-navigation-placeholder="iframe"]',
      ),
    ).not.toBeNull();
  });

  it("replaces resource-bearing DOM with bounded URL-free placeholders", () => {
    const island = createIsland();
    island.target.innerHTML = `
      <img src="/snapshot-image.png" srcset="/snapshot-image-2x.png 2x" alt="image">
      <picture>
        <source srcset="/snapshot-picture.webp" type="image/webp">
        <img src="/snapshot-picture.png" alt="picture">
      </picture>
      <svg xmlns="http://www.w3.org/2000/svg" width="60" height="30">
        <image href="/snapshot-vector.png" width="60" height="30"></image>
        <use href="/snapshot-symbol.svg#probe"></use>
      </svg>
      <input type="image" src="/snapshot-submit.png" alt="submit">
      <div data-background style="background-image: url('/snapshot-background.png')">label</div>
    `;
    const image = island.target.querySelector("img")!;
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      bottom: 20,
      height: 20,
      left: 0,
      right: 40,
      top: 0,
      width: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const snapshot = captureNavigationVisualSnapshot(island.target);
    island.target.replaceChildren();
    expect(snapshot.restore()).toBe(true);

    expect(
      island.target.querySelector(
        "img, picture, svg, image, use, input[type='image']",
      ),
    ).toBeNull();
    for (const kind of ["img", "picture", "svg", "input", "div"]) {
      expect(
        island.target.querySelector(
          `[data-liveview-react-navigation-placeholder="${kind}"]`,
        ),
      ).not.toBeNull();
    }

    const imagePlaceholder = island.target.querySelector<HTMLElement>(
      '[data-liveview-react-navigation-placeholder="img"]',
    )!;
    expect(imagePlaceholder.style.getPropertyValue("width")).toBe("40px");
    expect(imagePlaceholder.style.getPropertyValue("height")).toBe("20px");
    expect(imagePlaceholder.style.getPropertyPriority("all")).toBe("important");

    const snapshotMarkup = island.target.innerHTML;
    expect(snapshotMarkup).not.toContain("snapshot-image");
    expect(snapshotMarkup).not.toContain("snapshot-picture");
    expect(snapshotMarkup).not.toContain("snapshot-vector");
    expect(snapshotMarkup).not.toContain("snapshot-symbol");
    expect(snapshotMarkup).not.toContain("snapshot-submit");
    expect(snapshotMarkup).not.toContain("snapshot-background");
    expect(snapshotMarkup).not.toMatch(/\b(?:src|srcset|href)\s*=/iu);
    expect(snapshotMarkup).not.toMatch(/url\s*\(/iu);
    expect(island.target.textContent).toContain("label");
  });

  it("finalizes multiple roots in the same navigation exactly once", () => {
    const first = createIsland();
    const second = createIsland(first.main);
    const firstLease = acquire(first.element);
    const secondLease = acquire(second.element);
    const finalizeFirst = vi.fn(() => true);
    const finalizeSecond = vi.fn(() => true);

    dispatchPageLoading("start", "/next");
    expect(firstLease.reserve(first.element)?.commit(finalizeFirst)).toBe(true);
    expect(secondLease.reserve(second.element)?.commit(finalizeSecond)).toBe(
      true,
    );

    dispatchPageLoading("stop", "/next");
    dispatchPageLoading("stop", "/next");
    vi.advanceTimersByTime(NAVIGATION_UNMOUNT_TIMEOUT_MS);
    expect(finalizeFirst).toHaveBeenCalledTimes(1);
    expect(finalizeSecond).toHaveBeenCalledTimes(1);
  });

  it("isolates rapid navigation generations by destination", () => {
    const first = createIsland();
    const second = createIsland(first.main);
    const lease = acquire(first.element);
    const finalizeFirst = vi.fn(() => true);
    const finalizeSecond = vi.fn(() => true);

    dispatchPageLoading("start", "/first");
    expect(lease.reserve(first.element)?.commit(finalizeFirst)).toBe(true);
    dispatchPageLoading("start", "/second");
    expect(lease.reserve(second.element)?.commit(finalizeSecond)).toBe(true);

    dispatchPageLoading("stop", "/second");
    expect(finalizeSecond).toHaveBeenCalledTimes(1);
    expect(finalizeFirst).not.toHaveBeenCalled();
    dispatchPageLoading("stop", "/first");
    expect(finalizeFirst).toHaveBeenCalledTimes(1);
  });

  it("expires a start with no stop so it cannot poison later removals", () => {
    const island = createIsland();
    const lease = acquire(island.element);

    dispatchPageLoading("start", "/interrupted");
    expect(lease.reserve(island.element)).not.toBeNull();
    vi.advanceTimersByTime(NAVIGATION_UNMOUNT_TIMEOUT_MS);

    expect(lease.reserve(island.element)).toBeNull();
  });

  it("expires the inert snapshot exactly once when destination mount never completes", () => {
    const island = createIsland();
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const disconnectObserver = vi.spyOn(
      window.MutationObserver.prototype,
      "disconnect",
    );
    const lease = acquire(island.element);
    island.target.textContent = "outgoing";

    dispatchPageLoading("start", "/never-joins");
    const reservation = lease.reserve(island.element);
    const snapshot = captureNavigationVisualSnapshot(island.target);
    island.target.replaceChildren();
    expect(snapshot.restore()).toBe(true);
    const finalize = vi.fn(snapshot.remove);
    expect(reservation?.commit(finalize)).toBe(true);
    expect(lease.release()).toBe(true);

    vi.advanceTimersByTime(NAVIGATION_UNMOUNT_TIMEOUT_MS - 1);
    expect(finalize).not.toHaveBeenCalled();
    expect(island.target.textContent).toBe("outgoing");

    vi.advanceTimersByTime(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(island.target.childNodes).toHaveLength(0);
    expect(
      island.target.hasAttribute("data-liveview-react-navigation-snapshot"),
    ).toBe(false);
    expect(island.target.hasAttribute("inert")).toBe(true);
    expect(island.element.hasAttribute("inert")).toBe(true);
    expect(snapshot.remove()).toBe(false);
    expect(disconnectObserver).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    for (const name of [
      "phx:before-navigate",
      "phx:page-loading-start",
      "phx:page-loading-stop",
    ]) {
      expect(
        removeEventListener.mock.calls.filter(([event]) => event === name),
      ).toHaveLength(1);
    }

    dispatchPageLoading("stop", "/never-joins");
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(lease.reserve(island.element)).toBeNull();
  });

  it("ignores stale completion and handles stop-before-start ordering", () => {
    const island = createIsland();
    const lease = acquire(island.element);
    const finalize = vi.fn(() => true);

    dispatchPageLoading("stop", "/future");
    dispatchPageLoading("start", "/active");
    expect(lease.reserve(island.element)?.commit(finalize)).toBe(true);
    dispatchPageLoading("stop", "/stale");
    expect(finalize).not.toHaveBeenCalled();
    dispatchPageLoading("stop", "/active");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("ignores a keyless completion instead of finalizing an unrelated generation", () => {
    const island = createIsland();
    const lease = acquire(island.element);
    const finalize = vi.fn(() => true);

    dispatchPageLoading("start", "/active");
    expect(lease.reserve(island.element)?.commit(finalize)).toBe(true);
    dispatchPageLoading("stop", "");
    expect(finalize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(NAVIGATION_UNMOUNT_TIMEOUT_MS);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("rolls back a synchronously cancelled before-navigate event", async () => {
    const island = createIsland();
    const lease = acquire(island.element);
    const cancel = (event: Event): void => event.preventDefault();
    window.addEventListener("phx:before-navigate", cancel);

    dispatchBeforeNavigate("/cancelled", { pop: true });
    await Promise.resolve();
    expect(lease.reserve(island.element)).toBeNull();

    window.removeEventListener("phx:before-navigate", cancel);
  });

  it("recognizes popstate replacement without treating phx:navigate as completion", async () => {
    const island = createIsland();
    const lease = acquire(island.element);
    const finalize = vi.fn(() => true);

    dispatchBeforeNavigate("/back", { pop: true });
    window.dispatchEvent(
      new CustomEvent("phx:navigate", {
        detail: { href: "/back", patch: false, pop: true },
      }),
    );
    expect(lease.reserve(island.element)?.commit(finalize)).toBe(true);
    expect(finalize).not.toHaveBeenCalled();

    island.main.remove();
    await Promise.resolve();
    expect(finalize).toHaveBeenCalledTimes(1);
  });
});
