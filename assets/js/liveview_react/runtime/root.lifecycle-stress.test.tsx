import { act, useEffect } from "react";
import { expect, it } from "vitest";

import type { LiveViewReactContextValue } from "../types";
import { RootController, type RootRenderSnapshot } from "./root";

const CYCLE_COUNT = 1_000;

interface LifecycleAudit {
  readonly activeRootIds: readonly number[];
  readonly cleanupCount: number;
  readonly setupCount: number;
}

interface CycleResult extends LifecycleAudit {
  readonly allControllersUnmounted: boolean;
  readonly allTargetsEmpty: boolean;
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
      "stress-handler") as LiveViewReactContextValue["handleEvent"],
    removeHandleEvent: (() =>
      undefined) as LiveViewReactContextValue["removeHandleEvent"],
    upload: (() => undefined) as LiveViewReactContextValue["upload"],
    uploadTo: (() => undefined) as LiveViewReactContextValue["uploadTo"],
  });
}

function snapshot(rootId: number): RootRenderSnapshot {
  return Object.freeze({
    children: Object.freeze([]),
    events: Object.freeze({}),
    props: Object.freeze({ rootId }),
  });
}

function createController(rootId: number) {
  const element = document.createElement("div");
  const target = document.createElement("div");
  element.id = `stress-root-${rootId}`;
  element.append(target);

  const controller = new RootController({
    componentName: "LifecycleProbe",
    context: createContext(element),
    element,
    executeEventCommands: () => undefined,
    hydrate: false,
    initialSnapshot: snapshot(rootId),
    target,
  });

  return Object.freeze({ controller, target });
}

async function exerciseLifecycle(): Promise<CycleResult> {
  let audit: LifecycleAudit = Object.freeze({
    activeRootIds: Object.freeze([]),
    cleanupCount: 0,
    setupCount: 0,
  });

  function recordSetup(rootId: number): void {
    if (audit.activeRootIds.includes(rootId)) {
      throw new Error(`root ${rootId} was mounted more than once`);
    }

    audit = Object.freeze({
      activeRootIds: Object.freeze([...audit.activeRootIds, rootId]),
      cleanupCount: audit.cleanupCount,
      setupCount: audit.setupCount + 1,
    });
  }

  function recordCleanup(rootId: number): void {
    if (!audit.activeRootIds.includes(rootId)) {
      throw new Error(`root ${rootId} was cleaned without an active mount`);
    }

    audit = Object.freeze({
      activeRootIds: Object.freeze(
        audit.activeRootIds.filter((activeRootId) => activeRootId !== rootId),
      ),
      cleanupCount: audit.cleanupCount + 1,
      setupCount: audit.setupCount,
    });
  }

  function LifecycleProbe({ rootId }: { readonly rootId: number }) {
    useEffect(() => {
      recordSetup(rootId);
      return () => recordCleanup(rootId);
    }, [rootId]);
    return null;
  }

  const cycles = Object.freeze(
    Array.from({ length: CYCLE_COUNT }, (_, rootId) =>
      createController(rootId),
    ),
  );

  await act(async () => {
    for (const { controller } of cycles) controller.mount(LifecycleProbe);
  });

  if (
    audit.setupCount !== CYCLE_COUNT ||
    audit.activeRootIds.length !== CYCLE_COUNT
  ) {
    throw new Error("not every stress root reached the mounted state");
  }

  await act(async () => {
    for (const { controller } of cycles) controller.destroy();
  });

  return Object.freeze({
    ...audit,
    allControllersUnmounted: cycles.every(
      ({ controller }) => !controller.mounted,
    ),
    allTargetsEmpty: cycles.every(
      ({ target }) => target.childNodes.length === 0,
    ),
  });
}

it(
  "cleans every effect and root across 1,000 mount/destroy cycles",
  { timeout: 30_000 },
  async () => {
    const reactEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
    const collectGarbage = (
      globalThis as typeof globalThis & { readonly gc?: () => void }
    ).gc;

    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      collectGarbage?.();
      const heapBefore = collectGarbage ? process.memoryUsage().heapUsed : null;
      const result = await exerciseLifecycle();
      collectGarbage?.();
      const measurement = Object.freeze({
        heapDeltaBytes:
          heapBefore === null
            ? null
            : process.memoryUsage().heapUsed - heapBefore,
        lifecycle: result,
      });

      expect(measurement.lifecycle).toEqual({
        activeRootIds: [],
        allControllersUnmounted: true,
        allTargetsEmpty: true,
        cleanupCount: CYCLE_COUNT,
        setupCount: CYCLE_COUNT,
      });
      if (measurement.heapDeltaBytes !== null) {
        expect(Number.isFinite(measurement.heapDeltaBytes)).toBe(true);
      }
    } finally {
      if (previousActEnvironment === undefined) {
        delete reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
      } else {
        reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  },
);
