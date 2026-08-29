defmodule LiveViewReactTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test

  doctest LiveViewReact

  test "uses the canonical OTP application identity" do
    removed_app = ["live", "react"] |> Enum.join("_") |> String.to_atom()

    assert Application.spec(:liveview_react, :vsn) == ~c"0.1.0"
    assert Application.spec(removed_app) == nil
  end

  describe "basic component rendering" do
    def simple_component(assigns) do
      ~H"""
      <.react id="my-component" component="MyComponent" firstName="john" lastName="doe" />
      """
    end

    test "renders component with correct props" do
      html = render_component(&simple_component/1)
      react = Test.get_react(html)

      assert react.component == "MyComponent"
      assert react.props == %{"firstName" => "john", "lastName" => "doe"}
    end

    test "uses the required explicit ID" do
      html = render_component(&simple_component/1)
      react = Test.get_react(html)

      assert react.id == "my-component"
    end

    test "rejects a missing ID" do
      assert_raise ArgumentError,
                   "LiveViewReact.react/1 requires :id to be a non-empty string",
                   fn ->
                     LiveViewReact.react(%{
                       component: "MyComponent",
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
                       __changed__: nil
                     })
                   end
    end

    test "rejects empty and non-string identity values" do
      for {key, value} <- [id: "", id: :counter, component: "", component: Counter] do
        assigns =
          %{id: "my-component", component: "MyComponent", __changed__: nil}
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
                       __changed__: nil
                     })
                   end
    end
  end

  describe "multiple components" do
    def multi_component(assigns) do
      ~H"""
      <div>
        <.react id="profile-1" firstName="John" component="UserProfile" />
        <.react id="card-1" firstName="Jane" component="UserCard" />
      </div>
      """
    end

    test "finds first component by default" do
      html = render_component(&multi_component/1)
      react = Test.get_react(html)

      assert react.component == "UserProfile"
      assert react.props == %{"firstName" => "John"}
    end

    test "finds specific component by registry name" do
      html = render_component(&multi_component/1)
      react = Test.get_react(html, component: "UserCard")

      assert react.component == "UserCard"
      assert react.props == %{"firstName" => "Jane"}
    end

    test "finds specific component by id" do
      html = render_component(&multi_component/1)
      react = Test.get_react(html, id: "card-1")

      assert react.component == "UserCard"
      assert react.id == "card-1"
    end

    test "raises error when component selector is not found" do
      html = render_component(&multi_component/1)

      assert_raise RuntimeError,
                   ~r/No LiveViewReact component found with component="Unknown".*Available components: UserProfile#profile-1, UserCard#card-1/,
                   fn ->
                     Test.get_react(html, component: "Unknown")
                   end
    end

    test "raises error when component with id not found" do
      html = render_component(&multi_component/1)

      assert_raise RuntimeError,
                   ~r/No LiveViewReact component found with id="unknown-id".*Available components: UserProfile#profile-1, UserCard#card-1/,
                   fn ->
                     Test.get_react(html, id: "unknown-id")
                   end
    end
  end

  describe "styling" do
    def styled_component(assigns) do
      ~H"""
      <.react id="styled" component="MyComponent" class="bg-blue-500 rounded-sm" />
      """
    end

    test "applies CSS classes" do
      html = render_component(&styled_component/1)
      react = Test.get_react(html)

      assert react.class == "bg-blue-500 rounded-sm"
    end
  end

  describe "SSR behavior" do
    def ssr_component(assigns) do
      ~H"""
      <.react id="without-ssr" component="MyComponent" ssr={false} />
      """
    end

    test "respects SSR flag" do
      html = render_component(&ssr_component/1)
      react = Test.get_react(html)

      assert react.ssr == false
    end
  end

  describe "slots" do
    def component_with_named_slot(assigns) do
      ~H"""
      <.react id="named-slot" component="WithSlots">
        <:hello>Simple content</:hello>
      </.react>
      """
    end

    def component_with_inner_block(assigns) do
      ~H"""
      <.react id="default-slot" component="WithSlots">
        Simple content
      </.react>
      """
    end

    def component_with_untrusted_slot(assigns) do
      assigns = assign(assigns, :untrusted, ~S|<img src=x onerror="alert(1)">|)

      ~H"""
      <.react id="untrusted-slot" component="WithSlots">
        {@untrusted}
      </.react>
      """
    end

    test "warns about usage of named slot" do
      assert_raise RuntimeError,
                   "Unsupported slot: hello, only one default slot is supported, passed as React children.",
                   fn -> render_component(&component_with_named_slot/1) end
    end

    test "renders default slot with inner_block" do
      html = render_component(&component_with_inner_block/1)
      react = Test.get_react(html)

      assert react.slots == %{"default" => "Simple content"}
    end

    test "encodes slot as base64" do
      html = render_component(&component_with_inner_block/1)

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
      html = render_component(&component_with_untrusted_slot/1)
      react = Test.get_react(html)

      assert react.slots == %{
               "default" => "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
             }
    end

    test "handles empty slots" do
      html =
        render_component(fn assigns ->
          ~H"""
          <.react id="empty-slot" component="WithSlots" />
          """
        end)

      react = Test.get_react(html)

      assert react.slots == %{}
    end
  end
end
