defmodule LiveViewReact.SSR.ViteJS do
  @moduledoc """
  Implements SSR by making a POST request to `http://{:vite_host}/ssr_render`.

  `ssr_render` is implemented as a Vite plugin. You have to add it to the `vite.config.js` plugins section.

  Requests use bounded timeouts. Override the millisecond defaults with positive
  integers when development infrastructure needs different limits:

      config :liveview_react,
        vite_connect_timeout: 2_000,
        vite_request_timeout: 5_000

  ```javascript
  import liveViewReactPlugin from "liveview_react/vite";

  {
    publicDir: "static",
    plugins: [react(), liveViewReactPlugin()],
    // ...
  }
  """

  @behaviour LiveViewReact.SSR
  @default_connect_timeout 2_000
  @default_request_timeout 5_000

  @impl true
  def render(request) do
    {connect_timeout, request_timeout} = request_timeouts!()
    data = Jason.encode!(request)
    url = vite_path("/ssr_render")
    params = {String.to_charlist(url), [], ~c"application/json", data}

    http_options = [connect_timeout: connect_timeout, timeout: request_timeout]

    case :httpc.request(:post, params, http_options, []) do
      {:ok, {{_, 200, _}, _headers, body}} ->
        :erlang.list_to_binary(body)

      {:ok, {{_, status, reason}, _headers, body}} ->
        raise LiveViewReact.SSR.RenderError,
          message: response_error(status, reason, :erlang.list_to_binary(body))

      {:error, reason} ->
        raise LiveViewReact.SSR.RenderError,
          message: request_error(reason, connect_timeout, request_timeout)
    end
  end

  @doc """
  A handy utility returning path relative to Vite JS host.
  """
  def vite_path(path) do
    case Application.get_env(:liveview_react, :vite_host) do
      nil ->
        message = """
        Vite.js host is not configured. Please add the following to config/dev.exs

        config :liveview_react, vite_host: "http://localhost:5173"

        and ensure vite.js is running
        """

        raise %LiveViewReact.SSR.NotConfigured{message: message}

      host ->
        Path.join(host, path)
    end
  end

  defp response_error(status, reason, body) do
    case Jason.decode(body) do
      {:ok,
       %{
         "error" => %{
           "message" => message,
           "loc" => %{"file" => file, "line" => line, "column" => column},
           "frame" => frame
         }
       }} ->
        "Vite SSR failed: #{message}\n#{file}:#{line}:#{column}\n#{frame}"

      {:ok, %{"error" => %{"message" => message}}} when is_binary(message) ->
        "Vite SSR failed with status #{status}: #{message}"

      _ ->
        "Vite SSR failed with status #{status} #{reason}: #{body}"
    end
  end

  defp request_timeouts! do
    {
      timeout!(:vite_connect_timeout, @default_connect_timeout),
      timeout!(:vite_request_timeout, @default_request_timeout)
    }
  end

  defp timeout!(key, default) do
    case Application.get_env(:liveview_react, key, default) do
      timeout when is_integer(timeout) and timeout > 0 ->
        timeout

      _invalid ->
        raise LiveViewReact.SSR.RenderError,
          message:
            "Invalid LiveViewReact #{key} configuration: expected a positive integer in milliseconds"
    end
  end

  defp request_error(:timeout, _connect_timeout, request_timeout) do
    "Vite SSR request timed out after #{request_timeout} ms"
  end

  defp request_error({:failed_connect, details}, connect_timeout, _request_timeout) do
    if contains_timeout?(details) do
      "Vite SSR connection timed out after #{connect_timeout} ms"
    else
      "Unable to connect to the Vite SSR server"
    end
  end

  defp request_error(_reason, _connect_timeout, _request_timeout) do
    "Vite SSR request failed"
  end

  defp contains_timeout?(:timeout), do: true

  defp contains_timeout?(value) when is_tuple(value),
    do: value |> Tuple.to_list() |> contains_timeout?()

  defp contains_timeout?(value) when is_list(value), do: Enum.any?(value, &contains_timeout?/1)
  defp contains_timeout?(_value), do: false
end
