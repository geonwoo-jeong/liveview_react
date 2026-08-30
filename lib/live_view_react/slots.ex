defmodule LiveViewReact.Slots do
  @moduledoc false

  import Phoenix.Component
  alias Phoenix.HTML.Safe

  @default_slot_assign :inner_block
  @named_slot_assign :slot
  @default_slot_name "default"
  @slot_name ~r/\A[a-z][A-Za-z0-9_]*\z/
  @unsafe_property_names ~w(__proto__ constructor prototype)
  @slot_tag_name ~r/\A([A-Za-z][A-Za-z0-9:-]*)/
  @slot_attribute_name ~r/\A([^\s\/>=<"'`\x00]+)/
  @html_whitespace_only ~r/\A[\x20\t\n\f\r]*\z/
  @safe_slot_tags ~w(
    abbr address article aside b bdi bdo blockquote br caption code col colgroup
    dd del dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header
    hgroup hr i ins kbd li main mark nav ol p pre q rp rt ruby s samp section
    small span strong sub sup table tbody td tfoot th thead time tr u ul var wbr
  )
  @safe_slot_attributes ~w(
    abbr class colspan datetime dir headers hidden id inert lang reversed role
    rowspan scope span start title translate type value
  )
  @url_slot_attributes ~w(
    action archive background cite classid codebase data formaction href icon
    itemid itemtype longdesc manifest ping poster profile src srcdoc srcset usemap
    xlink:href
  )
  @nested_root_attributes ~w(
    data-react-checksum data-react-hydration data-react-target data-reactid data-reactroot
  )
  @safe_prefixed_attribute ~r/\A(?:aria|data)-[a-z0-9_.:-]+\z/

  @doc """
  Renders the reserved slot assigns into their transport-ready HTML map.

  The default slot arrives as `:inner_block` and every named slot arrives as an
  entry of the reserved `:slot` assign, so slot identity never depends on the
  shape of an assign's value. Slots that render to nothing are omitted.
  """
  def rendered_slot_map(assigns) do
    assigns
    |> Enum.flat_map(&slot_entries!/1)
    |> group_entries_by_name()
    |> Enum.reduce(%{}, fn {slot_name, entries}, rendered ->
      html = render_slot_html!(slot_name, entries)

      if Regex.match?(@html_whitespace_only, html),
        do: rendered,
        else: Map.put(rendered, slot_name, html)
    end)
  end

  # HEEx renders repeated same-name slots as one concatenated block. Grouping
  # keeps that behaviour while preserving first-appearance order.
  defp group_entries_by_name(entries) do
    {order, groups} =
      Enum.reduce(entries, {[], %{}}, fn {name, entry}, {order, groups} ->
        case groups do
          %{^name => existing} -> {order, %{groups | name => [entry | existing]}}
          %{} -> {[name | order], Map.put(groups, name, [entry])}
        end
      end)

    order
    |> Enum.reverse()
    |> Enum.map(&{&1, groups |> Map.fetch!(&1) |> Enum.reverse()})
  end

  @doc false
  def base_encode_64(assigns) do
    for {key, value} <- assigns, into: %{}, do: {key, Base.encode64(value)}
  end

  @doc false
  def prop_name(@default_slot_name), do: "children"
  def prop_name(slot_name) when is_binary(slot_name), do: slot_name

  defp slot_entries!({@default_slot_assign, entries}) when is_list(entries),
    do: Enum.map(entries, &{@default_slot_name, &1})

  defp slot_entries!({@default_slot_assign, entry}), do: [{@default_slot_name, entry}]

  defp slot_entries!({@named_slot_assign, entries}) when is_list(entries) do
    Enum.map(entries, &{named_slot_name!(&1), &1})
  end

  defp slot_entries!({@named_slot_assign, entries}) do
    raise ArgumentError,
          "LiveViewReact.react/1 requires named slots to be written as " <>
            "<:slot name=\"...\">, got: #{inspect(entries)}"
  end

  defp named_slot_name!(%{name: name}) when is_binary(name), do: validate_slot_name!(name)

  defp named_slot_name!(%{name: name}) do
    raise ArgumentError,
          "LiveViewReact.react/1 requires <:slot name=\"...\"> to be a string, got: #{inspect(name)}"
  end

  defp named_slot_name!(_entry) do
    raise ArgumentError,
          ~s(LiveViewReact.react/1 requires every <:slot> to declare a name, as in <:slot name="header">)
  end

  defp validate_slot_name!(@default_slot_name) do
    raise ArgumentError,
          "LiveViewReact.react/1 reserves the slot name \"#{@default_slot_name}\" for the element body"
  end

  defp validate_slot_name!("children") do
    raise ArgumentError,
          "LiveViewReact.react/1 reserves the slot name \"children\" for the default slot"
  end

  defp validate_slot_name!(name) when name in @unsafe_property_names do
    raise ArgumentError,
          "LiveViewReact.react/1 cannot transport the prototype-sensitive slot name #{inspect(name)}"
  end

  defp validate_slot_name!(name) do
    if Regex.match?(@slot_name, name) do
      name
    else
      raise ArgumentError,
            "LiveViewReact.react/1 requires named slots to use lower camelCase or snake_case names, " <>
              "got: #{inspect(name)}"
    end
  end

  defp render_slot_html!(slot_name, slot) do
    html = render(%{slot: slot})

    validate_slot_html!(slot_name, html)
    html
  end

  defp render(assigns),
    do:
      ~H"<%= if assigns[:slot], do: render_slot(@slot) %>"
      |> Safe.to_iodata()
      |> IO.iodata_to_binary()

  defp validate_slot_html!(slot_name, html) do
    case scan_slot_html(html) do
      :ok ->
        :ok

      {:error, reason} ->
        raise ArgumentError,
              "Unsupported interactive content in slot #{inspect(slot_name)}: #{reason} cannot be transported through liveview_react slots"
    end
  end

  defp scan_slot_html(html) do
    case :binary.match(html, "<") do
      :nomatch ->
        :ok

      {index, 1} ->
        rest = binary_part(html, index + 1, byte_size(html) - index - 1)
        scan_slot_markup(rest)
    end
  end

  defp scan_slot_markup(<<"!--", rest::binary>>), do: scan_slot_comment(rest)
  defp scan_slot_markup(<<?!, _rest::binary>>), do: {:error, "markup declarations"}
  defp scan_slot_markup(<<??, _rest::binary>>), do: {:error, "processing instructions"}
  defp scan_slot_markup(<<?/, rest::binary>>), do: scan_closing_slot_tag(rest)

  defp scan_slot_markup(<<first, _rest::binary>> = html)
       when first in ?A..?Z or first in ?a..?z,
       do: scan_opening_slot_tag(html)

  defp scan_slot_markup(html), do: scan_slot_html(html)

  defp scan_slot_comment(html) do
    case :binary.match(html, "-->") do
      :nomatch ->
        {:error, "malformed HTML"}

      {index, 3} ->
        comment = binary_part(html, 0, index)
        rest = binary_part(html, index + 3, byte_size(html) - index - 3)

        if valid_slot_comment?(comment),
          do: scan_slot_html(rest),
          else: {:error, "markup declarations"}
    end
  end

  defp valid_slot_comment?(comment) do
    not String.starts_with?(comment, [">", "->"]) and
      not String.contains?(comment, ["<!--", "--!>"]) and
      not String.ends_with?(comment, "<!-")
  end

  defp scan_opening_slot_tag(html) do
    with {:ok, tag_name, rest} <- take_slot_name(html),
         {:ok, rest} <- scan_slot_attributes(rest),
         :ok <- validate_slot_tag(tag_name) do
      scan_slot_html(rest)
    end
  end

  defp scan_closing_slot_tag(html) do
    with {:ok, tag_name, rest} <- take_slot_name(html),
         :ok <- validate_slot_tag(tag_name),
         <<">", rest::binary>> <- trim_html_whitespace(rest) do
      scan_slot_html(rest)
    else
      {:error, _reason} = error -> error
      _other -> {:error, "malformed HTML"}
    end
  end

  defp take_slot_name(html) do
    case Regex.run(@slot_tag_name, html) do
      [matched, name] ->
        rest = binary_part(html, byte_size(matched), byte_size(html) - byte_size(matched))
        {:ok, String.downcase(name, :ascii), rest}

      nil ->
        {:error, "malformed HTML"}
    end
  end

  defp validate_slot_tag("form"), do: {:error, "forms"}
  defp validate_slot_tag(tag_name) when tag_name in @safe_slot_tags, do: :ok

  defp validate_slot_tag(_tag_name),
    do: {:error, "active or resource-bearing markup"}

  defp scan_slot_attributes(html) do
    case trim_html_whitespace(html) do
      <<">", rest::binary>> ->
        {:ok, rest}

      <<"/>", rest::binary>> ->
        {:ok, rest}

      <<>> ->
        {:error, "malformed HTML"}

      <<?/, _rest::binary>> ->
        {:error, "malformed HTML"}

      html ->
        scan_slot_attribute(html)
    end
  end

  defp scan_slot_attribute(html) do
    case Regex.run(@slot_attribute_name, html) do
      [matched, name] ->
        rest = binary_part(html, byte_size(matched), byte_size(html) - byte_size(matched))

        with :ok <- validate_slot_attribute(String.downcase(name, :ascii)),
             {:ok, rest} <- consume_slot_attribute_value(rest) do
          scan_slot_attributes(rest)
        end

      nil ->
        {:error, "malformed HTML"}
    end
  end

  defp validate_slot_attribute("phx-hook"), do: {:error, "Phoenix hooks"}
  defp validate_slot_attribute("style"), do: {:error, "style attributes"}

  defp validate_slot_attribute(name) when name in @url_slot_attributes,
    do: {:error, "URL-bearing attributes"}

  defp validate_slot_attribute(name) do
    case prefixed_slot_attribute_violation(name) do
      nil -> validate_safe_slot_attribute(name)
      violation -> {:error, violation}
    end
  end

  defp prefixed_slot_attribute_violation(name) do
    cond do
      String.starts_with?(name, "phx-") or String.starts_with?(name, "data-phx-") ->
        "Phoenix-managed bindings"

      name in @nested_root_attributes or
          String.starts_with?(name, "data-liveview-react-") ->
        "nested React roots"

      String.starts_with?(name, "on") ->
        "event handler attributes"

      true ->
        nil
    end
  end

  defp validate_safe_slot_attribute(name) do
    if name in @safe_slot_attributes or Regex.match?(@safe_prefixed_attribute, name),
      do: :ok,
      else: {:error, "non-inert attribute #{inspect(name)}"}
  end

  defp consume_slot_attribute_value(html) do
    case trim_html_whitespace(html) do
      <<?=, rest::binary>> -> consume_slot_attribute_value_after_equals(rest)
      rest -> {:ok, rest}
    end
  end

  defp consume_slot_attribute_value_after_equals(html) do
    case trim_html_whitespace(html) do
      <<quote, rest::binary>> when quote in [?", ?'] -> consume_quoted_slot_value(rest, quote)
      <<>> -> {:error, "malformed HTML"}
      rest -> consume_unquoted_slot_value(rest, false)
    end
  end

  defp consume_quoted_slot_value(html, quote) do
    case :binary.match(html, <<quote>>) do
      :nomatch ->
        {:error, "malformed HTML"}

      {index, 1} ->
        {:ok, binary_part(html, index + 1, byte_size(html) - index - 1)}
    end
  end

  defp consume_unquoted_slot_value(<<>>, false), do: {:error, "malformed HTML"}
  defp consume_unquoted_slot_value(<<>>, true), do: {:ok, <<>>}

  defp consume_unquoted_slot_value(<<byte, _rest::binary>> = html, consumed?)
       when byte in [32, 9, 10, 12, 13, ?>] do
    if consumed?, do: {:ok, html}, else: {:error, "malformed HTML"}
  end

  defp consume_unquoted_slot_value(<<byte, _rest::binary>>, _consumed?)
       when byte in [?", ?', ?`, ?=, ?<],
       do: {:error, "malformed HTML"}

  defp consume_unquoted_slot_value(<<_byte, rest::binary>>, _consumed?),
    do: consume_unquoted_slot_value(rest, true)

  defp trim_html_whitespace(<<byte, rest::binary>>) when byte in [32, 9, 10, 12, 13],
    do: trim_html_whitespace(rest)

  defp trim_html_whitespace(html), do: html
end
