const bundleUrl = new URL(
  "../../priv/liveview_react/server.mjs",
  import.meta.url,
);

const { render } = await import(bundleUrl.href);
const html = await render({
  component: "Simple",
  events: {},
  identifierPrefix: "liveview-react-smoke-simple-",
  props: {},
  slots: {},
  streams: {},
  version: 2,
});
const lazyHtml = await render({
  component: "Lazy",
  events: {},
  identifierPrefix: "liveview-react-smoke-lazy-",
  props: {},
  slots: {},
  streams: {},
  version: 2,
});

if (!html.includes("Hello world!")) {
  throw new Error("SSR smoke render did not return the Simple component");
}

if (!lazyHtml.includes("Loading...")) {
  throw new Error("SSR smoke render did not load the lazy registry entry");
}

console.log("SSR smoke render passed");
