import type { ReactNode } from "react";

import {
  normalizeEventCommandMap,
  type EventCommandMap,
} from "../runtime/event-callbacks";
import { createSlotBindings } from "../runtime/slots";
import type { ComponentProps, SlotMap, StreamMap } from "../types";
import {
  dataPropertyMap,
  normalizeComponentProps,
  normalizeSlotMap,
} from "./jsonData";
import { TRANSPORT_VERSION } from "./protocol";
import { normalizeStreamMap } from "./streamData";

export interface InitialFrame {
  readonly version: typeof TRANSPORT_VERSION;
  readonly component: string;
  readonly identifierPrefix: string;
  readonly props: ComponentProps;
  readonly streams: StreamMap;
  readonly events: EventCommandMap;
  readonly slots: SlotMap;
}

export interface ComponentInputs {
  readonly props: ComponentProps;
  readonly streams: StreamMap;
  readonly events: EventCommandMap;
  readonly slots: SlotMap;
}

export interface MaterializedComponentInputs {
  readonly children: readonly ReactNode[];
  readonly events: EventCommandMap;
  readonly props: ComponentProps;
}

export interface MaterializedInitialFrame extends InitialFrame {
  readonly children: readonly ReactNode[];
  readonly componentProps: ComponentProps;
}

const INITIAL_FRAME_FIELDS = Object.freeze([
  "version",
  "component",
  "identifierPrefix",
  "props",
  "streams",
  "events",
  "slots",
] as const);
const INITIAL_FRAME_FIELD_SET: ReadonlySet<string> = new Set(
  INITIAL_FRAME_FIELDS,
);

function slotPropName(slotName: string): string {
  return slotName === "default" ? "children" : slotName;
}

function assertPairwiseNamespaceSeparation(
  { events, props, slots, streams }: ComponentInputs,
  source: string,
): void {
  const owners = new Map<string, string>();
  const namespaces = [
    ["ordinary prop", Object.keys(props)],
    ["stream prop", Object.keys(streams)],
    ["event callback", Object.keys(events)],
    ["slot prop", Object.keys(slots).map(slotPropName)],
  ] as const;

  for (const [owner, names] of namespaces) {
    for (const name of names) {
      const previousOwner = owners.get(name);
      if (previousOwner) {
        throw new TypeError(
          `${source} cannot define prop ${JSON.stringify(name)} as both ${previousOwner} and ${owner}`,
        );
      }
      owners.set(name, owner);
    }
  }
}

export function materializeComponentInputs(
  inputs: ComponentInputs,
  source: string,
): MaterializedComponentInputs {
  assertPairwiseNamespaceSeparation(inputs, source);
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

export function normalizeInitialFrame(
  value: unknown,
  source: string,
): InitialFrame {
  const fields = dataPropertyMap(value, source);
  const unknownField = [...fields.keys()].find(
    (key) => !INITIAL_FRAME_FIELD_SET.has(key),
  );
  if (unknownField) {
    throw new TypeError(
      `Unknown ${source} field ${JSON.stringify(unknownField)}`,
    );
  }
  const missingField = INITIAL_FRAME_FIELDS.find((key) => !fields.has(key));
  if (missingField) {
    throw new TypeError(
      `${source} requires field ${JSON.stringify(missingField)}`,
    );
  }

  const version = fields.get("version");
  if (version !== TRANSPORT_VERSION) {
    throw new TypeError(
      `${source} version must be ${TRANSPORT_VERSION}, received ${JSON.stringify(version)}`,
    );
  }
  const component = fields.get("component");
  if (typeof component !== "string" || component.length === 0) {
    throw new TypeError(`${source} component must be a non-empty string`);
  }
  const identifierPrefix = fields.get("identifierPrefix");
  if (typeof identifierPrefix !== "string" || identifierPrefix.length === 0) {
    throw new TypeError(
      `${source} identifierPrefix must be a non-empty string`,
    );
  }

  return Object.freeze({
    version,
    component,
    identifierPrefix,
    props: normalizeComponentProps(fields.get("props"), `${source} props`),
    streams: normalizeStreamMap(fields.get("streams"), `${source} streams`),
    events: normalizeEventCommandMap(fields.get("events"), `${source} events`),
    slots: normalizeSlotMap(fields.get("slots"), `${source} slots`),
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
