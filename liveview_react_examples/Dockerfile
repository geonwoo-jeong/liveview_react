# Build this image from the repository root so both local liveview_react
# packages are available:
#
#   docker build -f liveview_react_examples/Dockerfile .

ARG BUILDER_IMAGE="hexpm/elixir:1.20.4-erlang-29.0.5-debian-bookworm-20260824-slim@sha256:468bb08c48e673cce404087adfafcac1a881b77326eff6bce438141f668e27c9"
ARG RUNNER_IMAGE="debian:bookworm-20260824-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171"
ARG NODE_IMAGE="node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e"

# Every base uses a manifest-list digest for immutable, native amd64/arm64
# selection. Node is copied from its official image instead of installing an
# executable repository setup script.
FROM ${NODE_IMAGE} AS node_runtime

FROM ${BUILDER_IMAGE} AS builder

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends build-essential git ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version \
    && npm --version

ENV MIX_ENV="prod"

WORKDIR /app

RUN mix local.hex --force \
    && mix local.rebar --force

# Build the local npm package before the example installs its file dependency.
COPY package.json package-lock.json tsconfig.json tsconfig.build.json vite.config.ts ./
COPY assets/js/liveview_react assets/js/liveview_react
RUN npm ci --no-audit --no-fund --loglevel=error \
    && npm run build

# The example's Mix dependency points to the repository root.
COPY mix.exs ./
COPY lib lib

WORKDIR /app/liveview_react_examples

COPY liveview_react_examples/mix.exs liveview_react_examples/mix.lock ./
RUN mix deps.get --only "${MIX_ENV}" \
    && mkdir config

COPY liveview_react_examples/config/config.exs liveview_react_examples/config/prod.exs config/
RUN mix deps.compile

COPY liveview_react_examples/priv priv
COPY liveview_react_examples/lib lib
COPY liveview_react_examples/assets assets

RUN npm ci --prefix assets --no-audit --no-fund --loglevel=error \
    && mix assets.deploy \
    && mix compile

COPY liveview_react_examples/config/runtime.exs config/
COPY liveview_react_examples/rel rel
RUN mix release

FROM ${RUNNER_IMAGE} AS runner

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      libncurses5 \
      libstdc++6 \
      locales \
      openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# SSR only needs the pinned Node runtime; npm and build tooling stay behind.
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
RUN node --version

RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen

ENV LANG="en_US.UTF-8"
ENV LANGUAGE="en_US:en"
ENV LC_ALL="en_US.UTF-8"
ENV MIX_ENV="prod"

WORKDIR /app
RUN chown nobody /app

COPY --from=builder --chown=nobody:root /app/liveview_react_examples/_build/${MIX_ENV}/rel/liveview_react_examples ./

USER nobody

CMD ["/app/bin/server"]
