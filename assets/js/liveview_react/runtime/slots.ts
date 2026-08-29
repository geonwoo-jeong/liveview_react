import { createElement, type ReactNode } from "react";

import type { ComponentProps, SlotMap } from "../types";

export interface SlotBindings {
  readonly children: readonly ReactNode[];
  readonly props: ComponentProps;
}

const SLOT_NAME = /^[a-z][A-Za-z0-9_]*$/;
const UNSUPPORTED_SLOT_HTML: readonly (readonly [RegExp, string])[] =
  Object.freeze([
    [/<form(?:\s|\/?>)/i, "forms"],
    [/<[^>]+\sphx-hook\s*=/i, "Phoenix hooks"],
    [
      /<[^>]+\s(?:phx-[A-Za-z0-9_:-]+|data-phx-[A-Za-z0-9_:-]+)\s*=/i,
      "Phoenix-managed bindings",
    ],
    [
      /<[^>]+\s(?:data-react-target|data-liveview-react-version)(?:\s|=|>)/i,
      "nested React roots",
    ],
  ]);

function assertSlotName(slotName: string, source: string): void {
  if (slotName === "default") return;
  if (slotName === "children") {
    throw new TypeError(
      `${source} reserves slot "children" for the default slot`,
    );
  }
  if (!SLOT_NAME.test(slotName)) {
    throw new TypeError(
      `${source} slot "${slotName}" must use lower camelCase or snake_case`,
    );
  }
}

function assertInertSlotHtml(
  slotName: string,
  html: string,
  source: string,
): void {
  const unsupported = UNSUPPORTED_SLOT_HTML.find(([pattern]) =>
    pattern.test(html),
  );
  if (unsupported) {
    throw new TypeError(
      `${source} slot "${slotName}" contains unsupported ${unsupported[1]}`,
    );
  }
}

function validateSlots(slots: SlotMap, source: string): void {
  for (const [slotName, html] of Object.entries(slots)) {
    assertSlotName(slotName, source);
    assertInertSlotHtml(slotName, html, source);
  }
}

function createSlotNode(slotName: string, html: string): ReactNode {
  return createElement("div", {
    key: slotName,
    "data-liveview-react-slot": slotName,
    dangerouslySetInnerHTML: { __html: html.trim() },
  });
}

function propNameForSlot(slotName: string): string {
  return slotName === "default" ? "children" : slotName;
}

function createValidatedSlotChildren(slots: SlotMap): readonly ReactNode[] {
  const defaultSlot = slots.default;
  if (!defaultSlot) return Object.freeze([]);

  return Object.freeze([createSlotNode("default", defaultSlot)]);
}

function createValidatedNamedSlotProps(slots: SlotMap): ComponentProps {
  const namedSlots = Object.entries(slots).filter(
    ([slotName]) => slotName !== "default",
  );

  if (namedSlots.length === 0) return Object.freeze({});

  return Object.freeze(
    Object.fromEntries(
      namedSlots.map(([slotName, slotHtml]) => [
        slotName,
        createSlotNode(slotName, slotHtml),
      ]),
    ),
  );
}

function assertNoSlotPropCollisions(
  props: ComponentProps,
  slots: SlotMap,
  source: string,
): void {
  validateSlots(slots, source);

  for (const slotName of Object.keys(slots)) {
    const propName = propNameForSlot(slotName);
    if (Object.hasOwn(props, propName)) {
      throw new TypeError(
        `${source} cannot define both prop "${propName}" and slot "${slotName}"`,
      );
    }
  }
}

export function validateSlotBindings(
  slots: SlotMap,
  props: ComponentProps,
  source: string,
): void {
  assertNoSlotPropCollisions(props, slots, source);
}

export function createSlotBindings(
  slots: SlotMap,
  props: ComponentProps,
  source: string,
): SlotBindings {
  validateSlotBindings(slots, props, source);

  return Object.freeze({
    children: createValidatedSlotChildren(slots),
    props: createValidatedNamedSlotProps(slots),
  });
}
