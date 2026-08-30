defprotocol LiveViewReact.Encoder do
  @moduledoc """
  Protocol for encoding values to JSON for LiveViewReact.

  This protocol is used to safely transform structs into plain maps before
  calculating JSON patches. It ensures that struct fields are explicitly
  exposed and prevents accidental exposure of sensitive data.

  It's very similar to Jason.Encoder, but it's converting structs to maps instead of strings.

  ## Deriving

  The protocol allows leveraging Elixir's `@derive` feature to simplify protocol
  implementation in trivial cases. Accepted options are:

  * `:only` - encodes only values of specified keys.
  * `:except` - encodes all struct fields except specified keys.

  Derivation must explicitly provide exactly one of these options. A bare
  `@derive LiveViewReact.Encoder` is rejected so adding a sensitive field to a
  struct cannot silently expose it to the browser.

  ## Example

      defmodule User do
        @derive {LiveViewReact.Encoder, only: [:name, :email]}
        defstruct [:name, :email, :password]
      end

  `only: [:name, :email]` exposes those fields. `except: [:password]` exposes
  every current and future field except `:password`, so `:only` is preferred
  for data-bearing structs.

  ## Deriving outside of the module

      Protocol.derive(LiveViewReact.Encoder, User, only: [...])

  ## Custom implementations

      defimpl LiveViewReact.Encoder, for: User do
        def encode(struct, opts) do
          struct
          |> Map.take([:first, :second])
          |> LiveViewReact.Encoder.encode(opts)
        end
      end
  """

  @typedoc "A value being encoded for LiveViewReact transport."
  @type t :: term()

  @typedoc "Options forwarded unchanged through recursive protocol implementations."
  @type opts :: Keyword.t()
  @fallback_to_any true

  @doc """
  Encodes a value to one of the primitive types.
  """
  @spec encode(t, opts) :: any()
  def encode(value, opts)
end

defimpl LiveViewReact.Encoder, for: Integer do
  def encode(value, _opts), do: value
end

defimpl LiveViewReact.Encoder, for: Float do
  def encode(value, _opts), do: value
end

defimpl LiveViewReact.Encoder, for: BitString do
  def encode(value, _opts), do: value
end

defimpl LiveViewReact.Encoder, for: Atom do
  def encode(atom, _opts), do: atom
end

defimpl LiveViewReact.Encoder, for: List do
  def encode(list, opts) do
    Enum.map(list, &LiveViewReact.Encoder.encode(&1, opts))
  end
end

defimpl LiveViewReact.Encoder, for: Map do
  def encode(map, opts) do
    Map.new(map, fn {key, value} ->
      {key, LiveViewReact.Encoder.encode(value, opts)}
    end)
  end
end

defimpl LiveViewReact.Encoder, for: [Date, Time, NaiveDateTime, DateTime] do
  def encode(value, _opts) do
    @for.to_iso8601(value)
  end
end

defimpl LiveViewReact.Encoder, for: Any do
  defmacro __deriving__(module, struct, opts) do
    fields = fields_to_encode(struct, opts)

    quote do
      defimpl LiveViewReact.Encoder, for: unquote(module) do
        def encode(struct, opts) do
          struct
          |> Map.take(unquote(fields))
          |> LiveViewReact.Encoder.encode(opts)
        end
      end
    end
  end

  def encode(%{__struct__: module} = struct, _opts) do
    raise Protocol.UndefinedError,
      protocol: @protocol,
      value: struct,
      description: """
      LiveViewReact.Encoder protocol must always be explicitly implemented.

      It's used to encode structs to JSON for LiveViewReact. It's very similar to Jason.Encoder,
      but it's converting structs to maps so LiveViewReact can diff them correctly.

      If you own the struct, you can derive the implementation specifying \
      which fields should be encoded:

          defmodule #{inspect(module)} do
            @derive {LiveViewReact.Encoder, only: [...]}
            defstruct ...
          end

      If you don't own the struct you want to encode, \
      you may use Protocol.derive/3 placed outside of any module:

          Protocol.derive(LiveViewReact.Encoder, #{inspect(module)}, only: [...])

      Nothing prevents you from defining your own implementation for the struct:

      defimpl LiveViewReact.Encoder, for: #{inspect(module)} do
        def encode(struct, opts) do
          struct
          |> Map.take([:first, :second])
          |> LiveViewReact.Encoder.encode(opts)
        end
      end
      """
  end

  def encode(value, _opts) do
    raise Protocol.UndefinedError,
      protocol: @protocol,
      value: value,
      description: "LiveViewReact props must be JSON-compatible values"
  end

  defp fields_to_encode(struct, opts) do
    fields = Map.keys(struct) -- [:__struct__]
    opts = Keyword.validate!(opts, [:only, :except])

    case {Keyword.fetch(opts, :only), Keyword.fetch(opts, :except)} do
      {{:ok, only}, :error} ->
        case only -- fields do
          [] ->
            Enum.uniq(only)

          error_keys ->
            raise ArgumentError,
                  ":only specified keys (#{inspect(error_keys)}) that are not defined in defstruct: " <>
                    inspect(fields)
        end

      {:error, {:ok, except}} ->
        case except -- fields do
          [] ->
            fields -- Enum.uniq(except)

          error_keys ->
            raise ArgumentError,
                  ":except specified keys (#{inspect(error_keys)}) that are not defined in defstruct: " <>
                    inspect(fields)
        end

      {:error, :error} ->
        raise ArgumentError,
              "LiveViewReact.Encoder derivation requires either :only or :except"

      {{:ok, _only}, {:ok, _except}} ->
        raise ArgumentError,
              "LiveViewReact.Encoder derivation accepts :only or :except, not both"
    end
  end
end

defimpl LiveViewReact.Encoder, for: Phoenix.LiveView.AsyncResult do
  def encode(%Phoenix.LiveView.AsyncResult{} = struct, opts) do
    LiveViewReact.Encoder.encode(
      %{
        ok: struct.ok?,
        loading: struct.loading,
        failed: encode_failed(struct.failed),
        result: struct.result
      },
      opts
    )
  end

  defp encode_failed({:error, reason}), do: reason
  defp encode_failed({:exit, reason}), do: reason
  defp encode_failed(other), do: other
end

defimpl LiveViewReact.Encoder, for: Phoenix.LiveView.UploadConfig do
  def encode(%Phoenix.LiveView.UploadConfig{} = struct, opts) do
    LiveViewReact.Uploads.encode_config(struct, opts)
  end
end

defimpl LiveViewReact.Encoder, for: Phoenix.LiveView.UploadEntry do
  def encode(%Phoenix.LiveView.UploadEntry{} = struct, opts) do
    LiveViewReact.Uploads.encode_entry(struct, opts)
  end
end

defimpl LiveViewReact.Encoder, for: Phoenix.HTML.Form do
  def encode(%Phoenix.HTML.Form{} = form, opts) do
    LiveViewReact.Forms.encode(form, opts)
  end
end
