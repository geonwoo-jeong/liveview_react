// Synthetic components used only by the browser lifecycle suite.
import { useEffect, useState } from "react";
import { useLiveViewReact } from "liveview_react";

import {
  recordProbeCleanup,
  recordProbeMount,
  recordStrictDelivery,
  recordStrictRegistration,
  recordStrictRemoval,
} from "./e2e-harness";

export function E2ELifecycleProbe({ label, queuedItems = [], serverVersion }) {
  const [instanceId, setInstanceId] = useState("pending");
  const [localCount, setLocalCount] = useState(0);

  useEffect(() => {
    setInstanceId(recordProbeMount(label));
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
  const { handleEvent, removeHandleEvent } = useLiveViewReact();
  const [deliveries, setDeliveries] = useState(0);

  useEffect(() => {
    const eventReference = handleEvent("e2e_strict_ping", () => {
      recordStrictDelivery();
      setDeliveries((count) => count + 1);
    });

    recordStrictRegistration();

    return () => {
      removeHandleEvent(eventReference);
      recordStrictRemoval();
    };
  }, [handleEvent, removeHandleEvent]);

  return (
    <section data-testid="strict-probe">
      <output data-testid="strict-deliveries">{deliveries}</output>
    </section>
  );
}

export function E2EStrictModeProbe() {
  return <StrictListenerProbe />;
}
