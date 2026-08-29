defmodule LiveViewReact.SSRTest do
  use ExUnit.Case, async: false

  alias LiveViewReact.SSR
  alias LiveViewReact.SSR.ViteJS

  @config_keys [:ssr_module, :vite_host, :vite_connect_timeout, :vite_request_timeout]

  test "NodeJS server path resolves the explicitly selected application priv directory" do
    assert LiveViewReact.SSR.NodeJS.server_path(:liveview_react) ==
             Application.app_dir(:liveview_react, "priv")
  end

  defmodule Renderer do
    @moduledoc false
    @behaviour SSR

    @impl true
    def render(%{component: component, props: %{test_pid: test_pid}, slots: slots} = request) do
      send(test_pid, {:render_request, request})

      "<link rel=\"modulepreload\" href=\"/counter.js\"><p>#{component}:#{map_size(slots)}</p>"
    end
  end

  defmodule InvalidRenderer do
    @moduledoc false
    @behaviour SSR

    @impl true
    def render(_request), do: {:error, :invalid}
  end

  defmodule LegacyMapRenderer do
    @moduledoc false
    @behaviour SSR

    @impl true
    def render(_request), do: %{html: "<p>legacy response</p>"}
  end

  @doc false
  def handle_telemetry(event, measurements, metadata, test_pid) do
    send(test_pid, {:telemetry, event, measurements, metadata})
  end

  setup_all do
    {:ok, _started} = Application.ensure_all_started(:inets)
    :ok
  end

  setup do
    previous = Map.new(@config_keys, &{&1, Application.fetch_env(:liveview_react, &1)})

    on_exit(fn ->
      Enum.each(previous, fn
        {key, {:ok, value}} -> Application.put_env(:liveview_react, key, value)
        {key, :error} -> Application.delete_env(:liveview_react, key)
      end)
    end)
  end

  test "passes one request object to the configured renderer and emits canonical telemetry" do
    Application.put_env(:liveview_react, :ssr_module, Renderer)
    handler_id = "ssr-test-#{System.unique_integer([:positive])}"

    :ok =
      :telemetry.attach(
        handler_id,
        [:liveview_react, :ssr, :stop],
        &__MODULE__.handle_telemetry/4,
        self()
      )

    on_exit(fn -> :telemetry.detach(handler_id) end)

    request = %{
      component: "Counter",
      events: %{},
      identifierPrefix: "liveview-react-counter-",
      props: %{count: 1, test_pid: self()},
      slots: %{"default" => "Count"}
    }

    assert SSR.render(request) == %{
             html: "<link rel=\"modulepreload\" href=\"/counter.js\"><p>Counter:1</p>"
           }

    assert_receive {:render_request, ^request}

    assert_receive {:telemetry, [:liveview_react, :ssr, :stop], measurements,
                    %{component: "Counter"}}

    assert is_integer(measurements.duration)
  end

  test "raises when SSR is not configured" do
    Application.delete_env(:liveview_react, :ssr_module)

    assert_raise SSR.NotConfigured, fn ->
      SSR.render(render_request())
    end
  end

  test "rejects invalid renderer responses" do
    Application.put_env(:liveview_react, :ssr_module, InvalidRenderer)

    assert_raise SSR.RenderError, ~r/invalid response/, fn ->
      SSR.render(render_request())
    end
  end

  test "rejects the removed structured renderer response protocol" do
    Application.put_env(:liveview_react, :ssr_module, LegacyMapRenderer)

    assert_raise SSR.RenderError, ~r/invalid response/, fn ->
      SSR.render(render_request())
    end
  end

  test "rejects requests without the deterministic identifier prefix" do
    Application.put_env(:liveview_react, :ssr_module, Renderer)

    assert_raise SSR.RenderError, ~r/Invalid SSR render request/, fn ->
      SSR.render(%{component: "Counter", events: %{}, props: %{}, slots: %{}})
    end
  end

  test "rejects requests without the dedicated event metadata field" do
    Application.put_env(:liveview_react, :ssr_module, Renderer)

    assert_raise SSR.RenderError, ~r/expected component, events, identifierPrefix/, fn ->
      SSR.render(%{
        component: "Counter",
        identifierPrefix: "liveview-react-counter-",
        props: %{},
        slots: %{}
      })
    end
  end

  describe "Vite request bounds" do
    test "rejects a non-positive connect timeout before issuing a request" do
      Application.put_env(:liveview_react, :vite_host, "http://127.0.0.1:1")
      Application.put_env(:liveview_react, :vite_connect_timeout, 0)

      assert_raise SSR.RenderError,
                   "Invalid LiveViewReact vite_connect_timeout configuration: " <>
                     "expected a positive integer in milliseconds",
                   fn -> ViteJS.render(render_request()) end
    end

    test "rejects a non-integer request timeout before issuing a request" do
      Application.put_env(:liveview_react, :vite_host, "http://127.0.0.1:1")
      Application.put_env(:liveview_react, :vite_request_timeout, "5000")

      assert_raise SSR.RenderError,
                   "Invalid LiveViewReact vite_request_timeout configuration: " <>
                     "expected a positive integer in milliseconds",
                   fn -> ViteJS.render(render_request()) end
    end

    test "converts a bounded request timeout into a safe render error" do
      {host, server} = start_hanging_server()
      Application.put_env(:liveview_react, :vite_host, host)
      Application.put_env(:liveview_react, :vite_connect_timeout, 500)
      Application.put_env(:liveview_react, :vite_request_timeout, 25)

      on_exit(fn -> send(server, :close) end)

      assert_raise SSR.RenderError, "Vite SSR request timed out after 25 ms", fn ->
        ViteJS.render(render_request())
      end
    end

    test "surfaces a configured renderer failure from a Vite JSON response" do
      body = Jason.encode!(%{error: %{message: ~s(Unknown LiveViewReact component "Missing")}})
      {host, server} = start_response_server(500, "Internal Server Error", body)
      Application.put_env(:liveview_react, :vite_host, host)

      on_exit(fn -> send(server, :close) end)

      assert_raise SSR.RenderError,
                   ~s(Vite SSR failed with status 500: Unknown LiveViewReact component "Missing"),
                   fn -> ViteJS.render(render_request(%{component: "Missing"})) end
    end
  end

  defp render_request(overrides \\ %{}) do
    Map.merge(
      %{
        component: "Counter",
        events: %{},
        identifierPrefix: "liveview-react-counter-",
        props: %{},
        slots: %{}
      },
      overrides
    )
  end

  defp start_hanging_server do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])

    {:ok, {{127, 0, 0, 1}, port}} = :inet.sockname(listener)

    server =
      spawn(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, _request} = :gen_tcp.recv(socket, 0, 1_000)

        receive do
          :close -> :ok
        after
          1_000 -> :ok
        end

        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
      end)

    {"http://127.0.0.1:#{port}", server}
  end

  defp start_response_server(status, reason, body) do
    {:ok, listener} =
      :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true, ip: {127, 0, 0, 1}])

    {:ok, {{127, 0, 0, 1}, port}} = :inet.sockname(listener)

    server =
      spawn(fn ->
        {:ok, socket} = :gen_tcp.accept(listener)
        {:ok, _request} = :gen_tcp.recv(socket, 0, 1_000)

        :ok =
          :gen_tcp.send(socket, [
            "HTTP/1.1 #{status} #{reason}\r\n",
            "Content-Type: application/json\r\n",
            "Content-Length: #{byte_size(body)}\r\n",
            "Connection: close\r\n\r\n",
            body
          ])

        receive do
          :close -> :ok
        after
          1_000 -> :ok
        end

        :gen_tcp.close(socket)
        :gen_tcp.close(listener)
      end)

    {"http://127.0.0.1:#{port}", server}
  end
end
