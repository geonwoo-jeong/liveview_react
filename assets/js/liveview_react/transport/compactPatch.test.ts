import { describe, expect, it } from "vitest";

import { decodeCompactJson, decodeCompactPatch } from "./compactPatch";

describe("decodeCompactPatch", () => {
  it("decodes scalar add, replace, and remove operations", () => {
    expect(
      decodeCompactPatch("r6:/countn1:6a8:/items/3s1:dd8:/items/0"),
    ).toEqual([
      { op: "replace", path: "/count", value: 6 },
      { op: "add", path: "/items/3", value: "d" },
      { op: "remove", path: "/items/0" },
    ]);
  });

  it("decodes caret-encoded JSON and escaped transport characters", () => {
    expect(
      decodeCompactPatch("a5:/metaJ27:{^tilde^:^~~^,^caret^:^~^^}"),
    ).toEqual([
      { op: "add", path: "/meta", value: { tilde: "~", caret: "^" } },
    ]);
  });

  it("uses JavaScript string lengths for strings and paths", () => {
    expect(
      decodeCompactPatch("r14:/profile/na.mes6:zażółćr6:/emojis2:🚀"),
    ).toEqual([
      { op: "replace", path: "/profile/na.me", value: "zażółć" },
      { op: "replace", path: "/emoji", value: "🚀" },
    ]);
  });

  it("decodes null, booleans, numbers, upsert, and limit", () => {
    expect(
      decodeCompactPatch(
        "r6:/titlezu6:/itemsJ8:{^id^:1}l6:/itemsn2:-3r5:/flagb0r6:/pricen4:22.5",
      ),
    ).toEqual([
      { op: "replace", path: "/title", value: null },
      { op: "upsert", path: "/items", value: { id: 1 } },
      { op: "limit", path: "/items", value: -3 },
      { op: "replace", path: "/flag", value: false },
      { op: "replace", path: "/price", value: 22.5 },
    ]);
  });

  it("returns a frozen empty array for a null or empty payload", () => {
    expect(decodeCompactPatch(null)).toEqual([]);
    expect(decodeCompactPatch("")).toEqual([]);
    expect(Object.isFrozen(decodeCompactPatch(""))).toBe(true);
  });

  it.each([
    ["unknown operation", "x0:"],
    ["missing length", "r:/x"],
    ["truncated path", "r9:/x"],
    ["truncated value", "r2:/xs9:x"],
    ["invalid boolean", "r2:/xb2"],
    ["invalid number", "r2:/xn3:nan"],
    ["non-finite number", "r2:/xn5:1e999"],
    ["unknown value tag", "r2:/xq"],
    ["unsafe length", `r${"9".repeat(32)}:/x`],
  ])("rejects a malformed payload: %s", (_label, payload) => {
    expect(() => decodeCompactPatch(payload)).toThrow();
  });
});

describe("decodeCompactJson", () => {
  it("rejects non-canonical escape sequences", () => {
    expect(() => decodeCompactJson("{^value^:^~x^}")).toThrow(
      "Invalid LiveViewReact compact JSON escape",
    );
  });
});
