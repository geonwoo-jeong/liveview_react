defmodule LiveViewReact.Installer.Templates do
  @moduledoc false

  @spec typescript_config() :: String.t()
  def typescript_config do
    """
    {
      "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "Bundler",
        "allowJs": true,
        "noEmit": true,
        "isolatedModules": true,
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "jsx": "react-jsx",
        "types": ["vite/client"]
      },
      "include": ["js/**/*", "react-components/**/*"]
    }
    """
  end

  @spec client_entrypoint() :: String.t()
  def client_entrypoint do
    """
    import components from "virtual:liveview-react/components";
    import { createLiveViewReact } from "liveview_react";

    export const liveViewReact = createLiveViewReact({ components });
    """
  end

  @spec server_entrypoint() :: String.t()
  def server_entrypoint do
    """
    import components from "virtual:liveview-react/components";
    import { createLiveViewReactServer } from "liveview_react/server";
    import type { ServerRenderRequest } from "liveview_react/server";

    const server = createLiveViewReactServer({ components });

    export function render(request: ServerRenderRequest): Promise<string> {
      return server.render(request);
    }
    """
  end

  @spec virtual_module_declaration() :: String.t()
  def virtual_module_declaration do
    """
    declare module "virtual:liveview-react/components" {
      import type { ComponentRegistry } from "liveview_react";

      const components: ComponentRegistry;
      export default components;
    }
    """
  end

  @spec ssr_vite_config() :: String.t()
  def ssr_vite_config do
    """
    import react from "@vitejs/plugin-react";
    import { defineConfig } from "vite";
    import liveViewReactPlugin from "liveview_react/vite";

    export default defineConfig({
      plugins: [
        react(),
        liveViewReactPlugin({ entrypoint: "./js/liveview_react_server.tsx" }),
      ],
      ssr: {
        noExternal: true,
      },
      build: {
        ssr: "./js/liveview_react_server.tsx",
        outDir: "../priv/liveview_react",
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: "server.mjs",
            chunkFileNames: "[name]-[hash].mjs",
          },
        },
      },
    });
    """
  end

  @spec demo_component() :: String.t()
  def demo_component do
    """
    export interface LiveViewReactDemoProps {
      readonly count: number;
      readonly onIncrement?: () => void;
    }

    export default function LiveViewReactDemo({
      count,
      onIncrement,
    }: LiveViewReactDemoProps) {
      return (
        <section aria-labelledby="liveview-react-demo-heading">
          <h1 id="liveview-react-demo-heading">LiveViewReact is ready</h1>
          <p>Server count: {count}</p>
          <button type="button" onClick={() => onIncrement?.()}>
            Increment on the server
          </button>
        </section>
      );
    }
    """
  end

  @spec demo_live_view(module()) :: String.t()
  def demo_live_view(module) when is_atom(module) do
    """
    defmodule #{inspect(module)} do
      use #{inspect(web_module(module))}, :live_view

      @impl true
      def mount(_params, _session, socket) do
        {:ok, assign(socket, :count, 0)}
      end

      @impl true
      def handle_event("increment", _params, socket) do
        {:noreply, update(socket, :count, &(&1 + 1))}
      end

      @impl true
      def render(assigns) do
        ~H\"\"\"
        <.react
          id="liveview-react-demo"
          component="LiveViewReactDemo"
          socket={@socket}
          count={@count}
          r-on:increment={Phoenix.LiveView.JS.push("increment")}
        />
        \"\"\"
      end
    end
    """
  end

  defp web_module(module) do
    module
    |> Module.split()
    |> Enum.drop(-1)
    |> Module.concat()
  end
end
