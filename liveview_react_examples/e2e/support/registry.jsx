import { auditLiveViewReactHook, createDelayedLoader } from "./e2e-harness";
import { E2ELifecycleProbe, E2EStrictModeProbe } from "./e2e-lifecycle";

export { auditLiveViewReactHook };

export function e2eConnectParams() {
  const search = new URLSearchParams(window.location.search);
  return Object.freeze({
    e2e_queued_patch: search.get("queued_reconnect") === "true",
    e2e_recovery_seed: search.get("malformed_recovery") === "true",
  });
}

export default {
  E2ELifecycleProbe: { component: E2ELifecycleProbe },
  E2EStrictModeProbe: { component: E2EStrictModeProbe },
  E2EDelayedUpdate: {
    load: createDelayedLoader("update", () => import("./e2e-delayed")),
  },
  E2EDelayedDestroy: {
    load: createDelayedLoader("destroy", () => import("./e2e-delayed")),
  },
};
