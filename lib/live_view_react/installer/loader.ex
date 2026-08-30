defmodule LiveViewReact.Installer.Loader do
  @moduledoc false

  @required_modules [
    "Igniter.Code.Common",
    "Igniter.Libs.Phoenix",
    "Igniter.Mix.Task",
    "Igniter.Project.Config",
    "Igniter.Project.Module",
    "Rewrite.Source",
    "Sourceror.Zipper"
  ]
  @installer_files ["elixir.exs", "igniter.exs"]

  @spec load!() :: :ok
  def load! do
    case unavailable_modules() do
      [] -> load_installer_files()
      modules -> raise_unavailable!(modules)
    end
  end

  defp unavailable_modules do
    Enum.reject(@required_modules, fn name ->
      name
      |> module_from_name()
      |> Code.ensure_loaded?()
    end)
  end

  defp load_installer_files do
    Enum.each(@installer_files, fn file ->
      :liveview_react
      |> Application.app_dir(["priv", "installer", file])
      |> Code.require_file()
    end)

    :ok
  end

  @spec raise_unavailable!([String.t()]) :: no_return()
  defp raise_unavailable!(modules) do
    Mix.raise("Igniter installer modules are unavailable: #{Enum.join(modules, ", ")}")
  end

  defp module_from_name(name), do: name |> String.split(".") |> Module.concat()
end
