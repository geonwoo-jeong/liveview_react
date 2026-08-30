import discoveredComponents from "virtual:liveview-react/components";
import manualComponents from "../react-components";
import { serverRootOptions } from "../react-components/root-options";
import { createLiveViewReactServer } from "liveview_react/server";

const components = Object.freeze({
  ...manualComponents,
  ...discoveredComponents,
});

const server = __LIVEVIEW_REACT_E2E__
  ? import("../../e2e/support/registry").then(({ default: e2eComponents }) =>
      createLiveViewReactServer({
        components: { ...components, ...e2eComponents },
        ...serverRootOptions,
        strictMode: true,
      }),
    )
  : Promise.resolve(
      createLiveViewReactServer({ components, ...serverRootOptions }),
    );

export async function render(request) {
  return (await server).render(request);
}
