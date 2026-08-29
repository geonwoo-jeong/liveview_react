import components from "../react-components";
import { createLiveViewReactServer } from "liveview_react/server";

const server = __LIVEVIEW_REACT_E2E__
  ? import("../../e2e/support/registry").then(({ default: e2eComponents }) =>
      createLiveViewReactServer({
        components: { ...components, ...e2eComponents },
        strictMode: true,
      }),
    )
  : Promise.resolve(createLiveViewReactServer({ components }));

export async function render(request) {
  return (await server).render(request);
}
