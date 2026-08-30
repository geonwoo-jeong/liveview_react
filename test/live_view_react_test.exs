defmodule LiveViewReactTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component

  require Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias Phoenix.HTML.Safe
  alias Phoenix.LiveView.JS
  alias Phoenix.LiveView.LiveStream
  alias Phoenix.LiveView.Socket

  defmodule SSRRenderer do
    @moduledoc false
    @behaviour LiveViewReact.SSR

    @impl true
    def render(_request), do: "<strong>server rendered</strong>"
  end

  defmodule FailingSSRRenderer do
    @moduledoc false
    @behaviour LiveViewReact.SSR

    @impl true
    def render(_request) do
      raise LiveViewReact.SSR.RenderError,
        message: ~s(Unknown LiveViewReact component "Missing")
    end
  end

  defmodule StreamSSRRenderer do
    @moduledoc false
    @behaviour LiveViewReact.SSR

    @impl true
    def render(%{streams: streams} = request) do
      send(self(), {:stream_ssr_request, request})

      streams
      |> Map.fetch!("users")
      |> Enum.map_join(fn user ->
        ~s(<article id="#{user["__dom_id"]}">#{user["name"]}</article>)
      end)
    end
  end

  doctest LiveViewReact

  test "uses the canonical OTP application identity" do
    removed_app = ["live", "react"] |> Enum.join("_") |> String.to_atom()

    assert Application.spec(:liveview_react, :vsn) == ~c"0.1.0"
    assert :inets in Application.spec(:liveview_react, :applications)
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

    test "rejects non-boolean render flags" do
      for {key, value} <- [diff: "false", ssr: 1] do
        assigns = %{
          id: "my-component",
          component: "MyComponent",
          socket: %Socket{},
          __changed__: nil
        }

        assert_raise ArgumentError,
                     "LiveViewReact.react/1 requires #{inspect(key)} to be a boolean, got: #{inspect(value)}",
                     fn -> LiveViewReact.react(Map.put(assigns, key, value)) end
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
      assert Floki.attribute(wrapper, "data-liveview-react-version") == ["2"]
      assert Floki.attribute(wrapper, "data-props-kind") == ["snapshot"]
      assert Floki.attribute(wrapper, "data-streams-kind") == ["snapshot"]
    end

    test "emits the protocol version on connected update frames" do
      rendered =
        LiveViewReact.react(%{
          id: "versioned-component",
          component: "VersionedComponent",
          socket: %Socket{transport_pid: self()},
          __changed__: %{}
        })

      dynamic =
        rendered.dynamic.(true)
        |> Enum.reject(&is_nil/1)
        |> IO.iodata_to_binary()

      assert dynamic =~ ~s(data-liveview-react-version="2")
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
               "version" => 2,
               "component" => "HydratedComponent",
               "events" => %{},
               "identifierPrefix" => "liveview-react-hydrated-component-",
               "props" => %{"greeting" => "hello"},
               "streams" => %{},
               "slots" => %{"default" => "\n  <em>SSR child</em>\n"}
             }

      assert Floki.attribute(wrapper, "data-streams-kind") == ["hydration"]
      assert Floki.attribute(wrapper, "data-streams-diff") == [""]
      assert Floki.text(target) == "server rendered"

      react = Test.get_react(html)
      assert react.ssr
      assert react.hydration == Jason.decode!(descriptor)
    end

    test "includes materialized LiveStreams in the SSR hydration descriptor" do
      users = LiveStream.new(:users, make_ref(), [%{id: 1, name: "Ada"}], [])

      html =
        with_ssr_renderer(fn ->
          render_react(&hydrated_stream_component/1, users: users)
        end)

      react = Test.get_react(html)

      assert react.hydration == %{
               "version" => 2,
               "component" => "HydratedStreamComponent",
               "events" => %{},
               "identifierPrefix" => "liveview-react-hydrated-stream-component-",
               "props" => %{"title" => "Users"},
               "streams" => %{
                 "users" => [%{"id" => 1, "name" => "Ada", "__dom_id" => "users-1"}]
               },
               "slots" => %{}
             }

      refute Map.has_key?(react.hydration["props"], "users")
      assert react.streams_kind == "hydration"
      assert react.streams_diff == []
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

    test "reads the SSR default from runtime application configuration" do
      with_ssr_renderer(fn ->
        with_application_env(:ssr, false, fn ->
          refute render_react(&simple_component/1) |> Test.get_react() |> Map.fetch!(:ssr)
        end)

        with_application_env(:ssr, true, fn ->
          assert render_react(&simple_component/1) |> Test.get_react() |> Map.fetch!(:ssr)
        end)
      end)
    end

    test "rejects a non-boolean SSR application configuration" do
      with_application_env(:ssr, :invalid, fn ->
        assert_raise ArgumentError,
                     "LiveViewReact expects config :liveview_react, :ssr to be a boolean, got: :invalid",
                     fn -> render_react(&simple_component/1) end
      end)
    end

    test "does not hide failures from a configured renderer" do
      assert_raise LiveViewReact.SSR.RenderError,
                   ~s(Unknown LiveViewReact component "Missing"),
                   fn ->
                     with_ssr_renderer(FailingSSRRenderer, fn ->
                       render_react(&simple_component/1)
                     end)
                   end
    end

    test "passes the exact dead stream snapshot to SSR and renders no-JavaScript items" do
      users =
        LiveStream.new(
          :users,
          make_ref(),
          [%{id: 1, name: "Ada"}, %{id: 2, name: "Grace"}],
          dom_id: fn user -> "account/#{user.id}" end,
          limit: 1
        )

      html =
        with_ssr_renderer(StreamSSRRenderer, fn ->
          render_react(&hydrated_stream_component/1, users: users)
        end)

      assert_receive {:stream_ssr_request, request}

      assert Map.keys(request) |> Enum.sort() ==
               [:component, :events, :identifierPrefix, :props, :slots, :streams, :version]

      assert request.version == 2

      assert request.streams == %{
               "users" => [
                 %{"id" => 1, "name" => "Ada", "__dom_id" => "account/1"},
                 %{"id" => 2, "name" => "Grace", "__dom_id" => "account/2"}
               ]
             }

      assert html =~ ~s(<article id="account/1">Ada</article>)
      assert html =~ ~s(<article id="account/2">Grace</article>)

      react = Test.get_react(html)
      assert react.hydration["streams"] == request.streams
      assert react.streams_kind == "hydration"
      assert react.streams_diff == []
    end
  end

  describe "slots" do
    def component_with_named_slot(assigns) do
      ~H"""
      <.react socket={@socket} id="named-slot" component="WithSlots">
        <:slot name="hello">Simple content</:slot>
      </.react>
      """
    end

    def component_with_repeated_named_slot(assigns) do
      ~H"""
      <.react socket={@socket} id="repeated-named-slot" component="WithSlots">
        <:slot name="hello">First</:slot>
        <:slot name="hello">Second</:slot>
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

    test "renders named slots as dedicated slot entries" do
      html = render_react(&component_with_named_slot/1)
      react = Test.get_react(html)

      assert react.slots == %{"hello" => "Simple content"}
    end

    test "renders repeated named slot entries in HEEx order" do
      html = render_react(&component_with_repeated_named_slot/1)
      react = Test.get_react(html)

      assert react.slots == %{"hello" => "FirstSecond"}
    end

    test "renders default slot with inner_block" do
      html = render_react(&component_with_inner_block/1)
      react = Test.get_react(html)

      assert react.slots == %{"default" => "\n  Simple content\n"}
    end

    test "preserves meaningful leading and trailing slot whitespace" do
      slot_html = " \n<strong>preserved</strong>\t "

      html =
        LiveViewReact.react(%{
          __changed__: nil,
          component: "WithSlots",
          id: "whitespace-slot",
          inner_block: [
            %{
              __slot__: :inner_block,
              inner_block: fn _, _ -> [Phoenix.HTML.raw(slot_html)] end
            }
          ],
          socket: %Socket{},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      assert Test.get_react(html).slots == %{"default" => slot_html}
    end

    test "omits an HTML-whitespace-only slot without trimming meaningful text" do
      html =
        LiveViewReact.react(%{
          __changed__: nil,
          component: "WithSlots",
          id: "blank-slot",
          inner_block: [
            %{
              __slot__: :inner_block,
              inner_block: fn _, _ -> [Phoenix.HTML.raw(" \n\t\f\r")] end
            }
          ],
          socket: %Socket{},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      assert Test.get_react(html).slots == %{}
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

      assert slots == %{"default" => "\n  Simple content\n"}
    end

    test "keeps dynamic slot values HTML-escaped before transport" do
      html = render_react(&component_with_untrusted_slot/1)
      react = Test.get_react(html)

      assert react.slots == %{
               "default" => "\n  &lt;img src=x onerror=&quot;alert(1)&quot;&gt;\n"
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

    test "an emptied named slot assign transports no slots and no props" do
      html =
        LiveViewReact.react(%{
          __changed__: %{slot: true},
          component: "WithSlots",
          id: "removed-named-slot",
          slot: [],
          socket: %Socket{transport_pid: self()},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      react = Test.get_react(html)

      assert react.slots == %{}
      assert react.props_diff == []
    end

    test "an empty list assign stays an ordinary empty list prop" do
      html =
        LiveViewReact.react(%{
          __changed__: nil,
          component: "WithSlots",
          id: "empty-list-prop",
          sidebar: [],
          socket: %Socket{transport_pid: self()},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      react = Test.get_react(html)

      assert react.slots == %{}
      assert react.props == %{"sidebar" => []}
    end

    test "uses a safe snapshot for erased default and named slot metadata" do
      for slot_key <- [:inner_block, :slot] do
        html =
          LiveViewReact.react(%{
            __changed__: %{slot_key => true},
            component: "WithSlots",
            id: "removed-#{slot_key}",
            socket: %Socket{transport_pid: self()},
            ssr: false,
            title: String.duplicate("unchanged", 16)
          })
          |> Safe.to_iodata()
          |> IO.iodata_to_binary()

        react = Test.get_react(html)

        assert react.props_kind == "snapshot"
        assert react.props == %{"title" => String.duplicate("unchanged", 16)}
        assert react.props_diff == []
        assert react.slots == %{}
      end
    end

    test "does not emit a prop removal while updating a current named slot" do
      sidebar = [
        %{
          __slot__: :slot,
          name: "sidebar",
          inner_block: fn _, _ -> ["Named slot revision 2"] end
        }
      ]

      html =
        LiveViewReact.react(%{
          __changed__: %{lastOperation: "initial", slot: true},
          component: "WithSlots",
          id: "updated-sidebar",
          lastOperation: "update_slots",
          slot: sidebar,
          socket: %Socket{transport_pid: self()},
          ssr: false,
          title: String.duplicate("unchanged", 16)
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      react = Test.get_react(html)

      assert react.props_kind == "patch"
      assert react.props_diff == [["replace", "/lastOperation", "update_slots"]]
      assert react.slots == %{"sidebar" => "Named slot revision 2"}
    end

    test "rejects prop collisions with named slot props" do
      slot = [%{__slot__: :slot, name: "hello", inner_block: fn _, _ -> ["slot"] end}]

      assert_raise ArgumentError,
                   ~s(LiveViewReact.react/1 cannot merge colliding React prop "hello" from ordinary props and slot props),
                   fn ->
                     LiveViewReact.react(%{
                       "hello" => "prop",
                       __changed__: nil,
                       component: "WithSlots",
                       slot: slot,
                       id: "slot-prop-collision",
                       socket: %Socket{}
                     })
                   end
    end

    test "rejects Phoenix-managed interactive markup inside slots" do
      assert_raise ArgumentError,
                   ~s(Unsupported interactive content in slot "default": Phoenix-managed bindings cannot be transported through liveview_react slots),
                   fn ->
                     render_react(fn assigns ->
                       ~H"""
                       <.react socket={@socket} id="interactive-slot" component="WithSlots">
                         <div phx-click="increment">Increment</div>
                       </.react>
                       """
                     end)
                   end
    end

    test "rejects forms, hooks, LiveComponents, and nested React roots" do
      unsupported = [
        {"forms", "<form><input></form>"},
        {"Phoenix hooks", ~s|<div phx-hook="Nested"></div>|},
        {"Phoenix-managed bindings", ~s|<div data-phx-component="1"></div>|},
        {"nested React roots", ~s|<div data-react-hydration></div>|},
        {"nested React roots", ~s|<div data-liveview-react-version="2"></div>|}
      ]

      for {reason, slot_html} <- unsupported do
        slot = [
          %{
            __slot__: :inner_block,
            inner_block: fn _, _ -> [Phoenix.HTML.raw(slot_html)] end
          }
        ]

        assert_raise ArgumentError, ~r/#{reason}/, fn ->
          LiveViewReact.react(%{
            __changed__: nil,
            component: "WithSlots",
            id: "unsupported-slot",
            inner_block: slot,
            socket: %Socket{}
          })
        end
      end
    end

    test "rejects trusted raw active markup and scriptable attributes" do
      unsupported = [
        {"event handler attributes", ~s|<div onclick="alert(1)">click</div>|},
        {"event handler attributes", ~s|<DIV ONLOAD='alert(1)'>load</DIV>|},
        {"active or resource-bearing markup", "<img>"},
        {"active or resource-bearing markup", ~s|<script>alert(1)</script>|},
        {"active or resource-bearing markup", "<iframe></iframe>"},
        {"active or resource-bearing markup", ~s|<unsafe-widget></unsafe-widget>|},
        {"style attributes", ~s|<div style="background:url(/tracking.gif)">styled</div>|},
        {"URL-bearing attributes",
         ~s|<blockquote cite="https://example.test">quote</blockquote>|},
        {"non-inert attribute", ~s|<div contenteditable>editable</div>|},
        {"markup declarations", ~s|<!--><img src="/tracking.gif">-->|},
        {"markup declarations", ~s|<!-- nested <!-- comment -->|},
        {"markup declarations", ~s|<!-- invalid --!> comment -->|},
        {"malformed HTML", ~s|<!-- unterminated|},
        {"malformed HTML", ~s|<div title="unterminated>|}
      ]

      for {reason, slot_html} <- unsupported do
        slot = [
          %{
            __slot__: :inner_block,
            inner_block: fn _, _ -> [Phoenix.HTML.raw(slot_html)] end
          }
        ]

        assert_raise ArgumentError, ~r/#{reason}/, fn ->
          LiveViewReact.react(%{
            __changed__: nil,
            component: "WithSlots",
            id: "unsafe-raw-slot",
            inner_block: slot,
            socket: %Socket{}
          })
        end
      end
    end

    test "allows explicitly inert semantic markup and presentation-neutral attributes" do
      slot_html =
        ~s|<section id="summary" class="card" role="region" aria-label="Summary" data-testid="summary"><time datetime="2026-08-30">Today</time><blockquote title="1 > 0">Safe</blockquote></section>|

      slot = [
        %{
          __slot__: :inner_block,
          inner_block: fn _, _ -> [Phoenix.HTML.raw(slot_html)] end
        }
      ]

      html =
        LiveViewReact.react(%{
          __changed__: nil,
          component: "WithSlots",
          id: "inert-raw-slot",
          inner_block: slot,
          socket: %Socket{},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      assert Test.get_react(html).slots == %{"default" => slot_html}
    end

    test "allows valid Phoenix HEEx annotations and unrelated data-react attributes" do
      slot_html =
        ~s|<!-- @caller lib/app_web/home_live.ex:20 (app) --><!-- <AppWeb.CoreComponents.item> lib/app_web/home_live.ex:21 (app) --><span data-reactive="true">Safe</span><!-- </AppWeb.CoreComponents.item> -->|

      slot = [
        %{
          __slot__: :inner_block,
          inner_block: fn _, _ -> [Phoenix.HTML.raw(slot_html)] end
        }
      ]

      html =
        LiveViewReact.react(%{
          __changed__: nil,
          component: "WithSlots",
          id: "annotated-slot",
          inner_block: slot,
          socket: %Socket{},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      assert Test.get_react(html).slots == %{"default" => slot_html}
    end

    test "rejects invalid, reserved, prop-colliding, and event-colliding slot names" do
      slot = fn name ->
        [%{__slot__: :slot, name: name, inner_block: fn _, _ -> ["slot"] end}]
      end

      for {name, message} <- [
            {"children", ~r/reserves the slot name "children"/},
            {"bad-name", ~r/lower camelCase or snake_case/}
          ] do
        assert_raise ArgumentError, message, fn ->
          LiveViewReact.react(%{
            :slot => slot.(name),
            __changed__: nil,
            component: "WithSlots",
            id: "invalid-slot-name",
            socket: %Socket{}
          })
        end
      end

      assert_raise ArgumentError,
                   ~r/colliding React prop "onSaveItem".*event props and slot props/,
                   fn ->
                     LiveViewReact.react(%{
                       "r-on:save-item" => JS.push("save"),
                       slot: slot.("onSaveItem"),
                       __changed__: nil,
                       component: "WithSlots",
                       id: "event-slot-collision",
                       socket: %Socket{}
                     })
                   end
    end

    test "allows inert slot text that only mentions Phoenix binding names" do
      html =
        render_react(fn assigns ->
          ~H"""
          <.react socket={@socket} id="text-slot" component="WithSlots">
            text mentioning phx-click="save" without markup
          </.react>
          """
        end)

      react = Test.get_react(html)

      assert react.slots == %{
               "default" => "\n  " <> ~s|text mentioning phx-click="save" without markup| <> "\n"
             }
    end
  end

  defp render_react(component, assigns \\ []) do
    assigns = Keyword.put_new(assigns, :socket, %Socket{})
    Phoenix.LiveViewTest.render_component(component, assigns)
  end

  defp with_ssr_renderer(fun), do: with_ssr_renderer(SSRRenderer, fun)

  defp with_ssr_renderer(renderer, fun) do
    previous_renderer = Application.fetch_env(:liveview_react, :ssr_module)
    Application.put_env(:liveview_react, :ssr_module, renderer)

    try do
      fun.()
    after
      case previous_renderer do
        {:ok, renderer} -> Application.put_env(:liveview_react, :ssr_module, renderer)
        :error -> Application.delete_env(:liveview_react, :ssr_module)
      end
    end
  end

  defp with_application_env(key, value, fun) do
    previous_value = Application.fetch_env(:liveview_react, key)
    Application.put_env(:liveview_react, key, value)

    try do
      fun.()
    after
      case previous_value do
        {:ok, previous} -> Application.put_env(:liveview_react, key, previous)
        :error -> Application.delete_env(:liveview_react, key)
      end
    end
  end
end
