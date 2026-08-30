// Synthetic components used only by the browser lifecycle suite.
import { useEffect, useState } from "react";
import { useLiveEvent } from "liveview_react";

import {
  recordProbeCleanup,
  recordProbeMount,
  recordStrictDelivery,
  recordStrictRegistration,
  recordStrictRemoval,
} from "./e2e-harness";

let nextInstanceNumber = 0;

function allocateInstanceId(label) {
  nextInstanceNumber += 1;
  return `${label}-${nextInstanceNumber}`;
}

export function E2ELifecycleProbe({ label, queuedItems = [], serverVersion }) {
  const [instanceId] = useState(() => allocateInstanceId(label));
  const [localCount, setLocalCount] = useState(0);

  useEffect(() => {
    recordProbeMount(label);
    return () => recordProbeCleanup(label);
  }, [label]);

  return (
    <section data-testid={`probe-${label}`}>
      <output data-testid={`instance-${label}`}>{instanceId}</output>
      <output data-testid={`server-${label}`}>{serverVersion}</output>
      <output data-testid={`queued-count-${label}`}>
        {queuedItems.length}
      </output>
      <output data-testid={`local-${label}`}>{localCount}</output>
      <button
        data-testid={`local-increment-${label}`}
        type="button"
        onClick={() => setLocalCount((count) => count + 1)}
      >
        increment local {label}
      </button>
    </section>
  );
}

function StrictListenerProbe() {
  const [deliveries, setDeliveries] = useState(0);

  useLiveEvent("e2e_strict_ping", () => {
    recordStrictDelivery();
    setDeliveries((count) => count + 1);
  });

  useEffect(() => {
    recordStrictRegistration();
    return () => {
      recordStrictRemoval();
    };
  }, []);

  return (
    <section data-testid="strict-probe">
      <output data-testid="strict-deliveries">{deliveries}</output>
    </section>
  );
}

export function E2EStrictModeProbe() {
  return <StrictListenerProbe />;
}
