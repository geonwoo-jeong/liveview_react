import type { ReactNode } from "react";

import {
  decodeCompactJson,
  decodeCompactPatch,
} from "../transport/compactPatch";
import { applyPatch } from "../transport/jsonPatch";
import { applyStreamPatch } from "../transport/streamPatch";
import {
  assertTransportVersion,
  readPropsTransportKind,
  readStreamsTransportKind,
} from "../transport/protocol";
import { materializeInitialFrame } from "../transport/initialFrame";
import {
  normalizeComponentProps,
  normalizeSlotMap,
} from "../transport/jsonData";
import type { ComponentProps, SlotMap, StreamMap } from "../types";
import {
  normalizeEventCommandMap,
  type EventCommandMap,
} from "./event-callbacks";
import { createIdentifierPrefix } from "./identifier-prefix";

export interface HydrationSnapshot {
  readonly children: readonly ReactNode[];
  readonly events: EventCommandMap;
  readonly props: ComponentProps;
}

export interface HydrationFrame {
  readonly props: ComponentProps;
  readonly snapshot: HydrationSnapshot;
  readonly streams: StreamMap;
}

function readSnapshot(element: HTMLElement): ComponentProps {
  const data = element.getAttribute("data-props");
  if (data === null) {
    throw new Error('Snapshot transport requires a "data-props" attribute');
  }

  return normalizeComponentProps(decodeCompactJson(data), "data-props");
}

export function readComponentName(element: HTMLElement): string {
  const componentName = element.getAttribute("data-component");
  if (!componentName) {
    throw new Error("data-component must name a registered component");
  }

  return componentName;
}

export function readElementId(element: HTMLElement): string {
  if (!element.id) {
    throw new Error("LiveViewReactHook requires a non-empty element id");
  }

  return element.id;
}

export function readInitialProps(element: HTMLElement): ComponentProps {
  assertTransportVersion(element);

  if (readPropsTransportKind(element) !== "snapshot") {
    throw new Error('Initial data-props-kind must be "snapshot"');
  }

  return readSnapshot(element);
}

export function readEvents(element: HTMLElement): EventCommandMap {
  const encodedEvents = element.getAttribute("data-events");
  if (encodedEvents === null) {
    throw new Error('LiveViewReactHook requires a "data-events" attribute');
  }

  let events: unknown;
  try {
    events = JSON.parse(encodedEvents);
  } catch (error: unknown) {
    throw new TypeError("data-events must contain valid JSON", {
      cause: error,
    });
  }

  return normalizeEventCommandMap(events, "data-events");
}

export function readNextProps(
  element: HTMLElement,
  currentProps: ComponentProps,
): ComponentProps {
  assertTransportVersion(element);

  if (readPropsTransportKind(element) === "snapshot") {
    return readSnapshot(element);
  }

  return normalizeComponentProps(
    applyPatch(
      currentProps,
      decodeCompactPatch(element.getAttribute("data-props-diff")),
    ),
    "data-props-diff result",
  );
}

export function readNextStreams(
  element: HTMLElement,
  currentStreams: StreamMap,
): StreamMap {
  assertTransportVersion(element);

  const kind = readStreamsTransportKind(element);
  if (kind === "hydration") {
    throw new Error(
      'data-streams-kind="hydration" is only valid for the initial hydration frame',
    );
  }
  return applyStreamPatch(
    currentStreams,
    decodeCompactPatch(element.getAttribute("data-streams-diff")),
    kind === "snapshot" ? "snapshot" : "incremental",
  );
}

export function readInitialStreams(
  element: HTMLElement,
  hydrationStreams: StreamMap | null,
): StreamMap {
  assertTransportVersion(element);

  const kind = readStreamsTransportKind(element);
  if (kind === "hydration") {
    const payload = element.getAttribute("data-streams-diff");
    if (payload !== null && payload !== "") {
      throw new Error(
        'data-streams-kind="hydration" must omit data-streams-diff payload',
      );
    }
    if (hydrationStreams === null) {
      throw new Error(
        'data-streams-kind="hydration" requires data-react-hydration',
      );
    }
    return hydrationStreams;
  }
  if (kind !== "snapshot") {
    throw new Error(
      'Initial data-streams-kind must be "hydration" or "snapshot"',
    );
  }

  return applyStreamPatch(
    hydrationStreams ?? Object.freeze({}),
    decodeCompactPatch(element.getAttribute("data-streams-diff")),
    "snapshot",
  );
}

function readSlotMap(element: HTMLElement): SlotMap {
  const encodedSlots = element.getAttribute("data-slots");
  if (encodedSlots === null) {
    throw new Error('LiveViewReactHook requires a "data-slots" attribute');
  }

  let slots: unknown;
  try {
    slots = JSON.parse(encodedSlots);
  } catch (error: unknown) {
    throw new TypeError("data-slots must contain valid JSON", { cause: error });
  }

  return normalizeSlotMap(slots, "data-slots");
}

function decodeSlotMap(slots: SlotMap, source: string): SlotMap {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(slots).map(([slotName, slot]) => {
        try {
          const binary = atob(slot);
          const bytes = Uint8Array.from(binary, (character) =>
            character.charCodeAt(0),
          );
          const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          return [slotName, html];
        } catch (error: unknown) {
          throw new TypeError(
            `Slot "${slotName}" in ${source} must be valid base64-encoded UTF-8`,
            { cause: error },
          );
        }
      }),
    ),
  );
}

export function readDecodedSlots(element: HTMLElement): SlotMap {
  return decodeSlotMap(readSlotMap(element), "data-slots");
}

export function readHydrationSnapshot(
  target: HTMLElement,
  expectedComponentName: string,
  expectedRootId: string,
): HydrationFrame | null {
  const rawDescriptor = target.getAttribute("data-react-hydration");
  if (rawDescriptor === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(rawDescriptor);
  } catch (error: unknown) {
    throw new TypeError("data-react-hydration must contain valid JSON", {
      cause: error,
    });
  }

  const frame = materializeInitialFrame(value, "data-react-hydration");
  if (frame.component !== expectedComponentName) {
    throw new Error(
      `Hydration component must match data-component "${expectedComponentName}"`,
    );
  }
  if (frame.identifierPrefix !== createIdentifierPrefix(expectedRootId)) {
    throw new Error(
      `Hydration identifierPrefix must match the root id "${expectedRootId}"`,
    );
  }
  return Object.freeze({
    props: frame.props,
    snapshot: Object.freeze({
      children: frame.children,
      events: frame.events,
      props: frame.componentProps,
    }),
    streams: frame.streams,
  });
}

export function findReactTarget(element: HTMLElement): HTMLElement {
  const targets = Array.from(
    element.querySelectorAll(":scope > [data-react-target]"),
  );
  const target = targets[0];
  if (targets.length !== 1 || !(target instanceof HTMLElement)) {
    throw new Error(
      "LiveViewReactHook requires exactly one direct [data-react-target] child element",
    );
  }

  return target;
}
