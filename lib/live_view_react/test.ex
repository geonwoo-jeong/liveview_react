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
    * `:hydration` - The decoded immutable SSR hydration descriptor, or `nil`
    * `:props_kind` - `"snapshot"` or `"patch"`
    * `:streams_kind` - `"snapshot"` or `"patch"`
    * `:transport_version` - the integer wire protocol version

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

      component = attr(react, "data-component")
      id = attr(react, "id")
      react_target = direct_react_target!(react)
      hydration = decode_hydration_descriptor(react_target)
      validate_hydration_component!(hydration, component)
      validate_hydration_identifier_prefix!(hydration, id)

      %{
        props: decode_props(attr(react, "data-props")),
        component: component,
        id: id,
        slots: extract_base64_slots(attr(react, "data-slots")),
        ssr: hydration != nil,
        hydration: hydration,
        transport_version: decode_transport_version(attr(react, "data-liveview-react-version")),
        props_kind: attr(react, "data-props-kind"),
        props_diff: LiveViewReact.Patch.deserialize(attr(react, "data-props-diff") || ""),
        streams_diff: LiveViewReact.Patch.deserialize(attr(react, "data-streams-diff") || ""),
        streams_kind: attr(react, "data-streams-kind")
      }
    else
      raise "Floki is not installed. Add {:floki, \"~> 0.38\", only: :test} to use LiveViewReact.Test"
    end
  end

  defp decode_props(nil), do: nil
  defp decode_props(props), do: LiveViewReact.Patch.decode_object(props)

  defp decode_transport_version("1"), do: 1

  defp decode_transport_version(_version) do
    raise "LiveViewReact root must use transport version 1"
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

  defp direct_react_target!(react) do
    targets =
      Enum.filter(Floki.children(react), fn
        {_tag, _attributes, _children} = child -> has_attr?(child, "data-react-target")
        _other -> false
      end)

    case targets do
      [target] -> target
      _targets -> raise "LiveViewReact root must contain exactly one direct React target"
    end
  end

  defp has_attr?(element, name), do: Floki.attribute(element, name) != []

  defp decode_hydration_descriptor(target) do
    case attr(target, "data-react-hydration") do
      nil -> nil
      descriptor -> descriptor |> Jason.decode!() |> validate_hydration_descriptor!()
    end
  end

  defp validate_hydration_descriptor!(
         %{
           "version" => 1,
           "component" => component,
           "identifierPrefix" => identifier_prefix,
           "props" => props,
           "slots" => slots
         } = descriptor
       )
       when map_size(descriptor) == 5 and is_binary(component) and component != "" and
              is_binary(identifier_prefix) and identifier_prefix != "" and is_map(props) and
              is_map(slots) do
    if Enum.all?(slots, fn {name, html} -> is_binary(name) and is_binary(html) end) do
      descriptor
    else
      raise "Invalid data-react-hydration descriptor"
    end
  end

  defp validate_hydration_descriptor!(_descriptor) do
    raise "Invalid data-react-hydration descriptor"
  end

  defp validate_hydration_component!(nil, _component), do: :ok

  defp validate_hydration_component!(%{"component" => component}, component), do: :ok

  defp validate_hydration_component!(_hydration, _component) do
    raise "data-react-hydration component must match data-component"
  end

  defp validate_hydration_identifier_prefix!(nil, _id), do: :ok

  defp validate_hydration_identifier_prefix!(
         %{"identifierPrefix" => "liveview-react-" <> rest},
         id
       )
       when rest == id <> "-" do
    :ok
  end

  defp validate_hydration_identifier_prefix!(_hydration, _id) do
    raise "data-react-hydration identifierPrefix must match the root id"
  end
end
