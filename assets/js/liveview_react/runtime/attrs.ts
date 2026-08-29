import { createElement, type ReactNode } from "react";

import { decodeCompactJson, decodeCompactPatch } from "../compactPatch";
import { applyPatch } from "../jsonPatch";
import type { ComponentProps, SlotMap } from "../types";

export type TransportKind = "patch" | "snapshot";

export interface HydrationSnapshot {
  readonly children: readonly ReactNode[];
  readonly props: ComponentProps;
}

const HYDRATION_FIELDS: readonly string[] = Object.freeze([
  "component",
  "props",
  "slots",
  "version",
]);

function isProps(value: unknown): value is ComponentProps {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonAttribute(
  element: HTMLElement,
  attributeName: string,
): unknown {
  const data = element.getAttribute(attributeName);
  return data ? JSON.parse(data) : {};
}

function readTransportKind(
  element: HTMLElement,
  attributeName: "data-props-kind" | "data-streams-kind",
): TransportKind {
  const kind = element.getAttribute(attributeName);
  if (kind === "patch" || kind === "snapshot") return kind;

  throw new Error(`${attributeName} must be either "snapshot" or "patch"`);
}

function readSnapshot(element: HTMLElement): ComponentProps {
  const data = element.getAttribute("data-props");
  if (data === null) {
    throw new Error('Snapshot transport requires a "data-props" attribute');
  }

  const value = decodeCompactJson(data);

  if (!isProps(value)) {
    throw new TypeError("data-props must contain an encoded object");
  }

  return value;
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
  if (readTransportKind(element, "data-props-kind") !== "snapshot") {
    throw new Error('Initial data-props-kind must be "snapshot"');
  }

  return readSnapshot(element);
}

export function readNextProps(
  element: HTMLElement,
  currentProps: ComponentProps,
): ComponentProps {
  if (readTransportKind(element, "data-props-kind") === "snapshot") {
    return readSnapshot(element);
  }

  return applyPatch(
    { ...currentProps },
    decodeCompactPatch(element.getAttribute("data-props-diff")),
  );
}

export function readNextStreams(
  element: HTMLElement,
  currentStreams: ComponentProps,
): ComponentProps {
  const current =
    readTransportKind(element, "data-streams-kind") === "snapshot"
      ? {}
      : currentStreams;

  return applyPatch(
    { ...current },
    decodeCompactPatch(element.getAttribute("data-streams-diff")),
  );
}

export function readInitialStreams(element: HTMLElement): ComponentProps {
  if (readTransportKind(element, "data-streams-kind") !== "snapshot") {
    throw new Error('Initial data-streams-kind must be "snapshot"');
  }

  return applyPatch(
    {},
    decodeCompactPatch(element.getAttribute("data-streams-diff")),
  );
}

function readSlotMap(element: HTMLElement): SlotMap {
  return validateSlotMap(
    readJsonAttribute(element, "data-slots"),
    "data-slots",
  );
}

function validateSlotMap(value: unknown, source: string): SlotMap {
  if (!isProps(value)) {
    throw new TypeError(`${source} must contain a JSON object`);
  }

  for (const [slotName, slot] of Object.entries(value)) {
    if (typeof slot !== "string") {
      throw new TypeError(`Slot "${slotName}" in ${source} must be a string`);
    }
  }

  return value as SlotMap;
}

function createChildren(defaultSlot: string | undefined): readonly ReactNode[] {
  if (!defaultSlot) return Object.freeze([]);

  return Object.freeze([
    createElement("div", {
      dangerouslySetInnerHTML: { __html: defaultSlot.trim() },
    }),
  ]);
}

export function readChildren(element: HTMLElement): readonly ReactNode[] {
  const defaultSlot = readSlotMap(element).default;
  return createChildren(defaultSlot ? atob(defaultSlot) : undefined);
}

export function readHydrationSnapshot(
  target: HTMLElement,
  expectedComponentName: string,
): HydrationSnapshot | null {
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

  if (!isProps(value)) {
    throw new TypeError("data-react-hydration must contain a JSON object");
  }

  const unknownKey = Object.keys(value).find(
    (key) => !HYDRATION_FIELDS.includes(key),
  );
  if (unknownKey) {
    throw new TypeError(`Unknown data-react-hydration field "${unknownKey}"`);
  }
  if (value.version !== 1) {
    throw new TypeError("data-react-hydration version must be 1");
  }
  if (
    typeof value.component !== "string" ||
    value.component !== expectedComponentName
  ) {
    throw new Error(
      `Hydration component must match data-component "${expectedComponentName}"`,
    );
  }
  if (!isProps(value.props)) {
    throw new TypeError("data-react-hydration props must be an object");
  }

  const slots = validateSlotMap(value.slots, "data-react-hydration slots");
  return Object.freeze({
    children: createChildren(slots.default),
    props: Object.freeze({ ...value.props }),
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
