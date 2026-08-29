defmodule LiveViewReactTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component

  require Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias Phoenix.LiveView.LiveStream
  alias Phoenix.LiveView.Socket

  defmodule SSRRenderer do
    @moduledoc false
    @behaviour LiveViewReact.SSR

    @impl true
    def render(_request), do: "<strong>server rendered</strong>"
  end

  doctest LiveViewReact

  test "uses the canonical OTP application identity" do
    removed_app = ["live", "react"] |> Enum.join("_") |> String.to_atom()

    assert Application.spec(:liveview_react, :vsn) == ~c"0.1.0"
    assert Application.spec(removed_app) == nil
  end

  describe "basic component rendering" do
    def simple_component(assigns) do
      ~H"""
      <.react socket={@socket} id="my-component" component="MyComponent" firstName="john" lastName="doe" />
      """
    end

    def hydrated_component(assigns) do
      ~H"""
      <.react
        socket={@socket}
        id="hydrated-component"
        component="HydratedComponent"
        greeting="hello"
      >
        <em>SSR child</em>
      </.react>
      """
    end

    def hydrated_stream_component(assigns) do
      ~H"""
      <.react
        socket={@socket}
        id="hydrated-stream-component"
        component="HydratedStreamComponent"
        users={@users}
        title="Users"
      />
      """
    end

    test "renders component with correct props" do
      html = render_react(&simple_component/1)
      react = Test.get_react(html)

      assert react.component == "MyComponent"
      assert react.props == %{"firstName" => "john", "lastName" => "doe"}
    end

    test "uses the required explicit ID" do
      html = render_react(&simple_component/1)
      react = Test.get_react(html)

      assert react.id == "my-component"
    end

    test "rejects a missing ID" do
      assert_raise ArgumentError,
                   "LiveViewReact.react/1 requires :id to be a non-empty string",
                   fn ->
                     LiveViewReact.react(%{
                       component: "MyComponent",
                       socket: %Socket{},
                       __changed__: nil
                     })
                   end
    end

    test "rejects a missing component selector" do
      assert_raise ArgumentError,
                   "LiveViewReact.react/1 requires :component to be a non-empty string",
                   fn ->
                     LiveViewReact.react(%{
                       id: "my-component",
                       socket: %Socket{},
                       __changed__: nil
                     })
                   end
    end

    test "rejects empty and non-string identity values" do
      for {key, value} <- [id: "", id: :counter, component: "", component: Counter] do
        assigns =
          %{
            id: "my-component",
            component: "MyComponent",
            socket: %Socket{},
            __changed__: nil
          }
          |> Map.put(key, value)

        assert_raise ArgumentError,
                     "LiveViewReact.react/1 requires #{inspect(key)} to be a non-empty string",
                     fn -> LiveViewReact.react(assigns) end
      end
    end

    test "does not treat name as a component selector" do
      assert_raise ArgumentError,
                   "LiveViewReact.react/1 requires :component to be a non-empty string",
                   fn ->
                     LiveViewReact.react(%{
                       id: "my-component",
                       name: "MyComponent",
                       socket: %Socket{},
                       __changed__: nil
                     })
                   end
    end

    test "requires a LiveView socket" do
      for socket <- [:missing, nil, %{}, self()] do
        assigns = %{id: "my-component", component: "MyComponent", __changed__: nil}
        assigns = if socket == :missing, do: assigns, else: Map.put(assigns, :socket, socket)

        assert_raise ArgumentError,
                     "LiveViewReact.react/1 requires :socket to be a Phoenix.LiveView.Socket",
                     fn -> LiveViewReact.react(assigns) end
      end
    end
  end

  describe "DOM ownership" do
    test "keeps transport metadata on the Phoenix-owned wrapper" do
      html = render_react(&simple_component/1)
      [wrapper] = html |> Floki.parse_fragment!() |> Floki.find("#my-component")

      assert Floki.attribute(wrapper, "phx-hook") == ["LiveViewReactHook"]
      assert Floki.attribute(wrapper, "phx-update") == ["ignore"]
      assert Floki.attribute(wrapper, "data-component") == ["MyComponent"]
      assert Floki.attribute(wrapper, "data-liveview-react-version") == ["1"]
      assert Floki.attribute(wrapper, "data-props-kind") == ["snapshot"]
      assert Floki.attribute(wrapper, "data-streams-kind") == ["snapshot"]
    end

    test "renders exactly one direct React-owned target" do
      html = render_react(&simple_component/1)
      [wrapper] = html |> Floki.parse_fragment!() |> Floki.find("#my-component")

      assert [{"div", target_attributes, _children}] = Floki.children(wrapper)
      assert Enum.any?(target_attributes, fn {name, _value} -> name == "data-react-target" end)
      refute Enum.any?(target_attributes, fn {name, _value} -> name == "data-props" end)
    end

    test "keeps the exact SSR hydration descriptor on the immutable React target" do
      html = with_ssr_renderer(fn -> render_react(&hydrated_component/1) end)
      [wrapper] = html |> Floki.parse_fragment!() |> Floki.find("#hydrated-component")
      [target] = Floki.children(wrapper)
      descriptor = target |> Floki.attribute("data-react-hydration") |> List.first()

      assert Floki.attribute(wrapper, "data-react-hydration") == []

      assert Jason.decode!(descriptor) == %{
               "version" => 1,
               "component" => "HydratedComponent",
               "props" => %{"greeting" => "hello"},
               "slots" => %{"default" => "<em>SSR child</em>"}
             }

      assert Floki.text(target) == "server rendered"

      react = Test.get_react(html)
      assert react.ssr
      assert react.hydration == Jason.decode!(descriptor)
    end

    test "excludes LiveStreams from the SSR hydration descriptor" do
      users = LiveStream.new(:users, make_ref(), [%{id: 1, name: "Ada"}], [])

      html =
        with_ssr_renderer(fn ->
          render_react(&hydrated_stream_component/1, users: users)
        end)

      react = Test.get_react(html)

      assert react.hydration == %{
               "version" => 1,
               "component" => "HydratedStreamComponent",
               "props" => %{"title" => "Users"},
               "slots" => %{}
             }

      refute Map.has_key?(react.hydration["props"], "users")
    end
  end

  describe "multiple components" do
    def multi_component(assigns) do
      ~H"""
      <div>
        <.react socket={@socket} id="profile-1" firstName="John" component="UserProfile" />
        <.react socket={@socket} id="card-1" firstName="Jane" component="UserCard" />
      </div>
      """
    end

    test "finds first component by default" do
      html = render_react(&multi_component/1)
      react = Test.get_react(html)

      assert react.component == "UserProfile"
      assert react.props == %{"firstName" => "John"}
    end

    test "finds specific component by registry name" do
      html = render_react(&multi_component/1)
      react = Test.get_react(html, component: "UserCard")

      assert react.component == "UserCard"
      assert react.props == %{"firstName" => "Jane"}
    end

    test "finds specific component by id" do
      html = render_react(&multi_component/1)
      react = Test.get_react(html, id: "card-1")

      assert react.component == "UserCard"
      assert react.id == "card-1"
    end

    test "raises error when component selector is not found" do
      html = render_react(&multi_component/1)

      assert_raise RuntimeError,
                   ~r/No LiveViewReact component found with component="Unknown".*Available components: UserProfile#profile-1, UserCard#card-1/,
                   fn ->
                     Test.get_react(html, component: "Unknown")
                   end
    end

    test "raises error when component with id not found" do
      html = render_react(&multi_component/1)

      assert_raise RuntimeError,
                   ~r/No LiveViewReact component found with id="unknown-id".*Available components: UserProfile#profile-1, UserCard#card-1/,
                   fn ->
                     Test.get_react(html, id: "unknown-id")
                   end
    end
  end

  describe "ordinary props" do
    def styled_component(assigns) do
      ~H"""
      <.react socket={@socket} id="styled" component="MyComponent" class="bg-blue-500 rounded-sm" />
      """
    end

    test "transports class to React instead of mutating the ignored wrapper" do
      html = render_react(&styled_component/1)
      react = Test.get_react(html)
      [wrapper] = html |> Floki.parse_fragment!() |> Floki.find("#styled")

      assert react.props["class"] == "bg-blue-500 rounded-sm"
      assert Floki.attribute(wrapper, "class") == []
    end
  end

  describe "SSR behavior" do
    def ssr_component(assigns) do
      ~H"""
      <.react socket={@socket} id="without-ssr" component="MyComponent" ssr={false} />
      """
    end

    test "respects SSR flag" do
      html = render_react(&ssr_component/1)
      react = Test.get_react(html)

      assert react.ssr == false
      assert react.hydration == nil
    end
  end

  describe "slots" do
    def component_with_named_slot(assigns) do
      ~H"""
      <.react socket={@socket} id="named-slot" component="WithSlots">
        <:hello>Simple content</:hello>
      </.react>
      """
    end

    def component_with_inner_block(assigns) do
      ~H"""
      <.react socket={@socket} id="default-slot" component="WithSlots">
        Simple content
      </.react>
      """
    end

    def component_with_untrusted_slot(assigns) do
      assigns = assign(assigns, :untrusted, ~S|<img src=x onerror="alert(1)">|)

      ~H"""
      <.react socket={@socket} id="untrusted-slot" component="WithSlots">
        {@untrusted}
      </.react>
      """
    end

    test "warns about usage of named slot" do
      assert_raise RuntimeError,
                   "Unsupported slot: hello, only one default slot is supported, passed as React children.",
                   fn -> render_react(&component_with_named_slot/1) end
    end

    test "renders default slot with inner_block" do
      html = render_react(&component_with_inner_block/1)
      react = Test.get_react(html)

      assert react.slots == %{"default" => "Simple content"}
    end

    test "encodes slot as base64" do
      html = render_react(&component_with_inner_block/1)

      # Get raw data-slots attribute to verify base64 encoding
      doc = Floki.parse_fragment!(html)
      slots_attr = Floki.attribute(doc, "data-slots")

      slots =
        slots_attr
        |> Jason.decode!()
        |> Enum.map(fn {key, value} -> {key, Base.decode64!(value)} end)
        |> Enum.into(%{})

      assert slots == %{"default" => "Simple content"}
    end

    test "keeps dynamic slot values HTML-escaped before transport" do
      html = render_react(&component_with_untrusted_slot/1)
      react = Test.get_react(html)

      assert react.slots == %{
               "default" => "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
             }
    end

    test "handles empty slots" do
      html =
        render_react(fn assigns ->
          ~H"""
          <.react socket={@socket} id="empty-slot" component="WithSlots" />
          """
        end)

      react = Test.get_react(html)

      assert react.slots == %{}
    end
  end

  defp render_react(component, assigns \\ []) do
    assigns = Keyword.put_new(assigns, :socket, %Socket{})
    Phoenix.LiveViewTest.render_component(component, assigns)
  end

  defp with_ssr_renderer(fun) do
    previous_renderer = Application.fetch_env(:liveview_react, :ssr_module)
    Application.put_env(:liveview_react, :ssr_module, SSRRenderer)

    try do
      fun.()
    after
      case previous_renderer do
        {:ok, renderer} -> Application.put_env(:liveview_react, :ssr_module, renderer)
        :error -> Application.delete_env(:liveview_react, :ssr_module)
      end
    end
  end
end
