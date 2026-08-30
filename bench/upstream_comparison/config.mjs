import { tmpdir } from "node:os";
import path from "node:path";

export const TARGETS = Object.freeze({
  current: Object.freeze({
    id: "current",
    label: "liveview_react (workspace snapshot)",
    ref: "workspace",
  }),
  upstreamMain: Object.freeze({
    id: "upstream-main",
    label: "live_react upstream main",
    ref: "6a463b7ce6011197ddf690460889af9f67835168",
  }),
  hexV110: Object.freeze({
    id: "hex-v1.1.0",
    label: "live_react Hex v1.1.0",
    ref: "ff1d34769c8deec3734f4ee7d250f1881a5bb295",
  }),
  npmRc020: Object.freeze({
    id: "npm-0.2.0-rc-0",
    label: "@mrdotb/live-react 0.2.0-rc-0",
    ref: "0.2.0-rc-0",
    tarballFile: "mrdotb-live-react-0.2.0-rc-0.tgz",
  }),
});

export const DEFAULT_WORKSPACE = path.join(
  tmpdir(),
  "liveview-react-upstream-comparison",
);
export const PREPARE_MANIFEST = "prepare-manifest.json";
export const RESULT_JSON = "latest.json";
export const RESULT_MARKDOWN = "latest.md";
export const DEFAULT_BENCHMARK_OPTIONS = Object.freeze({
  warmupSamples: 2,
  samples: 8,
});
