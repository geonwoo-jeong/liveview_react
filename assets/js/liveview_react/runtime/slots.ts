import { createElement, type ReactNode } from "react";

import {
  isEmptySlotHtml,
  validateSlotBindings,
} from "../transport/slotValidation";
import type { ComponentProps, SlotMap } from "../types";

export { validateSlotBindings } from "../transport/slotValidation";

export interface SlotBindings {
  readonly children: readonly ReactNode[];
  readonly props: ComponentProps;
}

function createSlotNode(slotName: string, html: string): ReactNode {
  return createElement("div", {
    key: slotName,
    "data-liveview-react-slot": slotName,
    dangerouslySetInnerHTML: { __html: html },
  });
}

function createValidatedSlotChildren(slots: SlotMap): readonly ReactNode[] {
  const defaultSlot = slots.default;
  if (defaultSlot === undefined || isEmptySlotHtml(defaultSlot)) {
    return Object.freeze([]);
  }

  return Object.freeze([createSlotNode("default", defaultSlot)]);
}

function createValidatedNamedSlotProps(slots: SlotMap): ComponentProps {
  const namedSlots = Object.entries(slots).filter(
    ([slotName, html]) => slotName !== "default" && !isEmptySlotHtml(html),
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
