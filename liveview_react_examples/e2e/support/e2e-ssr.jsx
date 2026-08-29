import { useId } from "react";
import { preload, preloadModule } from "react-dom";
import { useLiveReact } from "liveview_react";

export function E2ESSRProbe({ phase }) {
  const inputId = useId();
  const { el } = useLiveReact();

  preload("/assets/app.css", { as: "style" });
  preloadModule("/assets/app.js", { as: "script" });

  return (
    <section data-testid="ssr-probe">
      <output data-testid="ssr-phase">{phase}</output>
      <output data-testid="ssr-provider">
        {el === null ? "server" : el.id}
      </output>
      <label data-testid="ssr-label" htmlFor={inputId}>
        deterministic React id
      </label>
      <input data-testid="ssr-input" id={inputId} defaultValue="preserved" />
    </section>
  );
}
