if Code.ensure_loaded?(Igniter) do
  defmodule LiveViewReact.Igniter do
    @moduledoc false

    alias Igniter.Libs.Phoenix, as: IgniterPhoenix
    alias Igniter.Project.Config, as: IgniterConfig
    alias LiveViewReact.Installer.Elixir, as: ElixirInstaller
    alias LiveViewReact.Installer.JavaScript
    alias LiveViewReact.Installer.PackageJSON
    alias LiveViewReact.Installer.Templates
    alias LiveViewReact.Installer.TypeScriptConfig
    alias Rewrite.Source
    alias Sourceror.Zipper

    @owned_files [
      {"assets/js/liveview_react.ts", :client_entrypoint},
      {"assets/js/liveview_react_server.tsx", :server_entrypoint},
      {"assets/js/liveview-react.d.ts", :virtual_module_declaration},
      {"assets/vite.liveview-react.ssr.config.mjs", :ssr_vite_config}
    ]

    @spec install(Igniter.t(), Keyword.t()) :: Igniter.t()
    def install(igniter, opts \\ []) do
      demo? = Keyword.get(opts, :demo, true)

      case select_phoenix_modules(igniter) do
        {:ok, igniter, router, _endpoint, web_module} ->
          igniter
          |> update_package_json()
          |> update_typescript_config()
          |> create_owned_files(@owned_files)
          |> maybe_create_demo_component(demo?)
          |> update_app_javascript()
          |> update_vite_config()
          |> configure_development_ssr()
          |> ElixirInstaller.ensure_html_import(web_module)
          |> maybe_install_demo(demo?, router, web_module)
          |> add_post_install_notices(demo?)

        {:error, igniter, message} ->
          Igniter.add_issue(igniter, message)
      end
    end

    @spec supports_umbrella?() :: false
    def supports_umbrella?, do: false

    defp select_phoenix_modules(igniter) do
      {igniter, router} = IgniterPhoenix.select_router(igniter)

      if is_nil(router) do
        {:error, igniter, "LiveViewReact requires a Phoenix router in the selected application"}
      else
        {igniter, web_module} = IgniterPhoenix.web_module_for_router(igniter, router)
        {igniter, endpoint} = IgniterPhoenix.select_endpoint(igniter, router)

        if is_nil(endpoint) do
          {:error, igniter,
           "LiveViewReact requires a Phoenix endpoint that uses #{inspect(router)}"}
        else
          {:ok, igniter, router, endpoint, web_module}
        end
      end
    end

    defp update_package_json(igniter),
      do: update_required_file(igniter, "assets/package.json", &PackageJSON.merge/1)

    defp update_typescript_config(igniter) do
      path = "assets/tsconfig.json"

      if Igniter.exists?(igniter, path) do
        update_required_file(igniter, path, &TypeScriptConfig.merge/1)
      else
        Igniter.create_new_file(igniter, path, Templates.typescript_config())
      end
    end

    defp create_owned_files(igniter, files) do
      Enum.reduce(files, igniter, fn {path, template}, igniter ->
        ensure_owned_file(igniter, path, apply(Templates, template, []))
      end)
    end

    defp maybe_create_demo_component(igniter, true) do
      ensure_owned_file(
        igniter,
        "assets/react-components/LiveViewReactDemo.tsx",
        Templates.demo_component()
      )
    end

    defp maybe_create_demo_component(igniter, false), do: igniter

    defp ensure_owned_file(igniter, path, desired) do
      case Igniter.exists?(igniter, path) do
        true ->
          igniter
          |> Igniter.include_existing_file(path, required?: true)
          |> keep_owned_file(path, desired)

        false ->
          Igniter.create_new_file(igniter, path, desired)
      end
    end

    defp update_app_javascript(igniter) do
      update_required_file(igniter, "assets/js/app.js", fn source ->
        source
        |> JavaScript.ensure_import(
          ~s(import { liveViewReact } from "./liveview_react";),
          "./liveview_react"
        )
        |> then(&merge_live_socket_hooks_result(&1, "liveViewReact.hooks"))
      end)
    end

    defp update_vite_config(igniter) do
      update_required_file(igniter, "assets/vite.config.mjs", fn source ->
        source
        |> JavaScript.ensure_vite_plugin(
          ~s(import react from "@vitejs/plugin-react";),
          "@vitejs/plugin-react",
          "react()"
        )
        |> then(
          &ensure_liveview_react_vite_plugin(
            &1,
            ~s(import liveViewReactPlugin from "liveview_react/vite";),
            "liveview_react/vite",
            ~s|liveViewReactPlugin({ entrypoint: "./js/liveview_react_server.tsx" })|
          )
        )
      end)
    end

    defp update_required_file(igniter, path, updater) do
      Igniter.update_file(igniter, path, fn source ->
        source
        |> Source.get(:content)
        |> updater.()
        |> apply_updated_source(source)
      end)
    end

    defp configure_development_ssr(igniter) do
      igniter
      |> configure_exact(:ssr, true, Sourceror.parse_string!("true"))
      |> configure_exact(
        :ssr_module,
        {:code, Sourceror.parse_string!("LiveViewReact.SSR.ViteJS")},
        Sourceror.parse_string!("LiveViewReact.SSR.ViteJS")
      )
      |> configure_exact(
        :vite_host,
        "http://localhost:5173",
        Sourceror.parse_string!(~s("http://localhost:5173"))
      )
    end

    defp configure_exact(igniter, key, value, expected_ast) do
      IgniterConfig.configure(
        igniter,
        "dev.exs",
        :liveview_react,
        [key],
        value,
        updater: fn zipper ->
          if config_values_equal?(Zipper.node(zipper), expected_ast) do
            {:ok, zipper}
          else
            {:error,
             "config/dev.exs already configures :liveview_react, #{key}: " <>
               "refusing to overwrite it"}
          end
        end
      )
    end

    @doc false
    @spec config_values_equal?(Macro.t(), Macro.t()) :: boolean()
    def config_values_equal?(actual_ast, expected_ast) do
      Macro.to_string(actual_ast) == Macro.to_string(expected_ast)
    end

    defp maybe_install_demo(igniter, false, _router, _web_module), do: igniter

    defp maybe_install_demo(igniter, true, router, web_module) do
      demo_module = Module.concat(web_module, "LiveViewReactDemoLive")

      igniter
      |> ElixirInstaller.ensure_demo_module(demo_module)
      |> ElixirInstaller.ensure_demo_route(router, demo_module)
    end

    defp add_post_install_notices(igniter, demo?) do
      commands =
        if igniter.args.options[:bun] do
          "mix bun assets run typecheck\nmix bun assets run build:ssr"
        else
          "cd assets\nnpm run typecheck\nnpm run build:ssr"
        end

      igniter
      |> Igniter.add_notice(
        "PhoenixVite queues `mix assets.setup`; LiveViewReact does not run additional network commands."
      )
      |> Igniter.add_notice("Verify the generated TypeScript and SSR bundle:\n\n#{commands}")
      |> maybe_add_demo_notice(demo?)
    end

    defp maybe_add_demo_notice(igniter, true),
      do: Igniter.add_notice(igniter, "The demo is available at `/liveview-react`.")

    defp maybe_add_demo_notice(igniter, false), do: igniter

    defp keep_owned_file(igniter, path, desired) do
      case Rewrite.source(igniter.rewrite, path) do
        {:ok, source} ->
          keep_owned_source(igniter, path, desired, source)

        {:error, _error} ->
          Igniter.add_issue(igniter, "Could not read required file #{path}")
      end
    end

    defp keep_owned_source(igniter, path, desired, source) do
      case Source.get(source, :content) do
        ^desired ->
          igniter

        _current ->
          Igniter.add_issue(
            igniter,
            "Refusing to overwrite #{path}; it is not the LiveViewReact-owned template"
          )
      end
    end

    defp merge_live_socket_hooks_result({:ok, source}, hook_expression),
      do: JavaScript.merge_live_socket_hooks(source, hook_expression)

    defp merge_live_socket_hooks_result({:error, _message} = error, _hook_expression), do: error

    defp ensure_liveview_react_vite_plugin(
           {:ok, source},
           statement,
           module_specifier,
           expression
         ),
         do: JavaScript.ensure_vite_plugin(source, statement, module_specifier, expression)

    defp ensure_liveview_react_vite_plugin(
           {:error, _message} = error,
           _statement,
           _module_specifier,
           _expression
         ),
         do: error

    defp apply_updated_source({:ok, updated}, source),
      do: Source.update(source, :content, fn _content -> updated end)

    defp apply_updated_source({:error, errors}, _source), do: {:error, List.wrap(errors)}
  end
end
