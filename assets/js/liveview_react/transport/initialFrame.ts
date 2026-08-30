import type { ReactNode } from "react";

import { createSlotBindings } from "../runtime/slots";
import {
  assertComponentInputNamespaceSeparation,
  normalizeInitialFrame,
  type ComponentInputs,
  type InitialFrame,
} from "./initialFrameData";
import type { ComponentProps } from "../types";

export { normalizeInitialFrame } from "./initialFrameData";
export type { ComponentInputs, InitialFrame } from "./initialFrameData";

export interface MaterializedComponentInputs {
  readonly children: readonly ReactNode[];
  readonly events: ComponentInputs["events"];
  readonly props: ComponentProps;
}

export interface MaterializedInitialFrame extends InitialFrame {
  readonly children: readonly ReactNode[];
  readonly componentProps: ComponentProps;
}

export function materializeComponentInputs(
  inputs: ComponentInputs,
  source: string,
): MaterializedComponentInputs {
  assertComponentInputNamespaceSeparation(inputs, source);
  const ordinaryAndStreams = Object.freeze({
    ...inputs.props,
    ...inputs.streams,
  });
  const slotBindings = createSlotBindings(
    inputs.slots,
    ordinaryAndStreams,
    source,
  );

  return Object.freeze({
    children: slotBindings.children,
    events: inputs.events,
    props: Object.freeze({
      ...ordinaryAndStreams,
      ...slotBindings.props,
    }),
  });
}

export function materializeInitialFrame(
  value: unknown,
  source: string,
): MaterializedInitialFrame {
  const frame = normalizeInitialFrame(value, source);
  const materialized = materializeComponentInputs(frame, source);

  return Object.freeze({
    ...frame,
    children: materialized.children,
    componentProps: materialized.props,
  });
}
