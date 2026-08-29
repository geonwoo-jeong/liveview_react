import { vi } from "vitest";

let mockIdCounter = 0;

export const createMockLiveViewHook = (
  elementAttributes: Record<string, string> = {},
  targetAttributes: Record<string, string> = {},
  liveSocket?: unknown,
) => {
  const id = Object.hasOwn(elementAttributes, "id")
    ? elementAttributes.id!
    : `mock-${++mockIdCounter}`;
  const attributes: Record<string, string> = {
    "data-liveview-react-version": "1",
    "data-events": "{}",
    "data-props": "{}",
    "data-props-kind": "snapshot",
    "data-streams-kind": "snapshot",
    ...elementAttributes,
    id,
  };
  const target = document.createElement("div");
  target.setAttribute("data-react-target", "");
  for (const [name, value] of Object.entries(targetAttributes)) {
    target.setAttribute(name, value);
  }

  const mockElement = {
    get id() {
      return attributes.id ?? "";
    },
    set id(value: string) {
      attributes.id = value;
    },
    getAttribute: vi.fn((name: string) =>
      name in attributes ? attributes[name] : null,
    ),
    setAttribute: vi.fn((name: string, value: string) => {
      attributes[name] = value;
    }),
    removeAttribute: vi.fn((name: string) => {
      delete attributes[name];
    }),
    hasAttribute: vi.fn((name: string) => name in attributes),
    hasChildNodes: vi.fn(() => false),
    querySelectorAll: vi.fn((selector: string) =>
      selector === ":scope > [data-react-target]" ? [target] : [],
    ),
  };

  return {
    el: mockElement,
    liveSocket,
    target,
    pushEvent: vi.fn(() => Promise.resolve(undefined)),
    pushEventTo: vi.fn(() => Promise.resolve([])),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };
};
