defmodule LiveViewReact.SSR.NodeJS do
  @moduledoc """
  Implements SSR by using `NodeJS` package.

  It invokes the `render` export from the configured ESM server bundle with one
  request object containing `component`, `props`, and `slots`.
  """

  @behaviour LiveViewReact.SSR
  @compile {:no_warn_undefined, NodeJS}

  @impl true
  def render(request) do
    filename =
      Application.get_env(
        :liveview_react,
        :ssr_filepath,
        "./priv/liveview_react/server.mjs"
      )

    if Code.ensure_loaded?(NodeJS) do
      try do
        NodeJS.call!(
          {filename, "render"},
          [request],
          binary: true,
          esm: true
        )
      catch
        :exit, {:noproc, _} ->
          message = """
          NodeJS is not configured. Please add the following to your application.ex:
          {NodeJS.Supervisor, [path: LiveViewReact.SSR.NodeJS.server_path(), pool_size: 4]},
          """

          raise %LiveViewReact.SSR.NotConfigured{message: message}
      end
    else
      message = """
      NodeJS is not installed. Please add the following to mix.ex deps:
      `{:nodejs, "~> 3.1"}`
      """

      raise %LiveViewReact.SSR.NotConfigured{message: message}
    end
  end

  @spec server_path() :: String.t()
  def server_path do
    {:ok, path} = :application.get_application()
    Application.app_dir(path, "/priv")
  end
end
