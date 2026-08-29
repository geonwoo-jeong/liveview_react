defmodule LiveViewReact.Uploads do
  @moduledoc false

  alias LiveViewReact.Encoder
  alias Phoenix.LiveView.{UploadConfig, UploadEntry}
  @max_progress 100

  @spec encode_config(UploadConfig.t(), keyword()) :: map()
  def encode_config(%UploadConfig{} = config, opts) do
    base_entries =
      Enum.map(config.entries, fn entry ->
        encode_entry(entry, opts)
      end)

    entry_refs = MapSet.new(base_entries, & &1.ref)
    errors = encode_errors(config.errors, config.ref, entry_refs, opts)

    entries =
      Enum.map(base_entries, fn entry ->
        Map.put(entry, :errors, errors_for_entry(errors, entry.ref))
      end)

    Encoder.encode(
      %{
        accept: encode_accept(config.accept),
        auto_upload: config.auto_upload?,
        entries: entries,
        errors: errors,
        max_entries: validate_positive_integer!(config.max_entries, "max_entries"),
        max_entries_mode: encode_max_entries_mode(config.max_entries_mode),
        max_file_size: validate_positive_integer!(config.max_file_size, "max_file_size"),
        name: encode_name(config.name),
        ref: validate_non_empty_binary!(config.ref, "ref")
      },
      opts
    )
  end

  @spec encode_entry(UploadEntry.t(), keyword()) :: map()
  def encode_entry(%UploadEntry{} = entry, opts) do
    progress = validate_progress!(entry.progress)

    Encoder.encode(
      %{
        cancelled: entry.cancelled?,
        client_last_modified:
          validate_non_negative_integer!(
            entry.client_last_modified || 0,
            "client_last_modified"
          ),
        client_name: validate_binary!(entry.client_name, "client_name"),
        client_relative_path: entry.client_relative_path || "",
        client_size: validate_non_negative_integer!(entry.client_size, "client_size"),
        client_type: validate_binary!(entry.client_type || "", "client_type"),
        done: entry.done?,
        errors: [],
        preflighted: entry.preflighted?,
        progress: progress,
        ref: validate_non_empty_binary!(entry.ref, "entry ref"),
        valid: entry.valid?
      },
      opts
    )
  end

  defp encode_accept(:any), do: "any"

  defp encode_accept(accept) when is_binary(accept) do
    accept
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> validate_accept_list!()
  end

  defp encode_accept(accept) when is_list(accept),
    do: validate_accept_list!(accept)

  defp encode_accept(accept) do
    raise ArgumentError, "unsupported upload accept contract: #{inspect(accept)}"
  end

  defp encode_max_entries_mode(:selected), do: "selected"
  defp encode_max_entries_mode(:total), do: "total"
  defp encode_max_entries_mode("selected"), do: "selected"
  defp encode_max_entries_mode("total"), do: "total"

  defp encode_max_entries_mode(mode) do
    raise ArgumentError,
          "upload max_entries_mode must be :selected or :total, got: #{inspect(mode)}"
  end

  defp encode_name(name) when is_atom(name),
    do: validate_non_empty_binary!(Atom.to_string(name), "name")

  defp encode_name(name) when is_binary(name),
    do: validate_non_empty_binary!(name, "name")

  defp encode_name(name) do
    raise ArgumentError, "upload name must be an atom or binary, got: #{inspect(name)}"
  end

  defp encode_errors(errors, config_ref, entry_refs, opts) do
    Enum.map(errors, fn {ref, reason} ->
      validate_error_ref!(ref, config_ref, entry_refs)

      %{
        error: Encoder.encode(reason, opts),
        ref: ref
      }
    end)
  end

  defp errors_for_entry(errors, entry_ref) do
    for %{error: error, ref: ^entry_ref} <- errors, do: error
  end

  defp validate_accept_list!(accept) do
    normalized =
      Enum.map(accept, fn entry ->
        entry
        |> validate_binary!("accept entry")
        |> String.trim()
      end)

    cond do
      normalized == [] ->
        raise ArgumentError, "upload accept list must not be empty"

      Enum.any?(normalized, &(&1 == "")) ->
        raise ArgumentError, "upload accept entries must be non-empty strings"

      MapSet.size(MapSet.new(normalized)) != length(normalized) ->
        raise ArgumentError, "upload accept entries must be unique"

      true ->
        normalized
    end
  end

  defp validate_error_ref!(ref, config_ref, entry_refs) do
    ref = validate_non_empty_binary!(ref, "upload error ref")

    if ref == config_ref or MapSet.member?(entry_refs, ref) do
      ref
    else
      raise ArgumentError,
            "upload error ref must match the config ref or an encoded entry ref, got: #{inspect(ref)}"
    end
  end

  defp validate_progress!(progress)
       when is_integer(progress) and progress >= 0 and progress <= @max_progress,
       do: progress

  defp validate_progress!(progress) do
    raise ArgumentError,
          "upload progress must be an integer from 0 through #{@max_progress}, got: #{inspect(progress)}"
  end

  defp validate_positive_integer!(value, _field)
       when is_integer(value) and value > 0,
       do: value

  defp validate_positive_integer!(value, field) do
    raise ArgumentError, "upload #{field} must be a positive integer, got: #{inspect(value)}"
  end

  defp validate_non_negative_integer!(value, _field)
       when is_integer(value) and value >= 0,
       do: value

  defp validate_non_negative_integer!(value, field) do
    raise ArgumentError,
          "upload #{field} must be a non-negative integer, got: #{inspect(value)}"
  end

  defp validate_non_empty_binary!(value, _field)
       when is_binary(value) and value != "",
       do: value

  defp validate_non_empty_binary!(value, field) do
    raise ArgumentError, "upload #{field} must be a non-empty string, got: #{inspect(value)}"
  end

  defp validate_binary!(value, _field) when is_binary(value), do: value

  defp validate_binary!(value, field) do
    raise ArgumentError, "upload #{field} must be a string, got: #{inspect(value)}"
  end
end
