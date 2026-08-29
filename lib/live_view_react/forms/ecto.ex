if Code.ensure_loaded?(Ecto.Changeset) and
     Code.ensure_loaded?(Phoenix.HTML.FormData.Ecto.Changeset) do
  defmodule LiveViewReact.Forms.Ecto do
    @moduledoc false

    alias Ecto.Association.NotLoaded
    alias Phoenix.HTML.FormData

    @relations [:embed, :assoc]

    @type snapshot :: %{
            values: map(),
            errors: map(),
            required: map(),
            valid: boolean()
          }

    @spec normalize(Ecto.Changeset.t(), Keyword.t()) :: snapshot()
    def normalize(%Ecto.Changeset{} = changeset, opts) do
      parent_form = FormData.to_form(changeset, as: "liveview_react")

      changeset
      |> base_snapshot()
      |> add_relation_snapshots(changeset, parent_form, opts)
    end

    defp base_snapshot(changeset) do
      field_values =
        Map.new(changeset.types, fn {field, type} ->
          {field, base_field_value(changeset, field, type)}
        end)

      values =
        changeset.data
        |> merge_data(field_values)
        |> Map.delete(:__meta__)

      %{
        values: values,
        errors: translate_errors(changeset.errors),
        required: Map.new(changeset.required, &{&1, true}),
        valid: changeset.valid?
      }
    end

    defp base_field_value(changeset, field, {tag, _relation}) when tag in @relations do
      relation_data(changeset, field)
    end

    defp base_field_value(changeset, field, _type) do
      Phoenix.HTML.FormData.Ecto.Changeset.input_value(
        changeset,
        %{params: changeset.params},
        field
      )
    end

    defp add_relation_snapshots(snapshot, changeset, parent_form, opts) do
      Enum.reduce(changeset.types, snapshot, fn {field, type}, normalized ->
        put_relation_snapshot(normalized, changeset, parent_form, field, type, opts)
      end)
    end

    defp put_relation_snapshot(
           snapshot,
           changeset,
           parent_form,
           field,
           {tag, %{cardinality: cardinality} = relation},
           opts
         )
         when tag in @relations do
      case relation_data(changeset, field) do
        %NotLoaded{} = not_loaded ->
          put_unloaded_value(snapshot, field, not_loaded, opts)

        _loaded ->
          if normalize_relation?(changeset, field, tag, relation) do
            children =
              changeset
              |> FormData.to_form(parent_form, field, [])
              |> Enum.map(&normalize(&1.source, opts))

            put_children(snapshot, field, cardinality, children)
          else
            snapshot
          end
      end
    end

    defp put_relation_snapshot(snapshot, _changeset, _parent_form, _field, _type, _opts),
      do: snapshot

    defp normalize_relation?(changeset, field, tag, _relation) do
      tag == :embed or Map.has_key?(changeset.changes, field)
    end

    defp put_unloaded_value(snapshot, field, not_loaded, opts) do
      value = if Keyword.get(opts, :nilify_not_loaded, false), do: nil, else: not_loaded
      put_value(snapshot, field, value)
    end

    defp put_children(snapshot, field, :one, []) do
      put_value(snapshot, field, nil)
    end

    defp put_children(snapshot, field, :one, [child]) do
      snapshot
      |> put_value(field, child.values)
      |> put_child_errors(field, child.errors)
      |> put_child_required(field, child.required)
      |> Map.update!(:valid, &(&1 and child.valid))
    end

    defp put_children(snapshot, field, :many, children) do
      errors = Enum.map(children, &nil_if_empty(&1.errors))
      required = Enum.map(children, & &1.required)
      children_valid? = Enum.all?(children, & &1.valid)

      snapshot
      |> put_value(field, Enum.map(children, & &1.values))
      |> put_child_errors(field, errors)
      |> put_child_required(field, required)
      |> Map.update!(:valid, &(&1 and children_valid?))
    end

    defp put_children(_snapshot, field, cardinality, children) do
      raise ArgumentError,
            "invalid #{inspect(cardinality)} relation snapshot for #{inspect(field)}: #{inspect(children)}"
    end

    defp put_child_errors(snapshot, _field, errors) when errors == %{} or errors == [],
      do: snapshot

    defp put_child_errors(snapshot, field, errors) when is_list(errors) do
      if Enum.all?(errors, &is_nil/1),
        do: snapshot,
        else: put_errors(snapshot, field, errors)
    end

    defp put_child_errors(snapshot, field, errors), do: put_errors(snapshot, field, errors)

    defp put_child_required(snapshot, _field, required)
         when required == %{} or required == [],
         do: snapshot

    defp put_child_required(snapshot, field, required) when is_list(required) do
      if Enum.all?(required, &(&1 == %{})) do
        snapshot
      else
        put_required(snapshot, field, required)
      end
    end

    defp put_child_required(snapshot, field, required),
      do: put_required(snapshot, field, required)

    defp put_value(snapshot, field, value),
      do: %{snapshot | values: Map.put(snapshot.values, field, value)}

    defp put_errors(snapshot, field, errors),
      do: %{snapshot | errors: Map.put(snapshot.errors, field, errors)}

    defp put_required(snapshot, field, required),
      do: %{snapshot | required: Map.put(snapshot.required, field, required)}

    defp nil_if_empty(errors) when errors == %{}, do: nil
    defp nil_if_empty(errors), do: errors

    defp relation_data(changeset, field) do
      Map.get(changeset.changes, field, Map.fetch!(changeset.data, field))
    end

    defp merge_data(data, values) when is_struct(data), do: Map.merge(data, values)
    defp merge_data(_data, values), do: values

    defp translate_errors(errors) do
      Enum.reduce(errors, %{}, fn {field, error}, translated ->
        translated_error = translate_error(error)

        Map.update(translated, field, [translated_error], fn field_errors ->
          field_errors ++ [translated_error]
        end)
      end)
    end

    defp translate_error({message, replacements}) do
      Enum.reduce(replacements, message, fn {key, value}, translated ->
        String.replace(translated, "%{#{key}}", replacement_value(value))
      end)
    end

    defp replacement_value(value) do
      value
      |> List.wrap()
      |> Enum.map_join(", ", fn
        item when is_binary(item) or is_atom(item) or is_number(item) -> to_string(item)
        item -> inspect(item)
      end)
    end
  end
end
