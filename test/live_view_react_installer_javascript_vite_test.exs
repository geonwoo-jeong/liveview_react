defmodule LiveViewReact.Installer.JavaScriptViteTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.Installer.JavaScript

  @vite_import ~s|import liveViewReact from "liveview_react/vite"|
  @vite_module "liveview_react/vite"
  @plugin_expression "liveViewReact()"

  test "inserts the import and plugin into one multiline plugins array" do
    source = """
    import { defineConfig } from "vite"
    import react from "@vitejs/plugin-react"

    export default defineConfig({
      plugins: [
        react(),
      ],
    })
    """

    assert {:ok, updated} = ensure_plugin(source)
    assert updated =~ "#{@vite_import}\n\nexport default"
    assert updated =~ "react(),\n    liveViewReact(),"
    assert {:ok, ^updated} = ensure_plugin(updated)
  end

  test "supports empty inline arrays and adds only the missing import" do
    source = "export default { plugins: [] }\n"

    assert {:ok, updated} = ensure_plugin(source)

    assert updated ==
             "#{@vite_import}\nexport default { plugins: [ liveViewReact() ] }\n"

    plugin_present = """
    export default { plugins: [liveViewReact()] }
    """

    assert {:ok, imported} = ensure_plugin(plugin_present)
    assert imported =~ @vite_import
    assert length(Regex.scan(~r/liveViewReact\(\)/, imported)) == 1
  end

  test "preserves CRLF formatting in Vite config arrays" do
    source =
      "import react from \"@vitejs/plugin-react\"\r\n\r\n" <>
        "export default {\r\n  plugins: [\r\n    react(),\r\n  ],\r\n}\r\n"

    assert {:ok, updated} = ensure_plugin(source)
    assert updated =~ "react(),\r\n    liveViewReact(),\r\n"
    refute String.contains?(String.replace(updated, "\r\n", ""), "\n")
  end

  test "ignores property and plugin decoys in comments, strings, and templates" do
    source = ~S'''
    const text = "plugins: [liveViewReact()]"
    const template = `plugins: [${`liveViewReact()`}]`
    // plugins: [liveViewReact()]
    export default {plugins: [react()]}
    '''

    assert {:ok, updated} = ensure_plugin(source)
    assert updated =~ "plugins: [react(), liveViewReact()]"
  end

  test "rejects ambiguous, non-array, and malformed plugin configurations" do
    cases = [
      {"export default {}", "found none"},
      {"export default {plugins: resolvePlugins()}", "direct array literal"},
      {"export default {plugins: [], nested: {plugins: []}}", "found multiple"},
      {"export default {plugins: [react()}", "mismatched JavaScript delimiters"}
    ]

    for {source, expected} <- cases do
      assert {:error, message} = ensure_plugin(source)
      assert message =~ expected
    end
  end

  test "rejects an import conflict and unsafe multi-expression plugin input" do
    source = """
    import { other } from "liveview_react/vite"
    export default {plugins: []}
    """

    assert {:error, message} = ensure_plugin(source)
    assert message =~ "different binding"

    assert {:error, message} =
             JavaScript.ensure_vite_plugin(
               "export default {plugins: []}",
               @vite_import,
               @vite_module,
               "liveViewReact(), evil()"
             )

    assert message =~ "one expression"
  end

  test "rejects a conflicting plugin call with the same callee" do
    source = """
    import liveViewReact from "liveview_react/vite"
    export default {
      plugins: [liveViewReact({ custom: true })]
    }
    """

    assert {:error, message} = ensure_plugin(source)
    assert message =~ "different expression"
  end

  test "adds React dedupe to a direct Vite config and is byte-idempotent" do
    source = """
    import { defineConfig } from "vite"

    export default defineConfig({
      plugins: [],
    })
    """

    assert {:ok, updated} = JavaScript.ensure_vite_react_dedupe(source)
    assert updated =~ ~s(resolve: { dedupe: ["react", "react-dom"] })
    assert {:ok, ^updated} = JavaScript.ensure_vite_react_dedupe(updated)
  end

  test "merges React dedupe into existing literal resolve configuration" do
    source = """
    export default {
      plugins: [],
      resolve: {
        alias: { "@": "/src" },
        dedupe: [
          "phoenix",
          "react",
        ],
      },
    }
    """

    assert {:ok, updated} = JavaScript.ensure_vite_react_dedupe(source)
    assert updated =~ ~s(alias: { "@": "/src" })
    assert updated =~ ~s("phoenix")
    assert length(Regex.scan(~r/["']react["']/, updated)) == 1
    assert length(Regex.scan(~r/["']react-dom["']/, updated)) == 1
    assert {:ok, ^updated} = JavaScript.ensure_vite_react_dedupe(updated)

    without_dedupe = "export default { plugins: [], resolve: { alias: {} } }\n"
    assert {:ok, added} = JavaScript.ensure_vite_react_dedupe(without_dedupe)
    assert added =~ ~s(resolve: { alias: {}, dedupe: ["react", "react-dom"] })
  end

  test "fails closed for dynamic or ambiguous Vite resolve configuration" do
    cases = [
      {"const config = { plugins: [] }; export default config", "found none"},
      {"export default defineConfig({ plugins: [] }, env)", "found none"},
      {"export default { plugins: [], resolve: makeResolve() }", "direct object literal"},
      {"export default { plugins: [], resolve: { dedupe: values } }", "direct array literal"},
      {"export default { plugins: [], resolve: { dedupe: [...values] } }",
       "only unescaped string literals"},
      {~s(export default { resolve: { dedupe: ["react", "react-dom"] }, ...config }),
       "must not contain spread properties"},
      {~s(export default { resolve: { dedupe: ["react", "react-dom"], ...resolve } }),
       "must not contain spread properties"},
      {~s(export default { plugins: [], resolve: { dedupe: ["react", "react"] } }),
       "multiple times"},
      {"export default { plugins: [], resolve: {}, resolve: {} }", "multiple resolve"},
      {"export default { plugins: [], resolve: { dedupe: [], dedupe: [] } }", "multiple dedupe"}
    ]

    for {source, expected} <- cases do
      assert {:error, message} = JavaScript.ensure_vite_react_dedupe(source)
      assert message =~ expected
    end
  end

  defp ensure_plugin(source) do
    JavaScript.ensure_vite_plugin(
      source,
      @vite_import,
      @vite_module,
      @plugin_expression
    )
  end
end
