import { Simple } from "./simple";

function loadNamed(importer, exportName) {
  return () =>
    importer().then((module) => ({
      default: module[exportName],
    }));
}

export default {
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
};
