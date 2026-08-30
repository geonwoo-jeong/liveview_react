import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { act, useEffect } from "react";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { bench, describe } from "vitest";

import { loadComponent } from "./registry";
import { RootController, type RootRenderSnapshot } from "./runtime/root";
import {
  decodeCompactPatch,
  type PatchOperation,
} from "./transport/compactPatch";
import { applyPatch } from "./transport/jsonPatch";
import type { LiveViewReactContextValue } from "./types";

const OPERATION_COUNT = 10_000;
const FORM_SECTION_COUNT = 50;
const FORM_FIELDS_PER_SECTION = 20;
const NAVIGATION_TRANSITION_COUNT = 100;

const initialDocument = Object.freeze({
  items: Object.freeze(
    Array.from({ length: OPERATION_COUNT }, (_, index) =>
      Object.freeze({ value: index }),
    ),
  ),
});

const compactPayload = Array.from({ length: OPERATION_COUNT }, (_, index) => {
  const path = `/items/${index}/value`;
  const value = String(index + 1);
  return `r${path.length}:${path}n${value.length}:${value}`;
}).join("");

const decodedOperations = decodeCompactPatch(compactPayload);

const largeFormInitial = createLargeForm("unchanged");
const largeFormChanged = createLargeForm("changed-by-server");
const formPatchPath = "/form/sections/25/fields/10/value";
const formPatchValue = "changed-by-server";
const compactFormPayload = encodeStringReplace(formPatchPath, formPatchValue);
const decodedFormPatch = decodeCompactPatch(compactFormPayload);
const largeFormSnapshot = JSON.stringify(largeFormChanged);
const largeFormSnapshotBytes = Buffer.byteLength(largeFormSnapshot);
const compactFormPayloadBytes = Buffer.byteLength(compactFormPayload);
const matchingServerMarkup = renderToString(<PerformanceProbe value={42} />);
const requireLazySplitArtifacts =
  process.env.LIVEVIEW_REACT_REQUIRE_LAZY_SPLIT === "true";
const lazyAssetDirectory = resolve(
  process.cwd(),
  "liveview_react_examples/priv/static/assets",
);
const lazyChunkPaths = Object.freeze({
  app: `${lazyAssetDirectory}/app.js`,
  entry: `${lazyAssetDirectory}/lazy.js`,
  leaf: `${lazyAssetDirectory}/lazy-component.js`,
});
const lazyChunkSizes = Object.values(lazyChunkPaths).every((path) =>
  existsSync(path),
)
  ? Object.freeze({
      app: statSync(lazyChunkPaths.app).size,
      entry: statSync(lazyChunkPaths.entry).size,
      leaf: statSync(lazyChunkPaths.leaf).size,
    })
  : null;

const emptyStreamDocument: StreamDocument = Object.freeze({
  rows: Object.freeze([]),
});
const populatedStreamDocument: StreamDocument = Object.freeze({
  rows: Object.freeze(
    Array.from({ length: OPERATION_COUNT }, (_, index) =>
      Object.freeze({
        __dom_id: `row-${index}`,
        label: `row-${index}`,
        version: 1,
      }),
    ),
  ),
});
const streamInsertOperations = createStreamOperations("insert");
const streamUpdateOperations = createStreamOperations("update");
const streamDeleteOperations = createStreamOperations("delete");

interface ControllerOptions {
  readonly hydrate?: boolean;
  readonly hydrationSnapshot?: RootRenderSnapshot;
  readonly id: string;
}

interface StreamDocument {
  readonly rows: readonly StreamRow[];
}

interface StreamRow {
  readonly __dom_id: string;
  readonly label: string;
  readonly version: number;
}

interface NavigationAudit {
  readonly cleanupCount: number;
  readonly finalText: string | null;
  readonly renderCount: number;
  readonly setupCount: number;
}

type ReactTestEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function assertInvariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Benchmark invariant failed: ${message}`);
}

function setReactActEnvironment(value: boolean): () => void {
  const reactEnvironment = globalThis as ReactTestEnvironment;
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    reactEnvironment,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = value;

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(
        reactEnvironment,
        "IS_REACT_ACT_ENVIRONMENT",
        previousDescriptor,
      );
    } else {
      delete reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
    }
  };
}

function createLargeForm(targetValue: string) {
  return Object.freeze({
    form: Object.freeze({
      sections: Object.freeze(
        Array.from({ length: FORM_SECTION_COUNT }, (_, sectionIndex) =>
          Object.freeze({
            fields: Object.freeze(
              Array.from({ length: FORM_FIELDS_PER_SECTION }, (_, fieldIndex) =>
                Object.freeze({
                  errors: Object.freeze([]),
                  id: `section-${sectionIndex}-field-${fieldIndex}`,
                  touched: fieldIndex % 3 === 0,
                  value:
                    sectionIndex === 25 && fieldIndex === 10
                      ? targetValue
                      : `value-${sectionIndex}-${fieldIndex}`,
                }),
              ),
            ),
            id: `section-${sectionIndex}`,
          }),
        ),
      ),
      submitCount: 0,
    }),
  });
}

function encodeStringReplace(path: string, value: string): string {
  return `r${path.length}:${path}s${value.length}:${value}`;
}

function createStreamOperations(
  kind: "delete" | "insert" | "update",
): readonly PatchOperation[] {
  return Object.freeze(
    Array.from({ length: OPERATION_COUNT }, (_, index) => {
      const domId = `row-${index}`;

      if (kind === "delete") {
        return Object.freeze({
          op: "remove" as const,
          path: `/rows/$$${domId}`,
        });
      }

      const value = Object.freeze({
        __dom_id: domId,
        label: `${kind}-${index}`,
        version: kind === "update" ? 2 : 1,
      });

      return Object.freeze({
        op: kind === "update" ? ("replace" as const) : ("upsert" as const),
        path: kind === "update" ? `/rows/$$${domId}` : "/rows/-",
        value,
      });
    }),
  );
}

function snapshot(value: number): RootRenderSnapshot {
  return Object.freeze({
    children: Object.freeze([]),
    events: Object.freeze({}),
    props: Object.freeze({ value }),
  });
}

function createContext(element: HTMLElement): LiveViewReactContextValue {
  return Object.freeze({
    el: element,
    liveSocket: null,
    pushEvent: (() =>
      Promise.resolve(undefined)) as LiveViewReactContextValue["pushEvent"],
    pushEventTo: (() =>
      Promise.resolve([])) as LiveViewReactContextValue["pushEventTo"],
    handleEvent: (() =>
      "performance-handler") as LiveViewReactContextValue["handleEvent"],
    removeHandleEvent: (() =>
      undefined) as LiveViewReactContextValue["removeHandleEvent"],
    upload: (() => undefined) as LiveViewReactContextValue["upload"],
    uploadTo: (() => undefined) as LiveViewReactContextValue["uploadTo"],
  });
}

function createController(
  target: HTMLElement,
  initial: RootRenderSnapshot,
  options: ControllerOptions,
) {
  const element = document.createElement("div");
  element.id = options.id;
  element.append(target);

  return new RootController({
    componentName: "PerformanceProbe",
    context: createContext(element),
    element,
    executeEventCommands: () => undefined,
    hydrate: options.hydrate === true,
    ...(options.hydrationSnapshot
      ? { hydrationSnapshot: options.hydrationSnapshot }
      : {}),
    initialSnapshot: initial,
    target,
  });
}

function PerformanceProbe({ value }: { readonly value: number }) {
  return <output>{value}</output>;
}

function exerciseNavigationTransitions(replaceRoot: boolean): NavigationAudit {
  let cleanupCount = 0;
  let renderCount = 0;
  let setupCount = 0;
  let finalText: string | null = null;

  function NavigationProbe({ value }: { readonly value: number }) {
    renderCount += 1;
    useEffect(() => {
      setupCount += 1;
      return () => {
        cleanupCount += 1;
      };
    }, []);
    return <output>{value}</output>;
  }

  if (replaceRoot) {
    for (
      let transition = 1;
      transition <= NAVIGATION_TRANSITION_COUNT;
      transition += 1
    ) {
      const target = document.createElement("div");
      const controller = createController(target, snapshot(transition), {
        id: `navigation-replacement-${transition}`,
      });
      flushSync(() => controller.mount(NavigationProbe));
      finalText = target.textContent;
      flushSync(() => controller.destroy());
    }
  } else {
    const target = document.createElement("div");
    const controller = createController(target, snapshot(0), {
      id: "navigation-preserved",
    });
    flushSync(() => controller.mount(NavigationProbe));

    for (
      let transition = 1;
      transition <= NAVIGATION_TRANSITION_COUNT;
      transition += 1
    ) {
      flushSync(() => controller.update(snapshot(transition)));
    }

    finalText = target.textContent;
    flushSync(() => controller.destroy());
  }

  return Object.freeze({ cleanupCount, finalText, renderCount, setupCount });
}

async function exerciseHydration(serverMarkup: string): Promise<{
  readonly elapsedMilliseconds: number;
  readonly text: string | null;
}> {
  const hydrationSnapshot = snapshot(42);
  const target = document.createElement("div");
  target.innerHTML = serverMarkup;
  const controller = createController(target, hydrationSnapshot, {
    hydrate: true,
    hydrationSnapshot,
    id: "performance-hydration-root",
  });
  const restoreActEnvironment = setReactActEnvironment(true);
  const startedAt = performance.now();

  try {
    await act(async () => {
      controller.mount(PerformanceProbe);
    });

    const result = Object.freeze({
      elapsedMilliseconds: performance.now() - startedAt,
      text: target.textContent,
    });
    assertInvariant(
      result.text === "42",
      "hydration must preserve server text",
    );
    assertInvariant(
      Number.isFinite(result.elapsedMilliseconds),
      "hydration timing must be finite",
    );
    return result;
  } finally {
    try {
      if (!controller.destroyed) {
        await act(async () => {
          controller.destroy();
        });
      }
    } finally {
      restoreActEnvironment();
    }
  }
}

function inspectLazyChunks(): void {
  if (!lazyChunkSizes) {
    if (requireLazySplitArtifacts) {
      throw new Error(
        "Production lazy split artifacts are required but missing; build the example assets before benchmarking",
      );
    }

    return;
  }

  const appSource = readFileSync(lazyChunkPaths.app, "utf8");
  const entrySource = readFileSync(lazyChunkPaths.entry, "utf8");
  assertInvariant(
    /import\(\s*[`'"]\.\/lazy\.js[`'"]\s*\)/.test(appSource),
    "the production app must dynamically import lazy.js",
  );
  assertInvariant(
    /import\(\s*[`'"]\.\/lazy-component\.js[`'"]\s*\)/.test(entrySource),
    "lazy.js must dynamically import lazy-component.js",
  );
  assertInvariant(
    Object.values(lazyChunkSizes).every((size) => size > 0),
    "production lazy split chunks must not be empty",
  );
}

function collectNavigationAudits() {
  const restoreActEnvironment = setReactActEnvironment(false);

  try {
    return Object.freeze({
      preserved: exerciseNavigationTransitions(false),
      replacement: exerciseNavigationTransitions(true),
    });
  } finally {
    restoreActEnvironment();
  }
}

function assertNavigationAudit(
  audit: NavigationAudit,
  expected: NavigationAudit,
  label: string,
): void {
  assertInvariant(
    audit.cleanupCount === expected.cleanupCount &&
      audit.finalText === expected.finalText &&
      audit.renderCount === expected.renderCount &&
      audit.setupCount === expected.setupCount,
    `${label} navigation lifecycle counts changed`,
  );
}

interface MountedRootFixture {
  readonly controller: RootController;
  readonly target: HTMLElement;
}

function createMountedRootFixture(): MountedRootFixture {
  const target = document.createElement("div");
  const controller = createController(target, snapshot(0), {
    id: "performance-update-root",
  });
  const restoreActEnvironment = setReactActEnvironment(false);

  try {
    flushSync(() => controller.mount(PerformanceProbe));
    flushSync(() => controller.update(snapshot(1)));
  } finally {
    restoreActEnvironment();
  }

  assertInvariant(controller.mounted, "update fixture must mount a React root");
  assertInvariant(
    target.textContent === "1",
    "update fixture must commit props",
  );
  return Object.freeze({ controller, target });
}

function destroyMountedRootFixture(fixture: MountedRootFixture): void {
  const restoreActEnvironment = setReactActEnvironment(false);

  try {
    flushSync(() => fixture.controller.destroy());
  } finally {
    restoreActEnvironment();
  }

  assertInvariant(!fixture.controller.mounted, "update fixture must unmount");
  assertInvariant(
    fixture.target.childNodes.length === 0,
    "update target must empty",
  );
}

const patchedForm = applyPatch(largeFormInitial, decodedFormPatch);
assertInvariant(
  patchedForm.form.sections[25]?.fields[10]?.value === formPatchValue,
  "the nested form field patch must apply",
);
assertInvariant(
  largeFormInitial.form.sections[25]?.fields[10]?.value === "unchanged",
  "form patch application must preserve the input snapshot",
);

assertInvariant(
  decodedOperations.length === OPERATION_COUNT,
  "the compact fixture must decode 10,000 operations",
);
assertInvariant(
  applyPatch(initialDocument, decodedOperations).items.at(-1)?.value ===
    OPERATION_COUNT,
  "the generic compact fixture must apply its final replacement",
);

const insertedStream = applyPatch(emptyStreamDocument, streamInsertOperations);
const updatedStream = applyPatch(
  populatedStreamDocument,
  streamUpdateOperations,
);
const deletedStream = applyPatch(
  populatedStreamDocument,
  streamDeleteOperations,
);
assertInvariant(
  insertedStream.rows.length === OPERATION_COUNT &&
    insertedStream.rows.at(-1)?.__dom_id === "row-9999",
  "10,000 stream inserts must preserve order and identity",
);
assertInvariant(
  updatedStream.rows.length === OPERATION_COUNT &&
    updatedStream.rows[5_000]?.version === 2,
  "10,000 id-addressed stream updates must preserve cardinality",
);
assertInvariant(
  deletedStream.rows.length === 0,
  "10,000 id-addressed stream deletes must remove every row",
);
assertInvariant(
  populatedStreamDocument.rows[5_000]?.version === 1,
  "stream patch application must preserve the input snapshot",
);

const navigationAudits = collectNavigationAudits();
assertNavigationAudit(
  navigationAudits.preserved,
  Object.freeze({
    cleanupCount: 1,
    finalText: String(NAVIGATION_TRANSITION_COUNT),
    renderCount: NAVIGATION_TRANSITION_COUNT + 1,
    setupCount: 1,
  }),
  "preserved-root",
);
assertNavigationAudit(
  navigationAudits.replacement,
  Object.freeze({
    cleanupCount: NAVIGATION_TRANSITION_COUNT,
    finalText: String(NAVIGATION_TRANSITION_COUNT),
    renderCount: NAVIGATION_TRANSITION_COUNT,
    setupCount: NAVIGATION_TRANSITION_COUNT,
  }),
  "replacement-root",
);

inspectLazyChunks();

describe(`large nested form transport (full=${largeFormSnapshotBytes} bytes, compact=${compactFormPayloadBytes} bytes)`, () => {
  bench("parse a 1,000-field full form snapshot", () => {
    JSON.parse(largeFormSnapshot);
  });

  bench("decode and apply one nested form field patch", () => {
    applyPatch(largeFormInitial, decodeCompactPatch(compactFormPayload));
  });
});

describe("generic 10,000-operation compact transport", () => {
  bench("decode 10,000 compact replace operations", () => {
    decodeCompactPatch(compactPayload);
  });

  bench("immutably apply 10,000 decoded operations", () => {
    applyPatch(initialDocument, decodedOperations);
  });
});

describe("10,000-item stream application", () => {
  bench("apply 10,000 stream inserts", () => {
    applyPatch(emptyStreamDocument, streamInsertOperations);
  });

  bench("apply 10,000 id-addressed stream updates", () => {
    applyPatch(populatedStreamDocument, streamUpdateOperations);
  });

  bench("apply 10,000 id-addressed stream deletes", () => {
    applyPatch(populatedStreamDocument, streamDeleteOperations);
  });
});

const navigationAuditDescription =
  `preserved setup=${navigationAudits.preserved.setupCount}/cleanup=${navigationAudits.preserved.cleanupCount}/renders=${navigationAudits.preserved.renderCount}; ` +
  `replacement setup=${navigationAudits.replacement.setupCount}/cleanup=${navigationAudits.replacement.cleanupCount}/renders=${navigationAudits.replacement.renderCount}`;

describe(`React root lifecycle (${navigationAuditDescription})`, () => {
  let updateFixture: MountedRootFixture | null = null;

  bench(
    "update an existing React root",
    () => {
      assertInvariant(updateFixture, "update benchmark fixture must exist");
      flushSync(() =>
        updateFixture?.controller.update(snapshot(performance.now())),
      );
    },
    {
      setup: () => {
        updateFixture = createMountedRootFixture();
      },
      teardown: () => {
        if (updateFixture) destroyMountedRootFixture(updateFixture);
        updateFixture = null;
      },
    },
  );

  bench("destroy and remount a React root", () => {
    const target = document.createElement("div");
    const controller = createController(target, snapshot(1), {
      id: "performance-remount-root",
    });
    flushSync(() => controller.mount(PerformanceProbe));
    flushSync(() => controller.destroy());
  });

  bench("preserve one root across 100 navigation-equivalent updates", () => {
    exerciseNavigationTransitions(false);
  });

  bench("replace roots across 100 navigation-equivalent transitions", () => {
    exerciseNavigationTransitions(true);
  });
});

describe("SSR and hydration", () => {
  bench("render matching React SSR markup", () => {
    renderToString(<PerformanceProbe value={42} />);
  });

  bench("prepare a target, hydrate through commit, and clean up", async () => {
    await exerciseHydration(matchingServerMarkup);
  });
});

const lazyChunkDescription = lazyChunkSizes
  ? `production split bytes: app=${lazyChunkSizes.app}, lazy=${lazyChunkSizes.entry}, lazy-component=${lazyChunkSizes.leaf}`
  : "production split artifacts unavailable; build example assets first";
const lazyEntry = Object.freeze({
  load: () => Promise.resolve(Object.freeze({ default: PerformanceProbe })),
});

describe(`lazy component loading (${lazyChunkDescription})`, () => {
  bench("resolve a tagged lazy registry entry", async () => {
    const Component = await loadComponent("PerformanceProbe", lazyEntry);
    assertInvariant(
      Component === PerformanceProbe,
      "lazy registry resolution must preserve component identity",
    );
  });
});
