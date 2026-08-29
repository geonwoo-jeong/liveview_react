defmodule LiveViewReact.Installer.PackageJSONTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.Installer.PackageJSON

  test "merges required packages and scripts without dropping unrelated content" do
    source =
      Jason.encode!(%{
        "name" => "custom-assets",
        "private" => true,
        "dependencies" => %{"phoenix" => "file:../deps/phoenix", "react" => "^19.1.0"},
        "devDependencies" => %{"custom-tool" => "^3.0.0", "vite" => "^6.3.0"},
        "scripts" => %{"lint" => "eslint ."},
        "custom" => %{"retained" => true}
      })

    assert {:ok, updated} = PackageJSON.merge(source)
    package = Jason.decode!(updated)

    assert package["name"] == "custom-assets"
    assert package["custom"] == %{"retained" => true}
    assert package["dependencies"]["phoenix"] == "file:../deps/phoenix"
    assert package["dependencies"]["react"] == "^19.1.0"
    assert package["dependencies"]["react-dom"] == "^19.0.0"
    assert package["dependencies"]["liveview_react"] == "^0.1.0"
    assert package["devDependencies"]["vite"] == "^8.0.0"
    assert package["devDependencies"]["@vitejs/plugin-react"] == "^6.0.0"
    assert package["devDependencies"]["@types/react"] == "^19.0.0"
    assert package["devDependencies"]["@types/react-dom"] == "^19.0.0"
    assert package["devDependencies"]["typescript"] == "^7.0.0"
    assert package["devDependencies"]["custom-tool"] == "^3.0.0"
    assert package["scripts"]["lint"] == "eslint ."
    assert package["scripts"]["typecheck"] == "tsc --noEmit"

    assert package["scripts"]["build:ssr"] ==
             "vite build --config vite.liveview-react.ssr.config.mjs"

    assert PackageJSON.merge(updated) == {:ok, updated}
  end

  test "preserves compatible versions in either dependency section" do
    source =
      Jason.encode!(%{
        "dependencies" => %{
          "@vitejs/plugin-react" => "~6.1.0",
          "liveview_react" => "~0.1.4",
          "react" => "19.2.0",
          "react-dom" => "^19.2.0",
          "typescript" => "^7.1.0",
          "vite" => ">=8.0.0 <9"
        },
        "devDependencies" => %{
          "@types/react" => "^19.1.0",
          "@types/react-dom" => "19.1.0"
        }
      })

    assert {:ok, updated} = PackageJSON.merge(source)
    package = Jason.decode!(updated)
    assert package["dependencies"]["vite"] == ">=8.0.0 <9"
    assert package["dependencies"]["@vitejs/plugin-react"] == "~6.1.0"
  end

  test "rejects incompatible versions except PhoenixVite's exact generated Vite default" do
    for {name, version} <- [
          {"react", "^18.3.0"},
          {"vite", "^6.2.0"},
          {"typescript", "workspace:*"},
          {"liveview_react", "^0.2.0"}
        ] do
      section =
        if name in ["react", "liveview_react"], do: "dependencies", else: "devDependencies"

      source = Jason.encode!(%{section => %{name => version}})

      assert {:error, [message]} = PackageJSON.merge(source)
      assert message =~ name
      assert message =~ "refusing to overwrite"
    end
  end

  test "rejects duplicate dependency locations and conflicting scripts atomically" do
    duplicate =
      Jason.encode!(%{
        "dependencies" => %{"react" => "^19.0.0"},
        "devDependencies" => %{"react" => "^19.0.0"}
      })

    assert {:error, [message]} = PackageJSON.merge(duplicate)
    assert message =~ "both dependencies and devDependencies"

    script_conflict = Jason.encode!(%{"scripts" => %{"typecheck" => "custom-check"}})
    assert {:error, [message]} = PackageJSON.merge(script_conflict)
    assert message =~ "refusing to overwrite"
    assert message =~ "custom-check"
  end

  test "rejects malformed package JSON and non-object structural fields" do
    assert {:error, [message]} = PackageJSON.merge("[")
    assert message =~ "invalid JSON"

    assert {:error, [message]} = PackageJSON.merge(~s({"dependencies": []}))
    assert message =~ "dependencies must be objects"
  end
end
