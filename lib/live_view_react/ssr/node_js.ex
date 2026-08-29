defmodule LiveViewReact.SSR.NodeJS do
  @moduledoc """
  Implements SSR by using `NodeJS` package.

  It invokes the `render` export from the configured ESM server bundle with one
  request object containing `component`, `identifierPrefix`, `props`, and
  `slots`.
  """

  @behaviour LiveViewReact.SSR
  @compile {:no_warn_undefined, NodeJS}

  @impl true
  def render(request) do
    filename =
      Application.get_env(
        :liveview_react,
        :ssr_filepath,
        "./liveview_react/server.mjs"
      )

    if Code.ensure_loaded?(NodeJS) do
      try do
        NodeJS.call!(
          {filename, "render"},
          [request],
          binary: true,
          esm: true
        )
      rescue
        error ->
          reraise %LiveViewReact.SSR.RenderError{
                    message: "Node.js SSR failed: #{renderer_error_message(error)}"
                  },
                  __STACKTRACE__
      catch
        :exit, {:noproc, _} ->
          raise %LiveViewReact.SSR.NotConfigured{message: missing_supervisor_message()}

        :exit, _reason ->
          raise LiveViewReact.SSR.RenderError,
            message: "Node.js SSR process exited unexpectedly"
      end
    else
      message = """
      NodeJS is not installed. Please add the following to mix.ex deps:
      `{:nodejs, "~> 3.1"}`
      """

      raise %LiveViewReact.SSR.NotConfigured{message: message}
    end
  end

  @doc """
  Returns the `priv` directory for the application that owns the SSR bundle.

  The application is explicit because the calling process may not belong to an
  OTP application during Mix tasks, tests, or supervision-tree construction.
  """
  @spec server_path(atom()) :: String.t()
  def server_path(application) when is_atom(application) do
    Application.app_dir(application, "priv")
  end

  defp renderer_error_message(%{message: message}) when is_binary(message), do: message
  defp renderer_error_message(_error), do: "the renderer raised an unexpected exception"

  defp missing_supervisor_message do
    """
    NodeJS is not configured. Please add the following to your application.ex:
    {NodeJS.Supervisor, [path: LiveViewReact.SSR.NodeJS.server_path(:my_app), pool_size: 4]},
    """
  end
end
