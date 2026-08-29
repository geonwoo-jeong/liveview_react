import { auditLiveViewReactHook, createDelayedLoader } from "./e2e-harness";
import { E2EEventsProbe } from "./e2e-events";
import { E2ELifecycleProbe, E2EStrictModeProbe } from "./e2e-lifecycle";
import { E2ESSRProbe } from "./e2e-ssr";
import { E2EStreamsSlotsProbe } from "./e2e-streams-slots";

export { auditLiveViewReactHook };

export function e2eConnectParams() {
  const search = new URLSearchParams(window.location.search);
  return Object.freeze({
    e2e_queued_patch: search.get("queued_reconnect") === "true",
    e2e_recovery_seed: search.get("malformed_recovery") === "true",
  });
}

export default {
  E2EEventsProbe: { component: E2EEventsProbe },
  E2ELifecycleProbe: { component: E2ELifecycleProbe },
  E2EStrictModeProbe: { component: E2EStrictModeProbe },
  E2ESSRProbe: { component: E2ESSRProbe },
  E2EStreamsSlotsProbe: { component: E2EStreamsSlotsProbe },
  E2EDelayedUpdate: {
    load: createDelayedLoader("update", () => import("./e2e-delayed")),
  },
  E2EDelayedDestroy: {
    load: createDelayedLoader("destroy", () => import("./e2e-delayed")),
  },
};
