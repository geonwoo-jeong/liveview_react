defmodule LiveViewReact.EncoderFormTest do
  use ExUnit.Case

  import Phoenix.Component, only: [to_form: 2]

  alias LiveViewReact.Encoder
  alias Phoenix.HTML.FormData

  defmodule Address do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, except: []}
    embedded_schema do
      field(:street, :string)
      field(:postal_code, :string)
    end

    def changeset(address, attrs) do
      address
      |> cast(attrs, [:street, :postal_code])
      |> validate_required([:street])
    end
  end

  defmodule LineItem do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, except: []}
    embedded_schema do
      field(:label, :string)
      field(:quantity, :integer)
    end

    def changeset(line_item, attrs) do
      line_item
      |> cast(attrs, [:label, :quantity])
      |> validate_required([:label])
      |> validate_number(:quantity, greater_than: 0)
    end
  end

  defmodule Order do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, except: [:private_note]}
    embedded_schema do
      field(:title, :string)
      field(:private_note, :string)
      field(:active, :boolean)
      field(:count, :integer)
      field(:note, :string)
      field(:tags, {:array, :string}, default: [])
      embeds_one(:address, Address, on_replace: :update)
      embeds_many(:line_items, LineItem, on_replace: :delete)
    end

    def changeset(order, attrs) do
      order
      |> cast(attrs, [:title, :private_note, :active, :count, :note, :tags])
      |> validate_required([:title])
      |> cast_embed(:address, with: &Address.changeset/2)
      |> cast_embed(:line_items, with: &LineItem.changeset/2)
    end
  end

  defmodule Author do
    @moduledoc false
    use Ecto.Schema

    @derive {Encoder, only: [:id, :name]}
    schema "authors" do
      field(:name, :string)
    end

    def changeset(author, attrs) do
      author
      |> Ecto.Changeset.cast(attrs, [:name])
      |> Ecto.Changeset.validate_required([:name])
    end
  end

  defmodule Comment do
    @moduledoc false
    use Ecto.Schema

    @derive {Encoder, only: [:id, :body]}
    schema "comments" do
      field(:body, :string)
      field(:publication_id, :integer)
    end

    def changeset(comment, attrs) do
      comment
      |> Ecto.Changeset.cast(attrs, [:body])
      |> Ecto.Changeset.validate_required([:body])
    end
  end

  defmodule Publication do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, only: [:id, :title, :author, :comments]}
    schema "publications" do
      field(:title, :string)
      belongs_to(:author, Author)
      has_many(:comments, Comment)
    end

    def changeset(publication, attrs) do
      publication
      |> cast(attrs, [:title])
      |> validate_required([:title])
      |> cast_assoc(:author, with: &Author.changeset/2)
      |> cast_assoc(:comments, with: &Comment.changeset/2)
    end
  end

  defmodule GuardedAssocChild do
    @moduledoc false
    use Ecto.Schema

    @derive {Encoder, only: [:id, :name]}
    schema "guarded_assoc_children" do
      field(:name, :string)
      field(:guarded_assoc_parent_id, :integer)
    end

    def changeset(_child, _attrs) do
      raise "unchanged association callbacks must not run during form encoding"
    end
  end

  defmodule GuardedAssocParent do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, only: [:id, :name, :child]}
    schema "guarded_assoc_parents" do
      field(:name, :string)

      has_one(:child, GuardedAssocChild, foreign_key: :guarded_assoc_parent_id)
    end

    def changeset(parent, attrs) do
      parent
      |> cast(attrs, [:name])
      |> cast_assoc(:child, with: &GuardedAssocChild.changeset/2)
    end
  end

  defmodule Article do
    @moduledoc false
    use Ecto.Schema

    import Ecto.Changeset

    @derive {Encoder, only: [:id, :title, :author, :related]}
    schema "articles" do
      field(:title, :string)
      belongs_to(:author, Author)
      has_many(:related, __MODULE__, foreign_key: :author_id)
    end

    def changeset(article, attrs), do: cast(article, attrs, [:title])
  end

  defp encode_order(attrs) do
    changeset = Order.changeset(%Order{}, attrs)
    form = FormData.to_form(changeset, as: "order")
    Encoder.encode(form, [])
  end

  describe "Ecto changeset-backed forms" do
    test "encodes nested one/many values without losing JSON falsy values or arrays" do
      encoded =
        encode_order(%{
          "title" => "New order",
          "private_note" => "server only",
          "active" => false,
          "count" => 0,
          "note" => nil,
          "tags" => [],
          "address" => %{"street" => "Main", "postal_code" => ""},
          "line_items" => [
            %{"label" => "First", "quantity" => 1},
            %{"label" => "Second", "quantity" => 2}
          ]
        })

      assert encoded.id == "order"
      assert encoded.name == "order"
      assert encoded.revision == 0
      assert encoded.valid
      assert encoded.errors == %{}

      assert encoded.required == %{
               title: true,
               address: %{street: true},
               line_items: [%{label: true}, %{label: true}]
             }

      assert encoded.values == %{
               id: nil,
               title: "New order",
               active: false,
               count: 0,
               note: nil,
               tags: [],
               address: %{id: nil, street: "Main", postal_code: ""},
               line_items: [
                 %{id: nil, label: "First", quantity: 1},
                 %{id: nil, label: "Second", quantity: 2}
               ]
             }

      refute Map.has_key?(encoded.values, :private_note)
      refute Map.has_key?(encoded, :submit_reply)
    end

    test "encodes aligned nested errors and required fields" do
      encoded =
        encode_order(%{
          "title" => "",
          "active" => false,
          "count" => 0,
          "note" => nil,
          "tags" => [],
          "address" => %{"street" => "", "postal_code" => nil},
          "line_items" => [
            %{"label" => "Present", "quantity" => 0},
            %{"label" => "", "quantity" => 2}
          ]
        })

      refute encoded.valid

      assert encoded.errors == %{
               title: ["can't be blank"],
               address: %{street: ["can't be blank"]},
               line_items: [
                 %{quantity: ["must be greater than 0"]},
                 %{label: ["can't be blank"]}
               ]
             }

      assert encoded.required == %{
               title: true,
               address: %{street: true},
               line_items: [%{label: true}, %{label: true}]
             }
    end

    test "retains nested required trees for unchanged loaded embeds" do
      order = %Order{
        title: "Existing",
        address: %Address{street: "Main"},
        line_items: [%LineItem{label: "Saved", quantity: 1}]
      }

      encoded =
        order |> Order.changeset(%{}) |> FormData.to_form(as: "order") |> Encoder.encode([])

      assert encoded.values.address.street == "Main"
      assert encoded.values.line_items == [%{id: nil, label: "Saved", quantity: 1}]

      assert encoded.required == %{
               title: true,
               address: %{street: true},
               line_items: [%{label: true}]
             }
    end

    test "retains aligned errors for unchanged invalid embeds" do
      order = %Order{
        title: "Existing",
        address: %Address{street: ""},
        line_items: [%LineItem{label: "", quantity: 0}]
      }

      encoded =
        order |> Order.changeset(%{}) |> FormData.to_form(as: "order") |> Encoder.encode([])

      refute encoded.valid

      assert encoded.errors == %{
               address: %{street: ["can't be blank"]},
               line_items: [
                 %{label: ["can't be blank"]}
               ]
             }
    end

    test "omits replaced embedded rows from every aligned tree" do
      order = %Order{
        title: "Existing",
        line_items: [%LineItem{id: Ecto.UUID.generate(), label: "Removed", quantity: 1}]
      }

      encoded =
        order
        |> Order.changeset(%{"line_items" => []})
        |> FormData.to_form(as: "order")
        |> Encoder.encode([])

      assert encoded.values.line_items == []
      refute Map.has_key?(encoded.errors, :line_items)
      refute Map.has_key?(encoded.required, :line_items)
    end

    test "nilifies unloaded one and many associations only when requested" do
      article = %Article{}
      source_before = article
      form = article |> Article.changeset(%{}) |> FormData.to_form(as: "article")
      changeset_before = form.source

      encoded = Encoder.encode(form, nilify_not_loaded: true)

      assert encoded.values.author == nil
      assert encoded.values.related == nil
      assert article == source_before
      assert form.source == changeset_before

      assert_raise Protocol.UndefinedError, fn -> Encoder.encode(form, []) end
    end

    test "encodes association one/many values, errors, and required trees" do
      publication = %Publication{author: nil, comments: []}

      form =
        publication
        |> Publication.changeset(%{
          "title" => "",
          "author" => %{"name" => ""},
          "comments" => [%{"body" => "First"}, %{"body" => ""}]
        })
        |> FormData.to_form(as: "publication")

      encoded = Encoder.encode(form, [])

      assert encoded.values == %{
               id: nil,
               title: "",
               author: %{id: nil, name: ""},
               comments: [%{id: nil, body: "First"}, %{id: nil, body: ""}]
             }

      assert encoded.errors == %{
               title: ["can't be blank"],
               author: %{name: ["can't be blank"]},
               comments: [nil, %{body: ["can't be blank"]}]
             }

      assert encoded.required == %{
               title: true,
               author: %{name: true},
               comments: [%{body: true}, %{body: true}]
             }
    end

    test "keeps unchanged loaded associations as encoded leaf values" do
      publication = %Publication{
        title: "Existing",
        author: %Author{name: "Ada"},
        comments: [%Comment{body: "Saved"}]
      }

      encoded =
        publication
        |> Publication.changeset(%{})
        |> FormData.to_form(as: "publication")
        |> Encoder.encode([])

      assert encoded.values.author.name == "Ada"
      assert encoded.values.comments == [%{id: nil, body: "Saved"}]

      assert encoded.required == %{title: true}
      assert encoded.errors == %{}
      assert encoded.valid
    end

    test "does not synthesize errors for unchanged associations" do
      publication = %Publication{
        title: "Existing",
        author: %Author{name: ""},
        comments: [%Comment{body: ""}]
      }

      encoded =
        publication
        |> Publication.changeset(%{})
        |> FormData.to_form(as: "publication")
        |> Encoder.encode([])

      assert encoded.values.author.name == ""
      assert encoded.values.comments == [%{id: nil, body: ""}]
      assert encoded.required == %{title: true}
      assert encoded.errors == %{}
      assert encoded.valid
    end

    test "does not invoke configured callbacks for unchanged loaded associations" do
      parent = %GuardedAssocParent{
        name: "Bounded",
        child: %GuardedAssocChild{name: "Leaf"}
      }

      encoded =
        parent
        |> GuardedAssocParent.changeset(%{})
        |> FormData.to_form(as: "guarded")
        |> Encoder.encode([])

      assert encoded.values.child == %{id: nil, name: "Leaf"}
      assert encoded.errors == %{}
      assert encoded.required == %{}
      assert encoded.valid
    end
  end

  describe "plain map-backed forms" do
    test "merges hidden, data, and params while preserving empty and falsy values" do
      form =
        %{
          "active" => true,
          "count" => 10,
          "note" => "old",
          "tags" => ["old"]
        }
        |> to_form(as: :profile)
        |> then(&%{&1 | hidden: [token: "csrf"]})
        |> then(
          &%{
            &1
            | params: %{
                "active" => false,
                "count" => 0,
                "note" => nil,
                "tags" => [],
                "empty" => ""
              }
          }
        )

      encoded = Encoder.encode(form, [])

      assert encoded == %{
               id: "profile",
               name: "profile",
               values: %{
                 :token => "csrf",
                 "active" => false,
                 "count" => 0,
                 "note" => nil,
                 "tags" => [],
                 "empty" => ""
               },
               errors: %{},
               required: %{},
               valid: true,
               revision: 0
             }
    end

    test "translates all errors for the same field" do
      form =
        %{"name" => "x"}
        |> to_form(as: :profile)
        |> then(
          &%{
            &1
            | errors: [
                name: {"must have at least %{count} characters", count: 3},
                name: {"must not contain %{characters}", characters: ["<", ">"]}
              ]
          }
        )

      assert Encoder.encode(form, []).errors == %{
               name: ["must have at least 3 characters", "must not contain <, >"]
             }
    end
  end
end
