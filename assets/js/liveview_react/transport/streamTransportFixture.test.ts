import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { PatchOperation } from "./compactPatch";
import { materializeInitialFrame } from "./initialFrame";
import { normalizeStreamMap } from "./streamData";
import { applyStreamPatch } from "./streamPatch";

interface TransportFixture {
  readonly transportVersion: number;
  readonly scenario: {
    readonly expectedConnectedSnapshot: Readonly<Record<string, unknown>>;
    readonly expectedConnectedSnapshotPatches: readonly PatchOperation[];
    readonly expectedDeadRenderSnapshot: Readonly<Record<string, unknown>>;
  };
}

function readFixture(): TransportFixture {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures/stream_transport_v2.json"),
      "utf8",
    ),
  ) as TransportFixture;
}

describe("stream transport v2 cross-runtime fixture", () => {
  it("materializes the Elixir dead-render snapshot as immutable React props", () => {
    const fixture = readFixture();
    const frame = materializeInitialFrame(
      {
        version: fixture.transportVersion,
        component: "FixtureProbe",
        identifierPrefix: "liveview-react-stream-fixture-",
        props: {},
        streams: fixture.scenario.expectedDeadRenderSnapshot,
        events: {},
        slots: {},
      },
      "shared stream fixture",
    );

    expect(frame.streams).toEqual(fixture.scenario.expectedDeadRenderSnapshot);
    expect(frame.componentProps).toMatchObject(
      fixture.scenario.expectedDeadRenderSnapshot,
    );
    expect(Object.isFrozen(frame.streams)).toBe(true);
    expect(Object.isFrozen(frame.streams.users)).toBe(true);
    expect(Object.isFrozen(frame.streams.users?.[0])).toBe(true);
  });

  it("replays the Elixir connected snapshot patches into the expected state", () => {
    const fixture = readFixture();

    expect(fixture.transportVersion).toBe(2);
    expect(
      applyStreamPatch(
        normalizeStreamMap(
          fixture.scenario.expectedDeadRenderSnapshot,
          "shared fixture dead-render streams",
        ),
        fixture.scenario.expectedConnectedSnapshotPatches,
        "snapshot",
      ),
    ).toEqual(fixture.scenario.expectedConnectedSnapshot);
  });
});
