defmodule LiveViewReact.Installer.TypeScriptConfigTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.Installer.JSONC
  alias LiveViewReact.Installer.TypeScriptConfig

  @phoenix_default """
  // This file is needed on most editors to enable the intelligent autocompletion
  // of LiveView's JavaScript API methods. You can safely delete it if you don't need it.
  //
  // Note: This file assumes a basic esbuild setup without node_modules.
  // We include a generic paths alias to deps to mimic how esbuild resolves
  // the Phoenix and LiveView JavaScript assets.
  // If you have a package.json in your project, you should remove the
  // paths configuration and instead add the phoenix dependencies to the
  // dependencies section of your package.json:
  //
  // {
  //   ...
  //   "dependencies": {
  //     ...,
  //     "phoenix": "../deps/phoenix",
  //     "phoenix_html": "../deps/phoenix_html",
  //     "phoenix_live_view": "../deps/phoenix_live_view"
  //   }
  // }
  //
  // Feel free to adjust this configuration however you need.
  {
    "compilerOptions": {
      "baseUrl": ".",
      "paths": {
        "*": ["../deps/*"],
      },
      "allowJs": true,
      "noEmit": true,
    },
    "include": ["js/**/*"],
  }
  """

  test "merges the commented Phoenix JSONC default and preserves comments" do
    assert {:ok, updated} = TypeScriptConfig.merge(@phoenix_default)

    for comment <- @phoenix_default |> String.split("\n") |> Enum.filter(&(&1 =~ ~r/^\/\//)) do
      assert updated =~ comment
    end

    assert {:ok, root} = JSONC.parse(updated)
    assert {:ok, compiler} = JSONC.fetch(root, ["compilerOptions"])
    options = JSONC.term(compiler)

    assert options["target"] == "ES2022"
    assert options["module"] == "ESNext"
    assert options["moduleResolution"] == "Bundler"
    refute Map.has_key?(options, "baseUrl")
    assert options["strict"] == true
    assert options["isolatedModules"] == true
    assert options["jsx"] == "react-jsx"
    assert options["types"] == ["vite/client"]
    refute Map.has_key?(options, "paths")

    assert {:ok, include} = JSONC.fetch(root, ["include"])
    assert JSONC.term(include) == ["js/**/*", "react-components/**/*"]
    assert TypeScriptConfig.merge(updated) == {:ok, updated}
  end

  test "preserves custom options, path aliases, types, and include entries" do
    source = """
    {
      "compilerOptions": {
        "target": "ESNext",
        "module": "Preserve",
        "moduleResolution": "Bundler",
        "allowJs": true,
        "noEmit": true,
        "isolatedModules": true,
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "jsx": "react-jsxdev",
        "types": ["node"],
        "paths": {"@/*": ["./src/*"]},
        "customConditions": ["browser"]
      },
      "include": ["custom/**/*"]
    }
    """

    assert {:ok, updated} = TypeScriptConfig.merge(source)
    assert {:ok, root} = JSONC.parse(updated)
    assert {:ok, compiler} = JSONC.fetch(root, ["compilerOptions"])
    options = JSONC.term(compiler)

    assert options["paths"] == %{"@/*" => ["./src/*"]}
    assert options["customConditions"] == ["browser"]
    assert options["types"] == ["node", "vite/client"]

    assert {:ok, include} = JSONC.fetch(root, ["include"])
    assert JSONC.term(include) == ["custom/**/*", "js/**/*", "react-components/**/*"]
  end

  test "fails closed on incompatible custom compiler settings" do
    source = ~s({"compilerOptions":{"target":"ES5"},"include":[]})

    assert {:error, [message]} = TypeScriptConfig.merge(source)
    assert message =~ "compilerOptions.target"
    assert message =~ "ES5"
  end

  test "rejects a custom baseUrl because TypeScript 7 removed it" do
    source = ~s({"compilerOptions":{"baseUrl":"./src"},"include":[]})

    assert {:error, [message]} = TypeScriptConfig.merge(source)
    assert message =~ "compilerOptions.baseUrl"
    assert message =~ "TypeScript 7 removed baseUrl"
  end

  test "preserves adjacent comments and rejects generated baseUrl with custom paths" do
    generated = """
    {
      "compilerOptions": {
        // keep the baseUrl note
        "baseUrl": ".",
        // keep the paths note
        "paths": {"*": ["../deps/*"]},
        // keep the allowJs note
        "allowJs": true
      },
      "include": ["js/**/*"]
    }
    """

    assert {:ok, updated} = TypeScriptConfig.merge(generated)
    assert updated =~ "// keep the baseUrl note"
    assert updated =~ "// keep the paths note"
    assert updated =~ "// keep the allowJs note"

    custom = ~s({"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}},"include":[]})
    assert {:error, [message]} = TypeScriptConfig.merge(custom)
    assert message =~ "custom paths"
    assert message =~ "refusing to change"
  end

  test "rejects malformed JSONC and duplicate structural properties" do
    assert {:error, [message]} = TypeScriptConfig.merge("{")
    assert message =~ "invalid"

    duplicate = ~s({"compilerOptions":{},"compilerOptions":{},"include":[]})
    assert {:error, [message]} = TypeScriptConfig.merge(duplicate)
    assert message =~ "duplicate"
  end

  test "rejects missing commas between JSONC members" do
    assert {:error, object_message} = JSONC.parse(~s({"first": true "second": false}))
    assert object_message =~ "object properties must be separated by commas"

    assert {:error, array_message} = JSONC.parse(~s(["first" "second"]))
    assert array_message =~ "array items must be separated by commas"
  end
end
