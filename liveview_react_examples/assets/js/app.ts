import "vite/modulepreload-polyfill";
//
// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html";
// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import topbar from "topbar";
import discoveredComponents from "virtual:liveview-react/components";
import manualComponents from "../react-components";
import { clientRootOptions } from "../react-components/root-options";
import { createLiveViewReact } from "liveview_react";
import type {
  ComponentRegistry,
  LiveViewReactHookDefinition,
  LiveViewReactRootOptions,
  LiveViewReactRootWrapperContext,
} from "liveview_react";
import "../css/app.css";

declare const __LIVEVIEW_REACT_E2E__: boolean;

declare global {
  interface Window {
    liveSocket: LiveSocket;
  }
}

type E2EOptions = {
  readonly auditHook?: (
    hook: LiveViewReactHookDefinition,
  ) => LiveViewReactHookDefinition;
  readonly connectParams?: () => Readonly<Record<string, unknown>>;
  readonly rootOptions?: LiveViewReactRootOptions;
};

const components = Object.freeze({
  ...manualComponents,
  ...discoveredComponents,
});

// Show progress bar on live navigation and form submits
topbar.config({ barColors: { 0: "#29d" }, shadowColor: "rgba(0, 0, 0, .3)" });
window.addEventListener("phx:page-loading-start", () => topbar.show(300));
window.addEventListener("phx:page-loading-stop", () => topbar.hide());

function mergeRootOptions(
  baseOptions: LiveViewReactRootOptions,
  overrideOptions: LiveViewReactRootOptions = {},
): LiveViewReactRootOptions {
  const baseWrapRoot = baseOptions.wrapRoot;
  const overrideWrapRoot = overrideOptions.wrapRoot;
  const wrapRoot =
    baseWrapRoot && overrideWrapRoot
      ? (context: LiveViewReactRootWrapperContext) =>
          overrideWrapRoot(
            Object.freeze({
              ...context,
              children: baseWrapRoot(context),
            }),
          )
      : (overrideWrapRoot ?? baseWrapRoot);

  return Object.freeze({
    ...baseOptions,
    ...overrideOptions,
    ...(wrapRoot ? { wrapRoot } : {}),
  });
}

function readCsrfToken(): string {
  const token = document.querySelector<HTMLMetaElement>(
    "meta[name='csrf-token']",
  )?.content;

  if (!token) {
    throw new Error("Missing CSRF token meta tag");
  }

  return token;
}

function connectLiveView(
  registeredComponents: ComponentRegistry,
  e2eOptions: E2EOptions = {},
): void {
  const rootOptions = mergeRootOptions(
    clientRootOptions,
    e2eOptions.rootOptions ?? {},
  );
  const liveViewReact = createLiveViewReact({
    ...rootOptions,
    components: registeredComponents,
  });
  const liveViewReactHook = e2eOptions.auditHook
    ? e2eOptions.auditHook(liveViewReact.hooks.LiveViewReactHook)
    : liveViewReact.hooks.LiveViewReactHook;
  const csrfToken = readCsrfToken();
  const liveSocket = new LiveSocket("/live", Socket, {
    hooks: { ...liveViewReact.hooks, LiveViewReactHook: liveViewReactHook },
    longPollFallbackMs: 2500,
    params: () => ({
      _csrf_token: csrfToken,
      ...(e2eOptions.connectParams?.() ?? {}),
    }),
  });

  // Connect if there are any LiveViews on the page.
  liveSocket.connect();

  // Expose liveSocket for console debugging and latency simulation.
  window.liveSocket = liveSocket;
}

if (__LIVEVIEW_REACT_E2E__) {
  void import("../../e2e/support/registry").then(
    ({
      auditLiveViewReactHook,
      default: e2eComponents,
      e2eConnectParams,
      e2eRootOptions,
    }) => {
      connectLiveView(
        { ...components, ...e2eComponents },
        {
          auditHook: auditLiveViewReactHook,
          connectParams: e2eConnectParams,
          rootOptions: e2eRootOptions,
        },
      );
    },
  );
} else {
  connectLiveView(components);
}
