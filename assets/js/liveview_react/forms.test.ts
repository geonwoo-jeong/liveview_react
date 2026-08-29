import { describe, expect, it } from "vitest";

import {
  formatPhoenixFieldName,
  setLiveFormValue,
  validateLiveFormPath,
  validateLiveFormServerSnapshot,
  validateLiveFormSubmitEvent,
  type LiveFormServerSnapshot,
} from "./forms";

interface Values {
  readonly email: string;
}

const INITIAL_VALUES: Values = Object.freeze({ email: "" });

function serverForm(
  overrides: Partial<LiveFormServerSnapshot<Values>> = {},
): LiveFormServerSnapshot<Values> {
  return {
    errors: {},
    id: "profile-form",
    name: "profile",
    required: { email: true },
    revision: 0,
    valid: true,
    values: INITIAL_VALUES,
    ...overrides,
  };
}

describe("forms", () => {
  it("strictly validates snapshots and protects immutable paths", () => {
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        submit_reply: null,
      }),
    ).toThrow(/unknown key "submit_reply"/i);
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        extra: true,
      } as unknown as LiveFormServerSnapshot<Values>),
    ).toThrow(/unknown key "extra"/i);

    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        errors: { email: "invalid" },
      } as unknown as LiveFormServerSnapshot<Values>),
    ).toThrow(/errors\.email.*array/i);

    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        required: { email: false },
      } as unknown as LiveFormServerSnapshot<Values>),
    ).toThrow(/required\.email.*true/i);

    const valuesCycle = { email: "" } as { email: string; self?: unknown };
    valuesCycle.self = valuesCycle;
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        values: valuesCycle as unknown as Values,
      }),
    ).toThrow(/values\.self.*cyclic/i);

    const errorsCycle = {} as Record<string, unknown>;
    errorsCycle.self = errorsCycle;
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        errors: errorsCycle,
      } as unknown as LiveFormServerSnapshot<Values>),
    ).toThrow(/errors\.self.*cyclic/i);

    const requiredCycle = {} as Record<string, unknown>;
    requiredCycle.self = requiredCycle;
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        required: requiredCycle,
      } as unknown as LiveFormServerSnapshot<Values>),
    ).toThrow(/required\.self.*cyclic/i);

    let deepValue: Record<string, unknown> = { email: "" };
    for (let depth = 0; depth < 65; depth += 1) {
      deepValue = { child: deepValue };
    }
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        values: deepValue as unknown as Values,
      }),
    ).toThrow(/values.*maximum.*64/i);

    expect(() => validateLiveFormPath(["__proto__"])).toThrow(/__proto__/);
    expect(() => formatPhoenixFieldName("profile", ["a][b"])).toThrow(
      /must not contain brackets/,
    );
    expect(() =>
      validateLiveFormServerSnapshot({
        ...serverForm(),
        name: "_target",
      }),
    ).toThrow(/reserved.*_target/i);

    const original = Object.freeze({
      nested: Object.freeze({ keep: 1, value: "before" }),
      sibling: Object.freeze({ keep: 2 }),
    });
    const updated = setLiveFormValue(original, ["nested", "value"], "after");
    expect(updated).not.toBe(original);
    expect(updated.nested).not.toBe(original.nested);
    expect(updated.sibling).toBe(original.sibling);
    expect(updated.nested.value).toBe("after");
  });

  it("strictly validates and clones the fixed submit event payload", () => {
    const valid = {
      id: "profile-form",
      name: "profile",
      reply: null,
      revision: 4,
    };
    const normalized = validateLiveFormSubmitEvent(valid);
    expect(normalized).toEqual(valid);
    expect(Object.isFrozen(normalized)).toBe(true);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let deeplyNested: unknown = "leaf";
    for (let depth = 0; depth < 65; depth += 1) {
      deeplyNested = { child: deeplyNested };
    }
    const unsafeReply = JSON.parse('{"__proto__":{"polluted":true}}');
    const invalidPayloads: readonly unknown[] = [
      null,
      { ...valid, extra: true },
      { id: valid.id, name: valid.name, revision: valid.revision },
      { ...valid, name: "__proto__" },
      { ...valid, revision: -1 },
      { ...valid, revision: 1.5 },
      { ...valid, revision: Number.NaN },
      { ...valid, reply: cycle },
      { ...valid, reply: deeplyNested },
      { ...valid, reply: unsafeReply },
    ];

    for (const payload of invalidPayloads) {
      expect(() => validateLiveFormSubmitEvent(payload)).toThrow(TypeError);
    }
  });
});
