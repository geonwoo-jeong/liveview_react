defmodule LiveViewReact.Installer.JavaScriptTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.Installer.JavaScript

  @hooks_import ~s|import { liveViewReactHooks } from "liveview_react"|
  @hooks_module "liveview_react"
  @hook_expression "liveViewReactHooks"

  describe "ensure_import/3" do
    test "inserts after the leading shebang, comments, and import block" do
      source = """
      #!/usr/bin/env node
      // generated entrypoint
      import "phoenix_html"
      /* socket imports */
      import {LiveSocket} from "phoenix_live_view"

      const socket = connect()
      """

      assert {:ok, updated} =
               JavaScript.ensure_import(source, @hooks_import, @hooks_module)

      assert updated =~ "/* socket imports */"

      assert updated =~
               ~s|import {LiveSocket} from "phoenix_live_view"\n#{@hooks_import}\n\nconst socket|
    end

    test "treats whitespace, comments, quote style, and semicolons as normalized equality" do
      source = """
      import {
        liveViewReactHooks /* keep */
      } from 'liveview_react';
      const ready = true
      """

      assert {:ok, ^source} =
               JavaScript.ensure_import(source, @hooks_import, @hooks_module)
    end

    test "rejects a different existing default, named, or aliased binding from the module" do
      conflicting_imports = [
        ~s|import liveviewReact from "liveview_react"|,
        ~s|import { createLiveViewReact } from "liveview_react"|,
        ~s|import { liveViewReactHooks as hooks } from "liveview_react"|
      ]

      for existing <- conflicting_imports do
        source = existing <> "\nconst ready = true\n"

        assert {:error, message} =
                 JavaScript.ensure_import(source, @hooks_import, @hooks_module)

        assert message =~ "different binding"
        assert source == existing <> "\nconst ready = true\n"
      end
    end

    test "rejects duplicate imports from the requested module" do
      source = """
      #{@hooks_import}
      import { createLiveViewReact } from "liveview_react"
      """

      assert {:error, message} =
               JavaScript.ensure_import(source, @hooks_import, @hooks_module)

      assert message =~ "multiple static imports"
    end

    test "ignores import-shaped text in comments, strings, and nested templates" do
      source = ~S'''
      // import { liveViewReactHooks } from "liveview_react"
      const one = "import { liveViewReactHooks } from 'liveview_react'"
      const two = `outer ${`inner ${"import x from 'liveview_react'"}`}`
      boot()
      '''

      assert {:ok, updated} =
               JavaScript.ensure_import(source, @hooks_import, @hooks_module)

      assert updated =~ @hooks_import
      assert updated =~ ~S|`outer ${`inner ${"import x from 'liveview_react'"}`}`|
      assert updated =~ "#{@hooks_import}\nconst one"
    end

    test "does not mistake nested object keys or dynamic imports for static imports" do
      source = """
      const keywords = {import: "ordinary property"}
      const lazy = () => import("./lazy")
      """

      assert {:ok, updated} =
               JavaScript.ensure_import(source, @hooks_import, @hooks_module)

      assert updated =~ "#{@hooks_import}\nconst keywords"
      assert updated =~ ~s|{import: "ordinary property"}|
      assert updated =~ ~s|import("./lazy")|
    end

    test "validates the requested import and fails closed on malformed source" do
      assert {:error, message} =
               JavaScript.ensure_import(
                 "const value = {\n",
                 @hooks_import,
                 @hooks_module
               )

      assert message =~ "unclosed JavaScript delimiter"

      assert {:error, message} =
               JavaScript.ensure_import("", ~s|import {x} from "other"|, @hooks_module)

      assert message =~ "does not match"

      assert {:error, message} =
               JavaScript.ensure_import("", @hooks_import <> "; run()", @hooks_module)

      assert message =~ "unsupported trailing syntax"
    end

    test "preserves CRLF line endings for inserted imports" do
      source = "import \"phoenix_html\"\r\n\r\nboot()\r\n"

      assert {:ok, updated} =
               JavaScript.ensure_import(source, @hooks_import, @hooks_module)

      assert updated =~ "#{@hooks_import}\r\n\r\nboot()"
      refute String.contains?(String.replace(updated, "\r\n", ""), "\n")
    end

    test "returns errors instead of raising for invalid public inputs" do
      assert {:error, _message} = JavaScript.ensure_import(:source, @hooks_import, @hooks_module)
      assert {:error, _message} = JavaScript.ensure_import("", :import, @hooks_module)
      assert {:error, _message} = JavaScript.ensure_import("", @hooks_import, :module)
      assert {:error, _message} = JavaScript.ensure_import(<<255>>, @hooks_import, @hooks_module)
      assert {:error, _message} = JavaScript.ensure_import(<<0>>, @hooks_import, @hooks_module)
      assert {:error, _message} = JavaScript.merge_live_socket_hooks("", :hooks)

      assert {:error, _message} =
               JavaScript.ensure_vite_plugin("", @hooks_import, @hooks_module, :plugin)
    end
  end

  describe "merge_live_socket_hooks/2" do
    test "updates a Phoenix 1.8-style entrypoint without disturbing surrounding source" do
      source = phoenix_1_8_app_js()

      assert {:ok, updated} =
               JavaScript.merge_live_socket_hooks(source, @hook_expression)

      assert updated =~ ~r/hooks: \{\.\.\.colocatedHooks, \.\.\.liveViewReactHooks\s*\}/
      assert updated =~ "longPollFallbackMs: 2500"
      assert updated =~ "params: {_csrf_token: csrfToken}"
      assert updated =~ "if (process.env.NODE_ENV === \"development\") {"
      assert updated =~ "// expose debug helpers only in development"

      assert updated =~
               "window.addEventListener(\"phx:page-loading-start\", () => topbar.show())"

      assert String.replace(updated, ~r/hooks: \{.*?\}/, "hooks: ORIGINAL") ==
               String.replace(source, "hooks: {...colocatedHooks}", "hooks: ORIGINAL")
    end

    test "adds hooks when the options object has none and is idempotent" do
      source = """
      const liveSocket = new LiveSocket("/live", Socket, {
        params: {_csrf_token: csrfToken},
      })
      """

      assert {:ok, once} = JavaScript.merge_live_socket_hooks(source, @hook_expression)
      assert once =~ "hooks: { ...liveViewReactHooks },"
      assert {:ok, ^once} = JavaScript.merge_live_socket_hooks(once, @hook_expression)
    end

    test "accepts a trailing constructor argument comma" do
      source = """
      const liveSocket = new LiveSocket(
        "/live",
        Socket,
        {params: {_csrf_token: csrfToken}},
      )
      """

      assert {:ok, updated} =
               JavaScript.merge_live_socket_hooks(source, @hook_expression)

      assert updated =~ "hooks: { ...liveViewReactHooks }"
    end

    test "extends object-literal hooks once while preserving its members and comments" do
      source = """
      new LiveSocket("/live", Socket, {
        hooks: {
          Existing,
          // a colocated spread
          ...colocatedHooks,
        },
      })
      """

      assert {:ok, once} = JavaScript.merge_live_socket_hooks(source, @hook_expression)
      assert once =~ "Existing"
      assert once =~ "// a colocated spread"
      assert once =~ "...colocatedHooks"
      assert once =~ "...liveViewReactHooks,"
      assert {:ok, ^once} = JavaScript.merge_live_socket_hooks(once, @hook_expression)
    end

    test "wraps a general hooks expression without dropping it" do
      source =
        ~s|const liveSocket = new LiveSocket("/live", Socket, {hooks: resolveHooks(env)})|

      assert {:ok, updated} =
               JavaScript.merge_live_socket_hooks(source, @hook_expression)

      assert updated ==
               ~s|const liveSocket = new LiveSocket("/live", Socket, {hooks: { ...(resolveHooks(env)), ...liveViewReactHooks }})|
    end

    test "ignores call-shaped decoys in comments, strings, regexes, and nested templates" do
      source = ~S'''
      // new LiveSocket("/comment", Socket, {})
      const text = "new LiveSocket('/string', Socket, {})"
      const template = `outer ${`inner ${"new LiveSocket('/template', Socket, {})"}`}`
      const pattern = /new LiveSocket\("\/regex"/g
      const liveSocket = new LiveSocket("/live", Socket, {hooks: existingHooks})
      '''

      assert {:ok, updated} =
               JavaScript.merge_live_socket_hooks(source, @hook_expression)

      assert updated =~ "hooks: { ...(existingHooks), ...liveViewReactHooks }"
      assert updated =~ ~S|`outer ${`inner ${"new LiveSocket('/template', Socket, {})"}`}`|
      assert updated =~ ~S|/new LiveSocket\("\/regex"/g|
    end

    test "rejects zero or multiple executable calls" do
      assert {:error, message} =
               JavaScript.merge_live_socket_hooks("const socket = null", @hook_expression)

      assert message =~ "found none"

      source = """
      new LiveSocket("/one", Socket, {})
      new LiveSocket("/two", Socket, {})
      """

      assert {:error, message} =
               JavaScript.merge_live_socket_hooks(source, @hook_expression)

      assert message =~ "found multiple"
    end

    test "rejects missing, indirect, duplicate, or malformed options" do
      cases = [
        {~s|new LiveSocket("/live", Socket)|, "exactly three arguments"},
        {~s|new LiveSocket("/live", Socket, options)|, "direct object literal"},
        {~s|new LiveSocket("/live", Socket, {hooks: one, hooks: two})|,
         "multiple hooks properties"},
        {~s|new LiveSocket("/live", Socket, {hooks})|, "explicit property value"},
        {~s|new LiveSocket("/live", Socket, {hooks: {)|, "mismatched JavaScript delimiters"}
      ]

      for {source, expected} <- cases do
        assert {:error, message} =
                 JavaScript.merge_live_socket_hooks(source, @hook_expression)

        assert message =~ expected
      end
    end

    test "rejects statement injection and prototype-like hook expressions" do
      source = ~s|new LiveSocket("/live", Socket, {})|

      assert {:error, message} =
               JavaScript.merge_live_socket_hooks(source, "hooks; globalThis.pwned()")

      assert message =~ "top-level semicolon"

      assert {:error, message} =
               JavaScript.merge_live_socket_hooks(source, "hooks // consume insertion")

      assert message =~ "must not contain comments"

      for name <- ~w(__proto__ constructor prototype) do
        assert {:error, message} = JavaScript.merge_live_socket_hooks(source, name)
        assert message =~ "reserved prototype name"
      end
    end
  end

  defp phoenix_1_8_app_js do
    """
    // Include phoenix_html to handle method=PUT/DELETE in forms and buttons.
    import "phoenix_html"
    import {Socket} from "phoenix"
    import {LiveSocket} from "phoenix_live_view"
    import {hooks as colocatedHooks} from "phoenix-colocated/demo"
    import topbar from "../vendor/topbar"

    const csrfToken = document.querySelector("meta[name='csrf-token']").getAttribute("content")
    const liveSocket = new LiveSocket("/live", Socket, {
      longPollFallbackMs: 2500,
      params: {_csrf_token: csrfToken},
      hooks: {...colocatedHooks},
    })

    // Show progress bar on live navigation and form submits
    window.addEventListener("phx:page-loading-start", () => topbar.show())
    window.addEventListener("phx:page-loading-stop", () => topbar.hide())

    liveSocket.connect()
    window.liveSocket = liveSocket

    if (process.env.NODE_ENV === "development") {
      // expose debug helpers only in development
      window.liveSocket.enableDebug()
    }
    """
  end
end
