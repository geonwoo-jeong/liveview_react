import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { PatchOperation } from "./compactPatch";
import { applyPatch } from "./jsonPatch";
import { normalizeComponentProps } from "./jsonData";
import type { ComponentProps } from "../types";

interface TransportFrame {
  readonly step: string;
  readonly propsKind: "patch" | "snapshot";
  readonly props: Readonly<Record<string, unknown>> | null;
  readonly propsDiff: readonly PatchOperation[];
}

interface TransportFixture {
  readonly transportVersion: number;
  readonly scenario: {
    readonly frames: readonly TransportFrame[];
    readonly expectedFinalProps: Readonly<Record<string, unknown>>;
  };
}

function readFixture(): TransportFixture {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures/props_transport_v2.json"),
      "utf8",
    ),
  ) as TransportFixture;
}

describe("props transport v2 cross-runtime fixture", () => {
  it("replays the Elixir frames and converges on the server's final props", () => {
    const { scenario, transportVersion } = readFixture();
    expect(transportVersion).toBe(2);

    let props: ComponentProps = Object.freeze({});
    for (const frame of scenario.frames) {
      props =
        frame.propsKind === "snapshot"
          ? normalizeComponentProps(frame.props, `${frame.step} snapshot`)
          : normalizeComponentProps(
              applyPatch(props, frame.propsDiff),
              `${frame.step} patch`,
            );
    }

    expect(props).toEqual(scenario.expectedFinalProps);
  });

  it("shares untouched branches across a patch so React can memoize", () => {
    const { scenario } = readFixture();
    const [mount, increment] = scenario.frames;

    const initial = normalizeComponentProps(mount?.props, "mount snapshot");
    const next = applyPatch(initial, increment?.propsDiff ?? []);

    // /count changed; /user and /items must keep their identity.
    expect(next).not.toBe(initial);
    expect((next as Record<string, unknown>).user).toBe(
      (initial as Record<string, unknown>).user,
    );
    expect((next as Record<string, unknown>).items).toBe(
      (initial as Record<string, unknown>).items,
    );
  });
});
