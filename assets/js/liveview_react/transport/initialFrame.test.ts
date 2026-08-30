import { describe, expect, it, vi } from "vitest";

import { materializeInitialFrame, normalizeInitialFrame } from "./initialFrame";

const IDENTIFIER_PREFIX = "liveview-react-initial-frame-test-";
const REQUIRED_FIELDS = Object.freeze([
  "version",
  "component",
  "identifierPrefix",
  "props",
  "streams",
  "events",
  "slots",
] as const);

function frame(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    version: 2,
    component: "UserList",
    identifierPrefix: IDENTIFIER_PREFIX,
    props: {},
    streams: {},
    events: {},
    slots: {},
    ...overrides,
  };
}

function withoutField(field: (typeof REQUIRED_FIELDS)[number]): object {
  return Object.fromEntries(
    Object.entries(frame()).filter(([name]) => name !== field),
  );
}

describe("transport-v2 initial frame", () => {
  it("materializes immutable stream props including empty streams", () => {
    const materialized = materializeInitialFrame(
      frame({
        props: { heading: "Users" },
        streams: {
          archived: [],
          users: [
            {
              __dom_id: "users-1",
              name: "Ada",
              profile: { active: true },
            },
          ],
        },
      }),
      "test frame",
    );

    expect(materialized.componentProps).toMatchObject({
      archived: [],
      heading: "Users",
      users: [
        {
          __dom_id: "users-1",
          name: "Ada",
          profile: { active: true },
        },
      ],
    });
    expect(Object.isFrozen(materialized.streams)).toBe(true);
    expect(Object.isFrozen(materialized.streams.archived)).toBe(true);
    expect(Object.isFrozen(materialized.streams.users)).toBe(true);
    expect(Object.isFrozen(materialized.streams.users?.[0])).toBe(true);
    expect(Object.isFrozen(materialized.streams.users?.[0]?.profile)).toBe(
      true,
    );
  });

  it.each([
    ["v1", frame({ version: 1 }), "version must be 2"],
    ["unknown field", frame({ legacy: true }), "Unknown test frame field"],
  ])(
    "rejects %s without a compatibility fallback",
    (_label, value, message) => {
      expect(() => normalizeInitialFrame(value, "test frame")).toThrow(message);
    },
  );

  it.each(REQUIRED_FIELDS)("requires the %s field", (field) => {
    expect(() =>
      normalizeInitialFrame(withoutField(field), "test frame"),
    ).toThrow(`requires field "${field}"`);
  });

  it.each([
    ["non-array stream", { users: {} }, "must be an array"],
    ["non-object item", { users: [1] }, "must be a plain JSON object"],
    ["missing DOM id", { users: [{ name: "Ada" }] }, "__dom_id"],
    ["empty DOM id", { users: [{ __dom_id: "" }] }, "non-empty string"],
    [
      "duplicate DOM id",
      { users: [{ __dom_id: "u1" }, { __dom_id: "u1" }] },
      "duplicate __dom_id",
    ],
  ])("rejects malformed streams: %s", (_label, streams, message) => {
    expect(() =>
      normalizeInitialFrame(frame({ streams }), "test frame"),
    ).toThrow(message);
  });

  it.each([
    ["ordinary/stream", { props: { users: [] }, streams: { users: [] } }],
    [
      "ordinary/event",
      {
        props: { onSelect: "ordinary" },
        events: { onSelect: [["push", { event: "select" }]] },
      },
    ],
    [
      "ordinary/slot",
      { props: { header: "ordinary" }, slots: { header: "<h1>Slot</h1>" } },
    ],
    [
      "stream/event",
      {
        streams: { onSelect: [] },
        events: { onSelect: [["push", { event: "select" }]] },
      },
    ],
    [
      "stream/slot",
      { streams: { header: [] }, slots: { header: "<h1>Slot</h1>" } },
    ],
    [
      "event/slot",
      {
        events: { onSelect: [["push", { event: "select" }]] },
        slots: { onSelect: "<button>Select</button>" },
      },
    ],
  ])("rejects %s namespace collisions before merging", (_label, overrides) => {
    expect(() =>
      materializeInitialFrame(frame(overrides), "test frame"),
    ).toThrow("as both");
  });

  it("rejects accessors and prototype-sensitive stream data without reading them", () => {
    const getter = vi.fn(() => "UserList");
    const accessorFrame = Object.defineProperty(frame(), "component", {
      enumerable: true,
      get: getter,
    });
    expect(() => normalizeInitialFrame(accessorFrame, "test frame")).toThrow(
      "enumerable data properties",
    );
    expect(getter).not.toHaveBeenCalled();

    const pollutedItem = JSON.parse(
      '{"__dom_id":"users-1","__proto__":{"polluted":true}}',
    );
    expect(() =>
      normalizeInitialFrame(
        frame({ streams: { users: [pollutedItem] } }),
        "test frame",
      ),
    ).toThrow("prototype-sensitive key");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
