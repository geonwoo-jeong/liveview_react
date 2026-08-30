import { useId, useState } from "react";
import { preload, preloadModule } from "react-dom";
import { useLiveEvent, useLiveViewReact } from "liveview_react";

interface SSRLiveEventPayload {
  readonly message: string;
}

interface E2ESSRProbeProps {
  readonly phase: string;
}

export function E2ESSRProbe({ phase }: E2ESSRProbeProps) {
  const inputId = useId();
  const { el } = useLiveViewReact();
  const [serverEvent, setServerEvent] = useState("pending");

  useLiveEvent<SSRLiveEventPayload>("e2e_ssr_live_event", ({ message }) => {
    setServerEvent(message);
  });

  preload("/assets/app.css", { as: "style" });
  preloadModule("/assets/app.js", { as: "script" });

  return (
    <section data-testid="ssr-probe">
      <output data-testid="ssr-phase">{phase}</output>
      <output data-testid="ssr-provider">
        {el === null ? "server" : el.id}
      </output>
      <output data-testid="ssr-live-event">{serverEvent}</output>
      <label data-testid="ssr-label" htmlFor={inputId}>
        deterministic React id
      </label>
      <input data-testid="ssr-input" id={inputId} defaultValue="preserved" />
    </section>
  );
}
