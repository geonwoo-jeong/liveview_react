import { createDelayedLoader } from "./e2e-harness";
import { E2ELifecycleProbe, E2EStrictModeProbe } from "./e2e-lifecycle";

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
