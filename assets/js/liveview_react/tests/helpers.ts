import { vi } from "vitest";

let mockIdCounter = 0;

export const createMockLiveViewHook = (
  elementAttributes: Record<string, string> = {},
) => {
  const id = elementAttributes.id || `mock-${++mockIdCounter}`;
  const attributes = { ...elementAttributes };
  const target = document.createElement("div");
  target.innerHTML = attributes["data-ssr"] ? "<div>SSR</div>" : "";

  const mockElement = {
    id,
    getAttribute: vi.fn((name: string) =>
      name in attributes ? attributes[name] : null,
    ),
    setAttribute: vi.fn((name: string, value: string) => {
      attributes[name] = value;
    }),
    hasAttribute: vi.fn((name: string) => name in attributes),
    hasChildNodes: vi.fn(() => false),
    querySelector: vi.fn((selector: string) =>
      selector === "[data-react-target]" ? target : null,
    ),
  };

  return {
    el: mockElement,
    target,
    pushEvent: vi.fn(),
    pushEventTo: vi.fn(),
    handleEvent: vi.fn(),
    removeHandleEvent: vi.fn(),
    upload: vi.fn(),
    uploadTo: vi.fn(),
  };
};
