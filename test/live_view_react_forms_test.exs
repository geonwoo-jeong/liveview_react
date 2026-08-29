defmodule LiveViewReact.FormsTest do
  use ExUnit.Case, async: true

  import Phoenix.Component, only: [to_form: 2]

  alias LiveViewReact.{Encoder, Forms}

  defmodule SubmitReply do
    @moduledoc false
    @derive {Encoder, only: [:status, :redirect_to]}
    defstruct [:status, :redirect_to, :private_token]
  end

  test "with_metadata/2 returns a new form and encodes the explicit wire contract" do
    original = to_form(%{"name" => "Ada"}, as: :user, method: "post")
    form = Forms.with_metadata(original, revision: 42)

    assert original.options == [method: "post"]
    assert form != original

    assert Encoder.encode(form, []) == %{
             id: "user",
             name: "user",
             values: %{"name" => "Ada"},
             errors: %{},
             required: %{},
             valid: true,
             revision: 42
           }
  end

  test "reply/3 pushes an encoded submit result before the DOM patch" do
    socket = %Phoenix.LiveView.Socket{private: %{live_temp: %{}}}
    form = to_form(%{}, as: :user) |> Forms.with_metadata(revision: 42)

    reply = %SubmitReply{
      status: :saved,
      redirect_to: "/users/1",
      private_token: "secret"
    }

    pushed = Forms.reply(socket, form, reply)

    assert socket.private.live_temp == %{}

    assert pushed.private.live_temp.push_events == [
             [
               "liveview_react:form_submit",
               %{
                 id: "user",
                 name: "user",
                 reply: %{status: :saved, redirect_to: "/users/1"},
                 revision: 42
               },
               true
             ]
           ]

    nil_reply = Forms.reply(socket, form, nil)
    assert [[_, %{reply: nil}, true]] = nil_reply.private.live_temp.push_events
  end

  test "with_revision_from_params/2 reads only the exact reserved event field" do
    form = to_form(%{}, as: :user)

    revised =
      Forms.with_revision_from_params(form, %{
        "_liveview_react_revision" => "7",
        "__proto__" => %{"polluted" => true},
        "constructor" => "ignored"
      })

    assert Encoder.encode(revised, []).revision == 7

    assert form
           |> Forms.with_revision_from_params(%{"_liveview_react_revision" => "0"})
           |> Encoder.encode([])
           |> Map.fetch!(:revision) == 0

    assert form
           |> Forms.with_revision_from_params(%{
             "_liveview_react_revision" => "9007199254740991"
           })
           |> Encoder.encode([])
           |> Map.fetch!(:revision) == 9_007_199_254_740_991

    assert_raise ArgumentError, ~r/missing _liveview_react_revision/, fn ->
      Forms.with_revision_from_params(form, %{_liveview_react_revision: 7})
    end
  end

  test "rejects arbitrary, duplicate, and prototype-equivalent metadata" do
    form = to_form(%{}, as: :user)

    assert_raise ArgumentError, ~r/unknown form metadata keys/, fn ->
      Forms.with_metadata(form, revision: 1, arbitrary: true)
    end

    assert_raise ArgumentError, ~r/unknown form metadata keys/, fn ->
      Forms.with_metadata(form, submit_reply: %{legacy: true})
    end

    for dangerous_key <- [:__proto__, :constructor, :prototype] do
      assert_raise ArgumentError, ~r/unknown form metadata keys/, fn ->
        Forms.with_metadata(form, [{dangerous_key, %{polluted: true}}])
      end
    end

    assert_raise ArgumentError, ~r/duplicate form metadata keys/, fn ->
      Forms.with_metadata(form, revision: 1, revision: 2)
    end
  end

  test "rejects revisions outside JavaScript's non-negative safe integer range" do
    form = to_form(%{}, as: :user)

    for invalid <- [-1, 1.5, "1", 9_007_199_254_740_992] do
      assert_raise ArgumentError, ~r/form revision must be an integer/, fn ->
        Forms.with_metadata(form, revision: invalid)
      end
    end

    tampered = %{form | options: [liveview_react_revision: -1]}

    assert_raise ArgumentError, ~r/form revision must be an integer/, fn ->
      Encoder.encode(tampered, [])
    end

    for invalid <- [
          "01",
          "+1",
          "-1",
          "1x",
          " 1",
          "9007199254740992",
          String.duplicate("9", 10_000)
        ] do
      assert_raise ArgumentError, ~r/(event form revision|form revision)/, fn ->
        Forms.with_revision_from_params(form, %{"_liveview_react_revision" => invalid})
      end
    end

    duplicate_revision = %{
      form
      | options: [liveview_react_revision: 1, liveview_react_revision: 2]
    }

    assert_raise ArgumentError, ~r/duplicate :liveview_react_revision form option/, fn ->
      Encoder.encode(duplicate_revision, [])
    end
  end

  test "core form normalizer has no compiled Ecto module imports" do
    {:ok, {Forms, [imports: imports]}} =
      Forms
      |> :code.which()
      |> :beam_lib.chunks([:imports])

    ecto_imports =
      imports
      |> Enum.filter(fn {module, _function, _arity} ->
        module |> Atom.to_string() |> String.starts_with?("Elixir.Ecto")
      end)

    assert ecto_imports == []
  end

  test "rejects forms without a stable string identity" do
    form = to_form(%{}, as: :user)
    socket = %Phoenix.LiveView.Socket{private: %{live_temp: %{}}}

    for invalid <- [nil, ""] do
      invalid_id = %{form | id: invalid}
      invalid_name = %{form | name: invalid}

      assert_raise ArgumentError, ~r/id and name must be non-empty strings/, fn ->
        Encoder.encode(invalid_id, [])
      end

      assert_raise ArgumentError, ~r/id and name must be non-empty strings/, fn ->
        Forms.reply(socket, invalid_name, :ok)
      end
    end
  end
end
