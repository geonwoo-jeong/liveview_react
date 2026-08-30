import { auditLiveViewReactHook, createDelayedLoader } from "./e2e-harness";
import { E2EEventsProbe } from "./e2e-events";
import { E2EFormsUploadsProbe } from "./e2e-forms-uploads";
import { E2ELifecycleProbe, E2EStrictModeProbe } from "./e2e-lifecycle";
import {
  E2EReactCompatProbe,
  E2EUncaughtErrorProbe,
  e2eRootOptions,
} from "./e2e-react-compat";
import { E2ESSRProbe } from "./e2e-ssr";
import {
  E2EClientOnlyStreamProbe,
  E2EStreamsSlotsProbe,
} from "./e2e-streams-slots";

export { auditLiveViewReactHook, e2eRootOptions };

export function e2eConnectParams() {
  const search = new URLSearchParams(window.location.search);
  return Object.freeze({
    e2e_queued_patch: search.get("queued_reconnect") === "true",
    e2e_recovery_seed: search.get("malformed_recovery") === "true",
    e2e_stream_reconnect: search.get("stream_reconnect") === "true",
  });
}

export default Object.freeze({
  E2EEventsProbe: Object.freeze({ component: E2EEventsProbe }),
  E2EFormsUploadsProbe: Object.freeze({ component: E2EFormsUploadsProbe }),
  E2ELifecycleProbe: Object.freeze({ component: E2ELifecycleProbe }),
  E2EReactCompatProbe: Object.freeze({ component: E2EReactCompatProbe }),
  E2EStrictModeProbe: Object.freeze({ component: E2EStrictModeProbe }),
  E2ESSRProbe: Object.freeze({ component: E2ESSRProbe }),
  E2EClientOnlyStreamProbe: Object.freeze({
    component: E2EClientOnlyStreamProbe,
  }),
  E2EStreamsSlotsProbe: Object.freeze({ component: E2EStreamsSlotsProbe }),
  E2EUncaughtErrorProbe: Object.freeze({
    component: E2EUncaughtErrorProbe,
  }),
  E2EDelayedUpdate: Object.freeze({
    load: createDelayedLoader("update", () => import("./e2e-delayed")),
  }),
  E2EDelayedDestroy: Object.freeze({
    load: createDelayedLoader("destroy", () => import("./e2e-delayed")),
  }),
});
