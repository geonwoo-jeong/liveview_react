import { describe, expect, it } from "vitest";

import { createIdentifierPrefix } from "./identifier-prefix";

describe("createIdentifierPrefix", () => {
  it("derives a stable prefix from the LiveView root id", () => {
    expect(createIdentifierPrefix("orders-42")).toBe(
      "liveview-react-orders-42-",
    );
  });

  it("rejects an empty root id", () => {
    expect(() => createIdentifierPrefix("")).toThrow(
      "React root id must be a non-empty string",
    );
  });
});
