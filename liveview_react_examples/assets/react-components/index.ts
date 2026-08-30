import type { ComponentRegistry, LiveViewReactComponent } from "liveview_react";
import { Simple } from "./simple";

type NamedComponentModule<
  TExportName extends string,
  TComponent extends LiveViewReactComponent,
> = Readonly<Record<TExportName, TComponent>>;

function loadNamed<
  TExportName extends string,
  TComponent extends LiveViewReactComponent,
>(
  importer: () => Promise<NamedComponentModule<TExportName, TComponent>>,
  exportName: TExportName,
): () => Promise<{ readonly default: TComponent }> {
  return async () => {
    const module = await importer();

    return Object.freeze({ default: module[exportName] });
  };
}

const manualComponents: ComponentRegistry = Object.freeze({
  AllFeatures: {
    load: loadNamed(() => import("./all-features"), "AllFeatures"),
  },
  SampleFormsUploads: {
    load: loadNamed(() => import("./all-features"), "SampleFormsUploads"),
  },
  Simple: { component: Simple },
  Context: {
    load: loadNamed(() => import("./context"), "Context"),
  },
  Counter: {
    load: loadNamed(() => import("./counter"), "Counter"),
  },
  DelaySlider: {
    load: loadNamed(() => import("./delay-slider"), "DelaySlider"),
  },
  FlashSonner: {
    load: loadNamed(() => import("./flash-sonner"), "FlashSonner"),
  },
  Lazy: { load: () => import("./lazy") },
  Link: {
    load: loadNamed(() => import("./link"), "Link"),
  },
  LinkExample: {
    load: loadNamed(() => import("./link-example"), "LinkExample"),
  },
  LogList: {
    load: loadNamed(() => import("./log-list"), "LogList"),
  },
  SSR: {
    load: loadNamed(() => import("./ssr"), "SSR"),
  },
  SimpleProps: {
    load: loadNamed(() => import("./simple-props"), "SimpleProps"),
  },
  Slot: {
    load: loadNamed(() => import("./slot"), "Slot"),
  },
  StreamDemo: {
    load: loadNamed(() => import("./stream-demo"), "StreamDemo"),
  },
  Typescript: {
    load: loadNamed(() => import("./typescript"), "Typescript"),
  },
});

export default manualComponents;
