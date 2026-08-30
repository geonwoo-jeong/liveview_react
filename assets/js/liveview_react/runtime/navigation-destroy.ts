const BEFORE_NAVIGATE_EVENT = "phx:before-navigate";
const PAGE_LOADING_START_EVENT = "phx:page-loading-start";
const PAGE_LOADING_STOP_EVENT = "phx:page-loading-stop";
const MAIN_LIVE_VIEW_SELECTOR = "[data-phx-main]";
const REDIRECT_KIND = "redirect";

export const NAVIGATION_UNMOUNT_TIMEOUT_MS = 2_000;

interface NavigationEventDetail {
  readonly href?: unknown;
  readonly kind?: unknown;
  readonly patch?: unknown;
  readonly pop?: unknown;
  readonly to?: unknown;
}

type BrowserWindow = Window & typeof globalThis;

interface NavigationGeneration {
  acceptingClaims: boolean;
  readonly claims: Set<number>;
  readonly id: number;
  kind: "pending" | "redirect";
  key: string | null;
  readonly timeoutId: number;
}

interface NavigationClaim {
  readonly element: HTMLElement;
  readonly finalize: () => boolean;
  readonly generation: NavigationGeneration;
  readonly id: number;
}

export interface NavigationUnmountReservation {
  readonly cancel: () => boolean;
  readonly commit: (finalize: () => boolean) => boolean;
}

export interface NavigationDestroyLease {
  readonly release: () => boolean;
  readonly reserve: (
    element: HTMLElement,
  ) => NavigationUnmountReservation | null;
}

export interface NavigationVisualSnapshot {
  readonly remove: () => boolean;
  readonly restore: () => boolean;
}

const NOOP_NAVIGATION_LEASE: NavigationDestroyLease = Object.freeze({
  release: () => false,
  reserve: () => null,
});

function readEventDetail(event: Event): NavigationEventDetail | null {
  if (!("detail" in event)) return null;

  const detail = event.detail;
  return typeof detail === "object" && detail !== null
    ? (detail as NavigationEventDetail)
    : null;
}

function reportAsyncError(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

const NAVIGATION_SNAPSHOT_ATTRIBUTE = "data-liveview-react-navigation-snapshot";
const NAVIGATION_PLACEHOLDER_ATTRIBUTE =
  "data-liveview-react-navigation-placeholder";
const ACTIVE_ELEMENT_NAMES = new Set([
  "audio",
  "base",
  "embed",
  "frame",
  "iframe",
  "link",
  "meta",
  "object",
  "portal",
  "script",
  "source",
  "style",
  "track",
  "video",
]);

const RESOURCE_ELEMENT_NAMES = new Set([
  "image",
  "img",
  "picture",
  "svg",
  "use",
]);

const RESOURCE_STYLE_PROPERTIES = [
  "background-image",
  "border-image-source",
  "content",
  "cursor",
  "filter",
  "list-style-image",
  "mask",
  "mask-image",
  "shape-outside",
] as const;

function isCustomSnapshotElement(source: Element): boolean {
  return source.localName.includes("-") || source.hasAttribute("is");
}

function hasResourceBearingStyle(source: Element): boolean {
  const view = source.ownerDocument.defaultView;
  if (!view) return false;

  const computed = view.getComputedStyle(source);
  return RESOURCE_STYLE_PROPERTIES.some((property) =>
    /url\s*\(/iu.test(computed.getPropertyValue(property)),
  );
}

function isPassiveSnapshotElement(source: Element): boolean {
  const localName = source.localName.toLowerCase();
  return (
    ACTIVE_ELEMENT_NAMES.has(localName) ||
    RESOURCE_ELEMENT_NAMES.has(localName) ||
    (localName === "input" &&
      source.getAttribute("type")?.toLowerCase() === "image") ||
    isCustomSnapshotElement(source) ||
    hasResourceBearingStyle(source)
  );
}

function copySnapshotAttributes(source: Element, clone: Element): void {
  for (const attribute of source.attributes) {
    if (
      attribute.name.toLowerCase().startsWith("on") ||
      attribute.name.toLowerCase() === "autofocus" ||
      attribute.name.toLowerCase() === "is"
    ) {
      continue;
    }

    if (attribute.namespaceURI) {
      clone.setAttributeNS(
        attribute.namespaceURI,
        attribute.name,
        attribute.value,
      );
    } else {
      clone.setAttribute(attribute.name, attribute.value);
    }
  }
}

function copySafePlaceholderPresentation(
  source: Element,
  placeholder: HTMLElement,
): void {
  const view = source.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(source);
  let bounds = source.getBoundingClientRect();
  if (
    bounds.width <= 0 &&
    bounds.height <= 0 &&
    source.localName === "picture"
  ) {
    bounds = source.querySelector("img")?.getBoundingClientRect() ?? bounds;
  }

  placeholder.style.setProperty("all", "initial", "important");
  placeholder.style.setProperty("box-sizing", "border-box", "important");
  if (bounds.width > 0) {
    placeholder.style.setProperty("width", `${bounds.width}px`, "important");
  }
  if (bounds.height > 0) {
    placeholder.style.setProperty("height", `${bounds.height}px`, "important");
  }

  const display = computed?.display;
  placeholder.style.setProperty(
    "display",
    !display || display === "contents" || display === "inline"
      ? "inline-block"
      : display,
    "important",
  );

  if (!computed) return;

  for (const property of [
    "background-color",
    "border-bottom-color",
    "border-bottom-style",
    "border-bottom-width",
    "border-left-color",
    "border-left-style",
    "border-left-width",
    "border-radius",
    "border-right-color",
    "border-right-style",
    "border-right-width",
    "border-top-color",
    "border-top-style",
    "border-top-width",
    "opacity",
    "vertical-align",
    "visibility",
  ] as const) {
    const value = computed.getPropertyValue(property);
    if (value) placeholder.style.setProperty(property, value, "important");
  }
}

function createPassivePlaceholder(source: Element): HTMLElement {
  const placeholder = source.ownerDocument.createElement("div");
  placeholder.setAttribute(NAVIGATION_PLACEHOLDER_ATTRIBUTE, source.localName);
  placeholder.setAttribute("aria-hidden", "true");

  for (const attributeName of ["dir", "hidden", "title"]) {
    const value = source.getAttribute(attributeName);
    if (value !== null) placeholder.setAttribute(attributeName, value);
  }

  copySafePlaceholderPresentation(source, placeholder);

  if (isCustomSnapshotElement(source) || hasResourceBearingStyle(source)) {
    for (const child of source.childNodes) {
      placeholder.append(createSnapshotNode(child));
    }
  }
  return placeholder;
}

function createSnapshotNode(source: Node): Node {
  if (source.nodeType !== 1) return source.cloneNode(false);

  const sourceElement = source as Element;
  if (isPassiveSnapshotElement(sourceElement)) {
    return createPassivePlaceholder(sourceElement);
  }

  const clone = sourceElement.ownerDocument.createElementNS(
    sourceElement.namespaceURI,
    sourceElement.localName,
  );
  copySnapshotAttributes(sourceElement, clone);
  for (const child of sourceElement.childNodes) {
    clone.append(createSnapshotNode(child));
  }
  copyLiveElementState(sourceElement, clone);
  return clone;
}

function copyLiveElementState(source: Element, clone: Element): void {
  const sourceHtml = source as HTMLElement;
  const cloneHtml = clone as HTMLElement;
  cloneHtml.scrollLeft = sourceHtml.scrollLeft;
  cloneHtml.scrollTop = sourceHtml.scrollTop;

  switch (source.tagName) {
    case "INPUT": {
      const sourceInput = source as HTMLInputElement;
      const cloneInput = clone as HTMLInputElement;
      cloneInput.checked = sourceInput.checked;
      cloneInput.indeterminate = sourceInput.indeterminate;
      if (sourceInput.type !== "file") cloneInput.value = sourceInput.value;
      break;
    }
    case "TEXTAREA":
      (clone as HTMLTextAreaElement).value = (
        source as HTMLTextAreaElement
      ).value;
      break;
    case "SELECT":
      (clone as HTMLSelectElement).selectedIndex = (
        source as HTMLSelectElement
      ).selectedIndex;
      break;
    case "OPTION":
      (clone as HTMLOptionElement).selected = (
        source as HTMLOptionElement
      ).selected;
      break;
    case "CANVAS":
      try {
        (clone as HTMLCanvasElement)
          .getContext("2d")
          ?.drawImage(source as HTMLCanvasElement, 0, 0);
      } catch {
        // Some canvas implementations cannot expose their current bitmap.
      }
      break;
  }
}

export function captureNavigationVisualSnapshot(
  target: HTMLElement,
): NavigationVisualSnapshot {
  const snapshotNodes = [...target.childNodes].map(createSnapshotNode);
  const targetScrollLeft = target.scrollLeft;
  const targetScrollTop = target.scrollTop;
  let removed = false;
  let restored = false;
  return Object.freeze({
    remove: (): boolean => {
      if (removed) return false;

      removed = true;
      for (const node of snapshotNodes) {
        if (node.parentNode === target) target.removeChild(node);
      }
      target.removeAttribute(NAVIGATION_SNAPSHOT_ATTRIBUTE);
      return restored;
    },
    restore: (): boolean => {
      if (removed || restored || !target.isConnected) return false;

      restored = true;
      target.replaceChildren(...snapshotNodes);
      target.scrollLeft = targetScrollLeft;
      target.scrollTop = targetScrollTop;
      target.setAttribute("inert", "");
      target.setAttribute(NAVIGATION_SNAPSHOT_ATTRIBUTE, "");
      return true;
    },
  });
}

class NavigationCoordinator {
  readonly #claims = new Map<number, NavigationClaim>();
  #currentGeneration: NavigationGeneration | null = null;
  #disposed = false;
  readonly #generations = new Map<number, NavigationGeneration>();
  #generationId = 0;
  #claimId = 0;
  #observer: MutationObserver | null = null;
  readonly #onDispose: () => void;
  #owners = 0;
  readonly #window: BrowserWindow;

  constructor(ownerWindow: BrowserWindow, onDispose: () => void) {
    this.#window = ownerWindow;
    this.#onDispose = onDispose;
    this.#window.addEventListener(
      BEFORE_NAVIGATE_EVENT,
      this.#handleBeforeNavigate,
    );
    this.#window.addEventListener(
      PAGE_LOADING_START_EVENT,
      this.#handlePageLoadingStart,
    );
    this.#window.addEventListener(
      PAGE_LOADING_STOP_EVENT,
      this.#handlePageLoadingStop,
    );
  }

  acquire(): NavigationDestroyLease {
    if (this.#disposed) return NOOP_NAVIGATION_LEASE;

    this.#owners += 1;
    let released = false;
    return Object.freeze({
      release: (): boolean => {
        if (released) return false;

        released = true;
        this.#releaseOwner();
        return true;
      },
      reserve: (element: HTMLElement): NavigationUnmountReservation | null => {
        if (released) return null;
        return this.#reserve(element);
      },
    });
  }

  readonly #handleBeforeNavigate = (event: Event): void => {
    const detail = readEventDetail(event);
    if (detail?.patch !== false) return;

    const generation = this.#beginGeneration(
      "pending",
      this.#navigationKey(detail.href),
    );
    queueMicrotask(() => {
      if (
        event.defaultPrevented &&
        generation.kind === "pending" &&
        generation.claims.size === 0
      ) {
        this.#completeGeneration(generation);
      }
    });
  };

  readonly #handlePageLoadingStart = (event: Event): void => {
    const detail = readEventDetail(event);
    if (detail?.kind !== REDIRECT_KIND) return;

    const key = this.#navigationKey(detail.to);
    const current = this.#currentGeneration;
    if (
      current?.acceptingClaims === true &&
      current.kind === "pending" &&
      (current.key === null || key === null || current.key === key)
    ) {
      current.kind = "redirect";
      current.key = key ?? current.key;
      return;
    }

    this.#beginGeneration("redirect", key);
  };

  readonly #handlePageLoadingStop = (event: Event): void => {
    const detail = readEventDetail(event);
    if (detail?.kind !== REDIRECT_KIND) return;

    const key = this.#navigationKey(detail.to);
    if (key === null) return;

    const matches = [...this.#generations.values()].filter(
      (generation) => generation.kind === "redirect" && generation.key === key,
    );
    for (const generation of matches) {
      this.#completeGeneration(generation);
    }
  };

  #beginGeneration(
    kind: NavigationGeneration["kind"],
    key: string | null,
  ): NavigationGeneration {
    const previous = this.#currentGeneration;
    if (previous) {
      previous.acceptingClaims = false;
      if (previous.claims.size === 0) this.#completeGeneration(previous);
    }

    const id = ++this.#generationId;
    const generation: NavigationGeneration = {
      acceptingClaims: true,
      claims: new Set<number>(),
      id,
      key,
      kind,
      timeoutId: this.#window.setTimeout(
        () => this.#completeGeneration(generation),
        NAVIGATION_UNMOUNT_TIMEOUT_MS,
      ),
    };
    this.#generations.set(id, generation);
    this.#currentGeneration = generation;
    return generation;
  }

  #completeGeneration(generation: NavigationGeneration): void {
    if (!this.#generations.delete(generation.id)) return;

    generation.acceptingClaims = false;
    this.#window.clearTimeout(generation.timeoutId);
    if (this.#currentGeneration === generation) {
      this.#currentGeneration = null;
    }

    for (const claimId of [...generation.claims]) {
      this.#finishClaim(claimId);
    }
    this.#maybeDispose();
  }

  #reserve(element: HTMLElement): NavigationUnmountReservation | null {
    const generation = this.#currentGeneration;
    if (
      !generation?.acceptingClaims ||
      !element.isConnected ||
      !element.closest(MAIN_LIVE_VIEW_SELECTOR)
    ) {
      return null;
    }

    let settled = false;
    return Object.freeze({
      cancel: (): boolean => {
        if (settled) return false;

        settled = true;
        return true;
      },
      commit: (finalize: () => boolean): boolean => {
        if (settled) return false;

        settled = true;
        if (
          !generation.acceptingClaims ||
          !this.#generations.has(generation.id)
        ) {
          return false;
        }

        this.#addClaim(generation, element, finalize);
        return true;
      },
    });
  }

  #addClaim(
    generation: NavigationGeneration,
    element: HTMLElement,
    finalize: () => boolean,
  ): void {
    const id = ++this.#claimId;
    const claim: NavigationClaim = { element, finalize, generation, id };
    this.#claims.set(id, claim);
    generation.claims.add(id);
    element.setAttribute("inert", "");
    this.#ensureObserver(element.ownerDocument);

    if (!element.isConnected) this.#finishClaim(id);
  }

  #ensureObserver(ownerDocument: Document): void {
    if (this.#observer || typeof this.#window.MutationObserver !== "function") {
      return;
    }

    const root = ownerDocument.documentElement;
    if (!root) return;

    const observer = new this.#window.MutationObserver(() => {
      for (const claim of [...this.#claims.values()]) {
        if (!claim.element.isConnected) this.#finishClaim(claim.id);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    this.#observer = observer;
  }

  #finishClaim(id: number): void {
    const claim = this.#claims.get(id);
    if (!claim) return;

    this.#claims.delete(id);
    claim.generation.claims.delete(id);
    if (this.#claims.size === 0) {
      this.#observer?.disconnect();
      this.#observer = null;
    }

    try {
      claim.finalize();
    } catch (error: unknown) {
      reportAsyncError(error);
    } finally {
      this.#maybeDispose();
    }
  }

  #releaseOwner(): void {
    this.#owners = Math.max(0, this.#owners - 1);
    this.#maybeDispose();
  }

  #maybeDispose(): void {
    if (this.#owners > 0 || this.#claims.size > 0 || this.#disposed) return;

    this.#disposed = true;
    this.#window.removeEventListener(
      BEFORE_NAVIGATE_EVENT,
      this.#handleBeforeNavigate,
    );
    this.#window.removeEventListener(
      PAGE_LOADING_START_EVENT,
      this.#handlePageLoadingStart,
    );
    this.#window.removeEventListener(
      PAGE_LOADING_STOP_EVENT,
      this.#handlePageLoadingStop,
    );
    this.#observer?.disconnect();
    this.#observer = null;
    for (const generation of this.#generations.values()) {
      this.#window.clearTimeout(generation.timeoutId);
    }
    this.#generations.clear();
    this.#currentGeneration = null;
    this.#onDispose();
  }

  #navigationKey(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0) return null;

    try {
      return new URL(value, this.#window.location.href).href;
    } catch {
      return value;
    }
  }
}

const coordinators = new WeakMap<Window, NavigationCoordinator>();

export function acquireNavigationDestroyLease(
  element: HTMLElement,
): NavigationDestroyLease {
  const ownerWindow = element.ownerDocument?.defaultView;
  if (!ownerWindow) return NOOP_NAVIGATION_LEASE;

  const existing = coordinators.get(ownerWindow);
  if (existing) return existing.acquire();

  let coordinator!: NavigationCoordinator;
  coordinator = new NavigationCoordinator(ownerWindow as BrowserWindow, () => {
    if (coordinators.get(ownerWindow) === coordinator) {
      coordinators.delete(ownerWindow);
    }
  });
  coordinators.set(ownerWindow, coordinator);
  return coordinator.acquire();
}
