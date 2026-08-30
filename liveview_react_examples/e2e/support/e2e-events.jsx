import { useEffect, useState } from "react";
import {
  Link,
  useEventReply,
  useLiveConnection,
  useLiveEvent,
  useLiveNavigation,
  useLiveViewReact,
} from "liveview_react";

import {
  recordServerEventDelivery,
  retainIncrementCallback,
} from "./e2e-events-harness";

export function E2EEventsProbe({ onIncrement, patchStep }) {
  const { pushEvent } = useLiveViewReact();
  const connection = useLiveConnection();
  const navigation = useLiveNavigation();
  const eventReply = useEventReply("event_reply", {
    initialData: { result: "none" },
  });
  const [programmaticReply, setProgrammaticReply] = useState("none");
  const [serverDeliveries, setServerDeliveries] = useState([]);

  useEffect(() => {
    retainIncrementCallback(onIncrement);
  }, [onIncrement]);

  useLiveEvent("e2e_server_event", ({ sequence }) => {
    recordServerEventDelivery(sequence);
    setServerDeliveries((deliveries) => [...deliveries, sequence]);
  });

  async function requestProgrammaticReply() {
    const reply = await pushEvent("programmatic_reply", { amount: 3 });
    setProgrammaticReply(`${reply.source}:${reply.doubled}`);
  }

  async function requestHookReply() {
    await eventReply.execute({ query: "react" });
  }

  return (
    <section data-testid="events-probe">
      <output data-testid="connection-state">
        {connection.connected ? "connected" : "disconnected"}:
        {connection.reconnecting ? "reconnecting" : "stable"}
      </output>
      <output data-testid="programmatic-reply">{programmaticReply}</output>
      <output data-testid="event-reply-loading">
        {eventReply.isLoading ? "loading" : "idle"}
      </output>
      <output data-testid="event-reply-result">{eventReply.data.result}</output>
      <output data-testid="server-event-deliveries">
        {serverDeliveries.join(",") || "none"}
      </output>
      <output data-testid="react-patch-step">{patchStep}</output>

      <button
        data-testid="callback-increment"
        type="button"
        onClick={() => onIncrement?.({ by: 2, label: "react" })}
      >
        callback increment
      </button>
      <button
        data-testid="programmatic-push"
        type="button"
        onClick={() => void requestProgrammaticReply()}
      >
        programmatic push
      </button>
      <button
        data-testid="event-reply"
        type="button"
        onClick={() => void requestHookReply()}
      >
        event reply
      </button>
      <button
        data-testid="react-phx-click"
        type="button"
        phx-click="react_phx_increment"
        phx-value-by="4"
      >
        React phx-click
      </button>
      <button
        data-testid="programmatic-patch"
        type="button"
        onClick={() => navigation.patch("/e2e/events?step=programmatic")}
      >
        programmatic patch
      </button>
      <button
        data-testid="programmatic-navigate"
        type="button"
        onClick={() =>
          navigation.navigate("/e2e/events/destination?via=programmatic")
        }
      >
        programmatic navigate
      </button>

      <Link data-testid="link-patch" patch="/e2e/events?step=link">
        Link patch
      </Link>
      <Link
        data-testid="link-navigate"
        navigate="/e2e/events/destination?via=link"
      >
        Link navigate
      </Link>
      <Link data-testid="link-href" href="/e2e/events/destination?via=href">
        Link href
      </Link>
      <Link
        data-testid="link-target"
        patch="/e2e/events?step=target"
        target="_blank"
      >
        Link target
      </Link>
      <Link
        data-testid="link-modified"
        navigate="/e2e/events/destination?via=modified"
      >
        Link modified click
      </Link>
    </section>
  );
}
