defmodule LiveViewReact.Test do
  @moduledoc """
  Helpers for inspecting LiveViewReact roots in rendered LiveView HTML.

  ## Examples

      {:ok, view, _html} = live(conn, "/")
      react = LiveViewReact.Test.get_react(view)

      assert react.component == "MyComponent"
      assert react.props["title"] == "Hello"

  ## Configuration

  ### enable_props_diff

  Set `enable_props_diff` to `false` to inspect full props on every render:

  ```elixir
  # config/test.exs
  config :liveview_react,
    enable_props_diff: false
  ```

  """

  @compile {:no_warn_undefined, Floki}

  @doc """
  Extracts React component information from a LiveView or HTML string.

  When multiple roots are present, select one with `:component` or `:id`.

  Returns a map containing the component's configuration:
    * `:component` - The registry component name
    * `:id` - The required unique component identifier
    * `:props` - The decoded props passed to the component
    * `:slots` - Base64 encoded slot content
    * `:ssr` - Boolean indicating if server-side rendering was performed
    * `:class` - CSS classes applied to the component root element

  ## Options
    * `:component` - Find a root by registry component name
    * `:id` - Find component by ID

  ## Examples

      {:ok, view, _html} = live(conn, "/")
      react = LiveViewReact.Test.get_react(view)

      react = LiveViewReact.Test.get_react(view, component: "MyComponent")
      react = LiveViewReact.Test.get_react(view, id: "my-component-1")
  """
  def get_react(view, opts \\ [])

  def get_react(view, opts) when is_struct(view, Phoenix.LiveViewTest.View) do
    view |> Phoenix.LiveViewTest.render() |> get_react(opts)
  end

  def get_react(html, opts) when is_binary(html) do
    if Code.ensure_loaded?(Floki) do
      react =
        html
        |> Floki.parse_document!()
        |> Floki.find("[phx-hook='LiveViewReactHook']")
        |> find_component!(opts)

      %{
        props: LiveViewReact.Patch.decode_object(attr(react, "data-props")),
        component: attr(react, "data-component"),
        id: attr(react, "id"),
        slots: extract_base64_slots(attr(react, "data-slots")),
        ssr: attr(react, "data-ssr") == "true",
        use_diff: attr(react, "data-use-diff") == "true",
        class: attr(react, "class"),
        props_diff: LiveViewReact.Patch.deserialize(attr(react, "data-props-diff") || ""),
        streams_diff: LiveViewReact.Patch.deserialize(attr(react, "data-streams-diff") || "")
      }
    else
      raise "Floki is not installed. Add {:floki, \"~> 0.38\", only: :test} to use LiveViewReact.Test"
    end
  end

  defp extract_base64_slots(slots) do
    slots
    |> Jason.decode!()
    |> Enum.map(fn {key, value} -> {key, Base.decode64!(value)} end)
    |> Enum.into(%{})
  end

  defp find_component!(components, opts) do
    available =
      Enum.map_join(components, ", ", &"#{attr(&1, "data-component")}##{attr(&1, "id")}")

    components = Enum.reduce(opts, components, &filter_components!(&1, &2, available))

    case components do
      [react | _] ->
        react

      [] ->
        raise "No LiveViewReact components found in the rendered HTML"
    end
  end

  defp filter_components!({:id, id}, components, available) do
    filter_components!(components, "id", id, available)
  end

  defp filter_components!({:component, component}, components, available) do
    filter_components!(components, "data-component", component, available)
  end

  defp filter_components!({key, _value}, _components, _available) do
    raise ArgumentError, "invalid keyword option for get_react/2: #{key}"
  end

  defp filter_components!(components, attribute, value, available) do
    case Enum.filter(components, &(attr(&1, attribute) == value)) do
      [] ->
        label = if attribute == "id", do: "id", else: "component"

        raise "No LiveViewReact component found with #{label}=\"#{value}\". " <>
                "Available components: #{available}"

      matches ->
        matches
    end
  end

  defp attr(element, name) do
    case Floki.attribute(element, name) do
      [value] -> value
      [] -> nil
    end
  end
end
