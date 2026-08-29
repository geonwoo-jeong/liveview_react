defmodule LiveViewReact.Events do
  @moduledoc false

  alias Phoenix.LiveView.JS

  @attribute_prefix "r-on:"
  @event_name ~r/\A[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*\z/

  @type commands :: list()
  @type event_map :: %{String.t() => commands()}

  @spec attribute?(term()) :: boolean()
  def attribute?(key) when is_binary(key), do: String.starts_with?(key, @attribute_prefix)
  def attribute?(key) when is_atom(key), do: key |> Atom.to_string() |> attribute?()
  def attribute?(_key), do: false

  @spec extract(map(), map()) :: {event_map(), boolean()}
  def extract(assigns, props) when is_map(assigns) and is_map(props) do
    entries = Enum.filter(assigns, fn {key, _value} -> attribute?(key) end)
    prop_names = props |> Map.keys() |> MapSet.new(&to_string/1)

    Enum.reduce(entries, {%{}, false}, fn {attribute, value}, {events, changed?} ->
      event_name = attribute |> to_string() |> event_name!()
      react_prop = react_prop_name(event_name)
      reject_prop_collision!(attribute, react_prop, prop_names)

      next_events =
        case value do
          nil -> events
          %JS{} = js -> Map.put(events, react_prop, normalize_json(JS.to_encodable(js)))
          invalid -> raise_invalid_value!(attribute, invalid)
        end

      {next_events, changed? or changed?(assigns, attribute)}
    end)
  end

  defp event_name!(@attribute_prefix <> event_name = attribute) do
    if Regex.match?(@event_name, event_name) do
      event_name
    else
      raise ArgumentError,
            ~s(LiveViewReact.react/1 requires #{inspect(attribute)} to use a lowercase kebab-case event name)
    end
  end

  defp react_prop_name(event_name) do
    "on" <> (event_name |> String.split("-") |> Enum.map_join(&String.capitalize/1))
  end

  defp reject_prop_collision!(attribute, react_prop, prop_names) do
    if MapSet.member?(prop_names, react_prop) do
      raise ArgumentError,
            ~s(LiveViewReact.react/1 cannot transport both #{inspect(attribute)} and the ordinary prop #{inspect(react_prop)})
    end
  end

  defp raise_invalid_value!(attribute, value) do
    raise ArgumentError,
          ~s(LiveViewReact.react/1 requires #{inspect(attribute)} to be a Phoenix.LiveView.JS command or nil, got: #{inspect(value)})
  end

  defp normalize_json(value) when is_list(value), do: Enum.map(value, &normalize_json/1)

  defp normalize_json(value) when is_map(value) do
    value
    |> Enum.map(fn {key, item} -> {to_string(key), normalize_json(item)} end)
    |> Map.new()
  end

  defp normalize_json(value), do: value

  defp changed?(%{__changed__: nil}, _key), do: true
  defp changed?(%{__changed__: changed}, key), do: Map.has_key?(changed, key)
end
