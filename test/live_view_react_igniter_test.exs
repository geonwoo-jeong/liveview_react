defmodule LiveViewReact.IgniterTest do
  use ExUnit.Case, async: false

  alias Igniter.Mix.Task.Args
  alias LiveViewReact.Installer.Templates

  test "task declares the clean installer contract" do
    info = Mix.Tasks.LiveviewReact.Install.info([], nil)

    assert info.schema == [demo: :boolean]
    assert info.defaults == [demo: true]
    assert info.aliases == []
    assert info.installs == [{:phoenix_vite, "~> 0.5"}]
    assert info.example == "mix igniter.install liveview_react"
    refute Mix.Tasks.LiveviewReact.Install.supports_umbrella?()
    refute LiveViewReact.Igniter.supports_umbrella?()
  end

  test "detects an already configured phoenix_vite project before skipping the child installer" do
    configured_vite = """
    import { defineConfig } from "vite"
    import { phoenixVitePlugin } from "phoenix_vite"

    export default defineConfig({
      plugins: [phoenixVitePlugin({ pattern: /\\.(ex|heex)$/ })]
    })
    """

    assert Mix.Tasks.LiveviewReact.Install.phoenix_vite_already_configured?(
             [{:phoenix_vite, "~> 0.5"}],
             configured_vite
           )

    refute Mix.Tasks.LiveviewReact.Install.phoenix_vite_already_configured?(
             [{:phoenix_vite, "~> 0.5"}],
             ~s(import { defineConfig } from "vite")
           )

    refute Mix.Tasks.LiveviewReact.Install.phoenix_vite_already_configured?(
             [{:ecto, "~> 3.0"}],
             configured_vite
           )

    refute Mix.Tasks.LiveviewReact.Install.phoenix_vite_already_configured?(
             [{:phoenix_vite, "~> 0.5"}],
             """
             // import { phoenixVitePlugin } from "phoenix_vite"
             // phoenixVitePlugin({})
             export default { plugins: [] }
             """
           )

    refute Mix.Tasks.LiveviewReact.Install.phoenix_vite_already_configured?(
             [{:phoenix_vite, "~> 0.5"}],
             """
             import { phoenixVitePlugin } from "phoenix_vite"
             const helper = phoenixVitePlugin({})
             export default { plugins: [] }
             """
           )
  end

  test "configuration equality ignores parser location metadata" do
    actual = Sourceror.parse_string!("\n\n\"http://localhost:5173\"")
    expected = Sourceror.parse_string!(~s("http://localhost:5173"))

    assert LiveViewReact.Igniter.config_values_equal?(actual, expected)

    refute LiveViewReact.Igniter.config_values_equal?(
             actual,
             Sourceror.parse_string!(~s("http://localhost:5174"))
           )
  end

  @tag :tmp_dir
  test "configured task skips PhoenixVite composition without dropping Bun flags", %{
    tmp_dir: tmp_dir
  } do
    config_path = Path.join([tmp_dir, "assets", "vite.config.mjs"])
    File.mkdir_p!(Path.dirname(config_path))

    File.write!(config_path, """
    import { phoenixVitePlugin } from 'phoenix_vite'
    export default { plugins: [phoenixVitePlugin({})] }
    """)

    File.cd!(tmp_dir, fn ->
      info = Mix.Tasks.LiveviewReact.Install.info(["--bun"], nil)

      assert info.schema == [demo: :boolean, bun: :boolean]
      assert info.defaults == [demo: true, bun: false]
      assert info.aliases == [b: :bun]
      assert info.installs == []
    end)
  end

  test "installs into a PhoenixVite project and is byte-idempotent on a second pass" do
    phoenix_vite = phoenix_vite_project()

    assert source(phoenix_vite, "lib/demo_web.ex") =~
             "statics: DemoWeb.static_paths()"

    installed = run_installer(phoenix_vite, demo: true)

    assert installed.issues == []
    assert source(installed, "assets/js/liveview_react.ts") == Templates.client_entrypoint()

    assert source(installed, "assets/vite.liveview-react.ssr.config.mjs") ==
             Templates.ssr_vite_config()

    package = installed |> source("assets/package.json") |> Jason.decode!()
    assert package["dependencies"]["liveview_react"] == "^0.1.0"
    assert package["devDependencies"]["vite"] == "^8.0.0"
    assert package["devDependencies"]["@types/react"] == "^19.0.0"

    app = source(installed, "assets/js/app.js")
    assert app =~ ~s(import { liveViewReact } from "./liveview_react";)
    assert app =~ "...liveViewReact.hooks"

    vite = source(installed, "assets/vite.config.mjs")
    assert vite =~ ~s(import react from "@vitejs/plugin-react";)
    assert vite =~ ~s(import liveViewReactPlugin from "liveview_react/vite";)
    assert vite =~ "react()"
    assert vite =~ "liveViewReactPlugin"
    assert vite =~ "tailwindcss()"

    web = source(installed, "lib/demo_web.ex")
    assert count(web, "import LiveViewReact") == 1
    assert web =~ "statics: DemoWeb.static_paths()"

    route = source(installed, "lib/demo_web/router.ex")
    assert count(route, ~s(live "/liveview-react")) == 1
    assert route =~ ~s(live "/liveview-react", LiveViewReactDemoLive, :index)
    refute route =~ ~s(live "/liveview-react", DemoWeb.LiveViewReactDemoLive, :index)

    demo_live = source(installed, "lib/demo_web/live/live_view_react_demo_live.ex")
    assert demo_live =~ ~s(component="LiveViewReactDemo")
    assert demo_live =~ ~s|r-on:increment={Phoenix.LiveView.JS.push("increment")}|

    dev = source(installed, "config/dev.exs")
    assert dev =~ "config :liveview_react"
    assert dev =~ "ssr: true"
    assert dev =~ "ssr_module: LiveViewReact.SSR.ViteJS"
    assert dev =~ ~s(vite_host: "http://localhost:5173")

    assert Enum.any?(installed.notices, &String.contains?(&1, "npm run typecheck"))
    refute Enum.any?(installed.tasks, fn task -> elem(task, 0) == "typecheck" end)

    assert {:ok, applied, _metadata} = Igniter.Test.apply_igniter(installed)
    second_pass = run_installer(applied, demo: true)
    assert second_pass.issues == []
    assert Igniter.Test.diff(second_pass) == ""
  end

  test "no-demo omits the demo component, LiveView, route, and notice" do
    installed = phoenix_vite_project() |> run_installer(demo: false)

    assert installed.issues == []
    refute Igniter.exists?(installed, "assets/react-components/LiveViewReactDemo.tsx")
    refute Igniter.exists?(installed, "lib/demo_web/live/live_view_react_demo_live.ex")
    refute source(installed, "lib/demo_web/router.ex") =~ "/liveview-react"
    refute Enum.any?(installed.notices, &String.contains?(&1, "demo is available"))
  end

  test "preserves an incompatible dev SSR configuration and reports an issue" do
    project =
      phoenix_vite_project()
      |> append("config/dev.exs", "\nconfig :liveview_react, ssr: false\n")
      |> run_installer(demo: false)

    assert {:error, issues} = Igniter.Test.apply_igniter(project)
    assert Enum.any?(issues, &String.contains?(&1, "refusing to overwrite"))
    dev = source(project, "config/dev.exs")
    assert dev =~ "config :liveview_react"
    assert dev =~ "ssr: false"
  end

  test "does not overwrite an owned file or incompatible package version" do
    custom_file =
      phoenix_vite_project()
      |> Igniter.create_new_file("assets/js/liveview_react.ts", "export const custom = true;\n")
      |> run_installer(demo: false)

    assert Enum.any?(custom_file.issues, &String.contains?(&1, "Refusing to overwrite"))
    assert source(custom_file, "assets/js/liveview_react.ts") == "export const custom = true;\n"

    incompatible =
      phoenix_vite_project()
      |> replace("assets/package.json", "^6.3.0", "^6.2.0")
      |> run_installer(demo: false)

    assert {:error, issues} = Igniter.Test.apply_igniter(incompatible)
    assert Enum.any?(issues, &String.contains?(&1, "expected ^8.0.0"))
    assert source(incompatible, "assets/package.json") =~ "^6.2.0"
  end

  test "rejects an existing route owned by another module with the same basename" do
    installed =
      phoenix_vite_project()
      |> replace(
        "lib/demo_web/router.ex",
        ~s|get("/", PageController, :home)|,
        ~s|live("/liveview-react", Other.LiveViewReactDemoLive, :index)|
      )
      |> run_installer(demo: true)

    assert {:error, issues} = Igniter.Test.apply_igniter(installed)
    assert Enum.any?(issues, &String.contains?(&1, "conflicting /liveview-react route"))
    assert source(installed, "lib/demo_web/router.ex") =~ "Other.LiveViewReactDemoLive"
  end

  test "selected child application paths are relative and do not target sibling apps" do
    installed = phoenix_vite_project(:child_app) |> run_installer(demo: true)

    assert installed.issues == []
    assert Igniter.exists?(installed, "lib/child_app_web/live/live_view_react_demo_live.ex")
    refute Enum.any?(Rewrite.sources(installed.rewrite), &String.starts_with?(&1.path, "apps/"))
  end

  test "inserts a fully-qualified demo route when the browser scope has no alias" do
    installed =
      phoenix_vite_project()
      |> replace("lib/demo_web/router.ex", ~s(scope "/", DemoWeb do), ~s(scope "/" do))
      |> run_installer(demo: true)

    assert installed.issues == []

    assert source(installed, "lib/demo_web/router.ex") =~
             ~s(live "/liveview-react", DemoWeb.LiveViewReactDemoLive, :index)
  end

  test "uses the scoped alias for the demo route when the browser scope has an alias" do
    installed = phoenix_vite_project() |> run_installer(demo: true)

    assert installed.issues == []

    assert source(installed, "lib/demo_web/router.ex") =~
             ~s(live "/liveview-react", LiveViewReactDemoLive, :index)
  end

  test "rejects an existing liveview-react route that points at another module" do
    installed =
      phoenix_vite_project()
      |> replace(
        "lib/demo_web/router.ex",
        """
        pipe_through(:browser)

            get("/", PageController, :home)
        """,
        """
        pipe_through(:browser)

            live "/liveview-react", Admin.LiveViewReactDemoLive, :index
        """
      )
      |> run_installer(demo: true)

    assert {:error, issues} = Igniter.Test.apply_igniter(installed)
    assert Enum.any?(issues, &String.contains?(&1, "conflicting /liveview-react route"))

    assert source(installed, "lib/demo_web/router.ex") =~
             ~s(live "/liveview-react", Admin.LiveViewReactDemoLive, :index)
  end

  test "refuses to guess when only a nested child scope pipes through browser" do
    nested_scope = """
    scope "/nested", DemoWeb do
      pipe_through(:browser)

      get("/", PageController, :home)
    end
    """

    installed =
      phoenix_vite_project()
      |> replace("lib/demo_web/router.ex", "    pipe_through(:browser)\n\n", "")
      |> replace("lib/demo_web/router.ex", ~s|get("/", PageController, :home)|, nested_scope)
      |> run_installer(demo: true)

    assert {:error, issues} = Igniter.Test.apply_igniter(installed)

    assert Enum.any?(
             issues,
             &String.contains?(
               &1,
               "Could not find a root Phoenix scope that pipes through :browser"
             )
           )

    refute source(installed, "lib/demo_web/router.ex") =~
             ~s(live "/liveview-react", DemoWeb.LiveViewReactDemoLive, :index)
  end

  defp phoenix_vite_project(app_name \\ :demo) do
    Igniter.Test.phx_test_project(app_name: app_name)
    |> Map.put(:args, %Args{options: [bun: false]})
    |> Igniter.compose_task("phoenix_vite.install", [])
  end

  defp run_installer(igniter, options) do
    igniter
    |> Map.put(:args, %Args{options: Keyword.put_new(options, :bun, false)})
    |> LiveViewReact.Igniter.install(options)
  end

  defp source(igniter, path) do
    igniter = Igniter.include_existing_file(igniter, path, required?: true)

    igniter.rewrite
    |> Rewrite.source!(path)
    |> Rewrite.Source.get(:content)
  end

  defp append(igniter, path, suffix) do
    Igniter.update_file(igniter, path, fn source ->
      Rewrite.Source.update(source, :content, &(&1 <> suffix))
    end)
  end

  defp replace(igniter, path, pattern, replacement) do
    Igniter.update_file(igniter, path, fn source ->
      Rewrite.Source.update(source, :content, &String.replace(&1, pattern, replacement))
    end)
  end

  defp count(source, pattern), do: source |> :binary.matches(pattern) |> length()
end
