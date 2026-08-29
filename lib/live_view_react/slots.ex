defmodule LiveViewReact.Slots do
  @moduledoc false

  import Phoenix.Component
  alias Phoenix.HTML.Safe

  @slot_name ~r/\A[a-z][A-Za-z0-9_]*\z/
  @unsupported_slot_patterns [
    {~r/<form(?:\s|\/?>)/i, "forms"},
    {~r/<[^>]+\sphx-hook\s*=/i, "Phoenix hooks"},
    {~r/<[^>]+\s(?:phx-[A-Za-z0-9_:-]+|data-phx-[A-Za-z0-9_:-]+)\s*=/i,
     "Phoenix-managed bindings"},
    {~r/<[^>]+\s(?:data-react-target|data-liveview-react-version)(?:\s|=|>)/i,
     "nested React roots"}
  ]

  @doc false
  def rendered_slot_map(assigns) do
    Enum.reduce(assigns, %{}, fn {key, slot}, rendered ->
      slot_name = slot_name!(key)
      html = render_slot_html!(slot_name, slot)

      cond do
        html == "" ->
          rendered

        Map.has_key?(rendered, slot_name) ->
          raise ArgumentError,
                "LiveViewReact.react/1 received more than one slot mapped to #{inspect(slot_name)}"

        true ->
          Map.put(rendered, slot_name, html)
      end
    end)
  end

  @doc false
  def base_encode_64(assigns) do
    for {key, value} <- assigns, into: %{}, do: {key, Base.encode64(value)}
  end

  @doc false
  def prop_name("default"), do: "children"
  def prop_name(slot_name) when is_binary(slot_name), do: slot_name

  @doc false
  defp render(assigns) do
    ~H"""
    <%= if assigns[:slot] do %>
      <%= render_slot(@slot) %>
    <% end %>
    """
    |> Safe.to_iodata()
    |> List.to_string()
    |> String.trim()
  end

  defp slot_name!(:inner_block), do: "default"

  defp slot_name!(name) when is_atom(name), do: name |> Atom.to_string() |> slot_name!()

  defp slot_name!("children") do
    raise ArgumentError,
          "LiveViewReact.react/1 reserves the slot name \"children\" for the default slot"
  end

  defp slot_name!(name) when is_binary(name) do
    if name == "default" or Regex.match?(@slot_name, name) do
      name
    else
      raise ArgumentError,
            "LiveViewReact.react/1 requires named slots to use lower camelCase or snake_case names, got: #{inspect(name)}"
    end
  end

  defp render_slot_html!(slot_name, slot) do
    html = render(%{slot: slot})
    validate_slot_html!(slot_name, html)
    html
  end

  defp validate_slot_html!(slot_name, html) do
    case Enum.find(@unsupported_slot_patterns, fn {pattern, _reason} ->
           Regex.match?(pattern, html)
         end) do
      nil ->
        :ok

      {_pattern, reason} ->
        raise ArgumentError,
              "Unsupported interactive content in slot #{inspect(slot_name)}: #{reason} cannot be transported through liveview_react slots"
    end
  end
end
