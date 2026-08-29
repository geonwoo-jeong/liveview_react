# Deployment

Build both browser and SSR assets before assembling a Phoenix release:

```sh
cd assets
npm ci
npm run build
npm run build-server
cd ..
mix assets.deploy
mix release
```

The production SSR bundle must be present at the configured path, which
defaults to:

```text
./priv/liveview_react/server.mjs
```

When using `LiveViewReact.SSR.NodeJS`, include the optional `:nodejs` Hex
dependency and start `NodeJS.Supervisor` under the application supervisor.
The release image must also contain a supported Node.js runtime.

Keep the Hex and npm package versions identical. The release workflow performs
both package dry-runs and refuses publication unless the versions match.
