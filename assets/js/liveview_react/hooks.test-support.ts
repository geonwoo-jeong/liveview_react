import { isValidElement, type ReactElement, type ReactNode } from "react";
import { expect, vi } from "vitest";

import { createIdentifierPrefix } from "./runtime/identifier-prefix";
import { createMockLiveViewHook } from "./tests/helpers";

export const renderMock = vi.fn();
export const rootMock = { render: renderMock, unmount: vi.fn() };

export const TestComponent = (_props: Record<string, unknown>) => null;

export type TestHook = ReturnType<typeof createMockLiveViewHook>;
export type LifecycleCallback = (...args: never[]) => unknown;

export function findElement(
  node: ReactNode,
  matches: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child as ReactNode, matches);
      if (match) return match;
    }

    return null;
  }

  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (matches(node)) return node;
  return findElement(node.props.children as ReactNode, matches);
}

export function findComponentProps(
  node: ReactNode,
): Record<string, unknown> | null {
  return (
    findElement(node, (element) => element.type === TestComponent)?.props ??
    null
  );
}

export function lastRenderedProps(
  render = renderMock,
): Record<string, unknown> {
  const lastRender = render.mock.calls.at(-1);
  if (!lastRender) throw new Error("Expected the React root to render");

  const props = findComponentProps(lastRender[0] as ReactNode);
  if (!props) throw new Error("Expected to find the test component");
  return props;
}

export function reactElementProps(
  value: unknown,
): Record<string, unknown> | null {
  return isValidElement<Record<string, unknown>>(value) ? value.props : null;
}

const OP_CODES = {
  add: "a",
  remove: "d",
  replace: "r",
  stream: "s",
} as const;

type TestPatchOperation = readonly [keyof typeof OP_CODES, string, unknown?];

type TestStreamItem = Readonly<Record<string, unknown>> & {
  readonly __dom_id: string;
};

interface TestStreamFrameOptions {
  readonly deletes?: readonly string[];
  readonly inserts?: readonly (readonly [
    domId: string,
    at: number,
    limit: number | null,
    updateOnly: boolean,
  ])[];
  readonly reset?: boolean;
}

export function streamFrame(
  items: readonly TestStreamItem[],
  options: TestStreamFrameOptions = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    items: Object.freeze([...items]),
    inserts: Object.freeze(
      options.inserts?.map((insert) => Object.freeze([...insert])) ??
        items.map((item) =>
          Object.freeze([item.__dom_id, -1, null, false] as const),
        ),
    ),
    deletes: Object.freeze([...(options.deletes ?? [])]),
    reset: options.reset ?? false,
  });
}

function encodeValue(value: unknown): string {
  if (value === null) return "z";
  if (value === true) return "b1";
  if (value === false) return "b0";
  if (typeof value === "number") {
    const encoded = String(value);
    return `n${encoded.length}:${encoded}`;
  }
  if (typeof value === "string") return `s${value.length}:${value}`;

  const json = JSON.stringify(value)
    .replace(/~/g, "~~")
    .replace(/\^/g, "~^")
    .replace(/"/g, "^");
  return `J${json.length}:${json}`;
}

export function encodePatch(operations: readonly TestPatchOperation[]): string {
  return operations
    .map(([operation, path, value]) => {
      const prefix = `${OP_CODES[operation]}${path.length}:${path}`;
      return operation === "remove" ? prefix : prefix + encodeValue(value);
    })
    .join("");
}

export function encodeProps(props: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(props)
    .replace(/~/g, "~~")
    .replace(/\^/g, "~^")
    .replace(/"/g, "^");
}

export function encodeBase64Utf8(value: string): string {
  const binary = Array.from(new TextEncoder().encode(value), (byte) =>
    String.fromCharCode(byte),
  ).join("");
  return btoa(binary);
}

export function hydrationDescriptor(
  rootId: string,
  props: Readonly<Record<string, unknown>> = {},
  slots: Readonly<Record<string, string>> = {},
  component = "TestComponent",
  events: Readonly<Record<string, unknown>> = {},
  streams: Readonly<
    Record<string, readonly Readonly<Record<string, unknown>>[]>
  > = {},
): string {
  return JSON.stringify({
    version: 2,
    component,
    identifierPrefix: createIdentifierPrefix(rootId),
    props,
    streams,
    events,
    slots,
  });
}

export function invoke(callback: LifecycleCallback, hook: object): void {
  Reflect.apply(callback, hook, []);
}

export function createTestHook(
  attributes: Record<string, string> = {},
  targetAttributes: Record<string, string> = {},
  liveSocket?: unknown,
): TestHook {
  return createMockLiveViewHook(
    {
      "data-component": "TestComponent",
      ...attributes,
    },
    targetAttributes,
    liveSocket,
  );
}

export function setAttributes(
  hook: TestHook,
  attributes: Readonly<Record<string, string | null>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null) hook.el.removeAttribute(name);
    else hook.el.setAttribute(name, value);
  }
}

/**
 * Asserts that a hook lifecycle callback fails without breaking LiveView's DOM
 * patch. The callback itself must not throw; the failure is reported through a
 * queued microtask so only the failing root is torn down. The original error is
 * preserved as the reported error's cause.
 */
export function expectLifecycleFailure(
  run: () => void,
  expected?: string | RegExp,
): void {
  const queued: VoidFunction[] = [];
  const queueMicrotaskSpy = vi
    .spyOn(globalThis, "queueMicrotask")
    .mockImplementation((callback: VoidFunction) => {
      queued.push(callback);
    });

  try {
    expect(run).not.toThrow();
  } finally {
    queueMicrotaskSpy.mockRestore();
  }

  expect(queued).toHaveLength(1);

  let reported: unknown;
  expect(() => {
    try {
      queued[0]?.();
    } catch (error: unknown) {
      reported = error;
      throw error;
    }
  }).toThrow();

  if (expected === undefined) return;

  const messages: string[] = [];
  for (let error = reported; error instanceof Error; error = error.cause) {
    messages.push(error.message);
  }

  const matched = messages.some((message) =>
    typeof expected === "string"
      ? message.includes(expected)
      : expected.test(message),
  );

  expect(
    matched,
    `expected one of ${JSON.stringify(messages)} to match ${String(expected)}`,
  ).toBe(true);
}
