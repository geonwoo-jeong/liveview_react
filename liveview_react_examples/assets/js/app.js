import "vite/modulepreload-polyfill";
//
// Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
import "phoenix_html";
// Establish Phoenix Socket and LiveView configuration.
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import topbar from "topbar";
import components from "../react-components";
import { createLiveViewReact } from "liveview_react";
import "../css/app.css";

// Show progress bar on live navigation and form submits
topbar.config({ barColors: { 0: "#29d" }, shadowColor: "rgba(0, 0, 0, .3)" });
window.addEventListener("phx:page-loading-start", (_info) => topbar.show(300));
window.addEventListener("phx:page-loading-stop", (_info) => topbar.hide());

function connectLiveView(registeredComponents, e2eOptions = {}) {
  const liveViewReact = createLiveViewReact({
    ...(e2eOptions.rootOptions ?? {}),
    components: registeredComponents,
    strictMode: __LIVEVIEW_REACT_E2E__,
  });
  const liveViewReactHook = e2eOptions.auditHook
    ? e2eOptions.auditHook(liveViewReact.hooks.LiveViewReactHook)
    : liveViewReact.hooks.LiveViewReactHook;
  const csrfToken = document
    .querySelector("meta[name='csrf-token']")
    .getAttribute("content");
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
  import("../../e2e/support/registry").then(
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
