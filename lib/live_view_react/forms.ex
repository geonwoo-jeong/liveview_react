defmodule LiveViewReact.Forms do
  @moduledoc """
  Normalizes `Phoenix.HTML.Form` values for React clients.

  Form metadata is deliberately limited to a monotonic client revision. Submit
  results use a dedicated LiveView push event because React may coalesce
  consecutive prop snapshots before committing either one.

  Ecto relations present in a changeset are normalized recursively. Unchanged
  embeds with an explicit cast callback are also normalized so their required
  tree remains available. Unchanged associations stay as leaf values and are
  left to `LiveViewReact.Encoder`; this prevents implicit traversal of loaded,
  bidirectional association graphs.
  """

  alias LiveViewReact.Encoder

  @ecto_form_impl :"Elixir.Phoenix.HTML.FormData.Ecto.Changeset"
  @ecto_adapter :"Elixir.LiveViewReact.Forms.Ecto"
  @revision_option :liveview_react_revision
  @revision_param "_liveview_react_revision"
  @submit_event "liveview_react:form_submit"
  @maximum_safe_integer 9_007_199_254_740_991
  @metadata_keys [:revision]

  @typedoc "A JavaScript-safe, non-negative form revision."
  @type revision :: 0..9_007_199_254_740_991

  @doc """
  Returns a new form with validated LiveViewReact metadata.

  Only `:revision` is accepted. The original form and its source are never
  mutated. Omitting it preserves the current revision, or uses zero when the
  form has none.
  """
  @spec with_metadata(Phoenix.HTML.Form.t(), Keyword.t()) :: Phoenix.HTML.Form.t()
  def with_metadata(%Phoenix.HTML.Form{} = form, metadata) do
    metadata = validate_metadata!(metadata)
    revision = Keyword.get(metadata, :revision, revision(form))
    validate_revision!(revision)

    options =
      form.options
      |> validate_options!()
      |> Keyword.delete(@revision_option)
      |> Keyword.put(@revision_option, revision)

    %{form | options: options}
  end

  @doc """
  Pushes the reply for a native LiveView form submission.

  The event is dispatched before the accompanying DOM patch so a subsequent
  validation render cannot erase a one-shot result. React clients correlate the
  event by form ID, form name, and revision. The updated socket is returned and
  the input form remains unchanged.
  """
  @spec reply(Phoenix.LiveView.Socket.t(), Phoenix.HTML.Form.t(), term()) ::
          Phoenix.LiveView.Socket.t()
  def reply(%Phoenix.LiveView.Socket{} = socket, %Phoenix.HTML.Form{} = form, reply) do
    {id, name} = form_identity!(form)

    payload =
      Encoder.encode(
        %{
          id: id,
          name: name,
          reply: reply,
          revision: revision(form)
        },
        []
      )

    Phoenix.LiveView.push_event(socket, @submit_event, payload, dispatch: :before)
  end

  @doc """
  Copies the exact LiveViewReact revision field from event params onto a form.

  The params map may contain ordinary application fields, but only
  `"#{@revision_param}"` is read. A missing field raises instead of silently
  accepting an uncorrelated server response.
  """
  @spec with_revision_from_params(Phoenix.HTML.Form.t(), map()) :: Phoenix.HTML.Form.t()
  def with_revision_from_params(%Phoenix.HTML.Form{} = form, params) when is_map(params) do
    revision =
      case Map.fetch(params, @revision_param) do
        {:ok, value} -> validate_event_revision!(value)
        :error -> raise ArgumentError, "missing #{@revision_param} event parameter"
      end

    with_metadata(form, revision: revision)
  end

  def with_revision_from_params(%Phoenix.HTML.Form{}, params) do
    raise ArgumentError, "event params must be a map, got: #{inspect(params)}"
  end

  @doc false
  @spec encode(Phoenix.HTML.Form.t(), Encoder.opts()) :: map()
  def encode(%Phoenix.HTML.Form{} = form, opts) do
    {id, name} = form_identity!(form)

    payload =
      form
      |> form_snapshot(opts)
      |> Map.merge(%{id: id, name: name, revision: revision(form)})

    Encoder.encode(payload, opts)
  end

  defp form_snapshot(%Phoenix.HTML.Form{impl: @ecto_form_impl, source: source}, opts) do
    call_ecto_adapter!(:normalize, [source, opts])
  end

  defp form_snapshot(form, _opts) do
    values =
      form.hidden
      |> Map.new()
      |> Map.merge(map_data(form.data))
      |> Map.merge(Map.new(form.params))

    %{
      values: values,
      errors: translate_errors(form.errors),
      required: %{},
      valid: form.errors == []
    }
  end

  defp revision(form) do
    form.options
    |> metadata_option(@revision_option, 0)
    |> validate_revision!()
  end

  defp metadata_option(options, key, default) do
    options = validate_options!(options)

    case Keyword.get_values(options, key) do
      [] -> default
      [value] -> value
      _values -> raise ArgumentError, "duplicate #{inspect(key)} form option"
    end
  end

  defp validate_metadata!(metadata) do
    unless Keyword.keyword?(metadata) do
      raise ArgumentError,
            "form metadata must be a keyword list containing only #{inspect(@metadata_keys)}"
    end

    duplicate_keys =
      metadata
      |> Keyword.keys()
      |> Enum.frequencies()
      |> Enum.filter(fn {_key, count} -> count > 1 end)
      |> Enum.map(&elem(&1, 0))

    unknown_keys = Keyword.keys(metadata) -- @metadata_keys

    cond do
      duplicate_keys != [] ->
        raise ArgumentError, "duplicate form metadata keys: #{inspect(duplicate_keys)}"

      unknown_keys != [] ->
        raise ArgumentError, "unknown form metadata keys: #{inspect(unknown_keys)}"

      true ->
        metadata
    end
  end

  defp validate_options!(options) do
    if Keyword.keyword?(options) do
      options
    else
      raise ArgumentError, "Phoenix.HTML.Form options must be a keyword list"
    end
  end

  defp validate_revision!(revision)
       when is_integer(revision) and revision >= 0 and revision <= @maximum_safe_integer,
       do: revision

  defp validate_revision!(revision) do
    raise ArgumentError,
          "form revision must be an integer from 0 through #{@maximum_safe_integer}, got: #{inspect(revision)}"
  end

  defp validate_event_revision!(revision) when is_integer(revision),
    do: validate_revision!(revision)

  defp validate_event_revision!(revision) when is_binary(revision) do
    if byte_size(revision) <= 16 and Regex.match?(~r/\A(?:0|[1-9][0-9]*)\z/, revision) do
      revision
      |> String.to_integer()
      |> validate_revision!()
    else
      raise ArgumentError,
            "event form revision must be a canonical non-negative decimal integer, got: #{inspect(revision)}"
    end
  end

  defp validate_event_revision!(revision) do
    raise ArgumentError,
          "event form revision must be an integer or canonical decimal string, got: #{inspect(revision)}"
  end

  defp translate_errors(errors) do
    Enum.reduce(errors, %{}, fn {field, error}, translated ->
      translated_error = translate_error(error)

      Map.update(translated, field, [translated_error], fn field_errors ->
        field_errors ++ [translated_error]
      end)
    end)
  end

  defp translate_error({message, replacements}) when is_binary(message) do
    Enum.reduce(replacements, message, fn {key, value}, translated ->
      String.replace(translated, "%{#{key}}", replacement_value(value))
    end)
  end

  defp translate_error(message) when is_binary(message), do: message

  defp translate_error(error) do
    raise ArgumentError, "invalid Phoenix form error: #{inspect(error)}"
  end

  defp replacement_value(value) do
    value
    |> List.wrap()
    |> Enum.map_join(", ", fn
      item when is_binary(item) or is_atom(item) or is_number(item) -> to_string(item)
      item -> inspect(item)
    end)
  end

  defp call_ecto_adapter!(function, arguments) do
    if Code.ensure_loaded?(@ecto_adapter) do
      apply(@ecto_adapter, function, arguments)
    else
      raise ArgumentError,
            "Ecto-backed forms require the optional :ecto and :phoenix_ecto dependencies"
    end
  end

  defp map_data(data) when is_map(data), do: Map.new(data)
  defp map_data(nil), do: %{}

  defp map_data(data) do
    raise ArgumentError, "Phoenix.HTML.Form data must be a map, got: #{inspect(data)}"
  end

  defp form_identity!(%Phoenix.HTML.Form{id: id, name: name})
       when is_binary(id) and id != "" and is_binary(name) and name != "",
       do: {id, name}

  defp form_identity!(%Phoenix.HTML.Form{id: id, name: name}) do
    raise ArgumentError,
          "Phoenix.HTML.Form id and name must be non-empty strings, got: #{inspect({id, name})}"
  end
end
