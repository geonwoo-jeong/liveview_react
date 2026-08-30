defmodule LiveViewReactExamplesWeb.LiveAllFeaturesTest do
  use LiveViewReactExamplesWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias LiveViewReact.Test

  setup %{conn: conn} do
    {:ok, view, _html} = live(conn, ~p"/sample")
    %{view: view}
  end

  test "exposes the current root, event, stream, slot, form, upload, and registry contracts", %{
    view: view
  } do
    react = Test.get_react(view, id: "all-features-demo")

    assert react.component == "AllFeatures"
    assert react.transport_version == 2
    assert react.props_kind == "snapshot"
    assert react.streams_kind == "snapshot"
    assert react.props["count"] == 2
    refute Map.has_key?(react.props, "sampleForm")
    refute Map.has_key?(react.props, "sampleUpload")
    assert Map.has_key?(react.events, "onServerIncrement")
    assert Map.has_key?(react.slots, "default")
    assert Map.has_key?(react.slots, "sidebar")

    initial_frame = stream_frame(react)
    assert Enum.map(initial_frame["items"], & &1["id"]) == ~w(intro events streams)

    forms_uploads = Test.get_react(view, id: "sample-forms-uploads-demo")
    assert forms_uploads.component == "SampleFormsUploads"
    assert forms_uploads.props["sampleForm"]["revision"] == 0
    assert forms_uploads.props["sampleUpload"]["name"] == "sample_files"

    discovered = Test.get_react(view, id: "vite-discovered-demo")
    assert discovered.component == "RegistryBadge"
    assert discovered.props["message"] == "Loaded through virtual:liveview-react/components"
  end

  test "handles bounded programmatic events and replies", %{view: view} do
    render_hook(view, "increment_count", %{"by" => 2})
    assert has_element?(view, ~s([data-testid="server-count"]), "4")

    render_hook(view, "increment_count", %{"by" => 1_000})
    assert has_element?(view, ~s([data-testid="server-count"]), "4")

    render_hook(view, "search_reply", %{"query" => "  bridge  "})
    assert has_element?(view, ~s([data-testid="server-search-reply"]), "BRIDGE")

    render_hook(view, "emit_notice", %{"message" => "sample notice"})
    assert has_element?(view, ~s([data-testid="server-notices"]), "sample notice")
  end

  test "emits canonical stream insert, update-only, reset, and delete frames", %{view: view} do
    inserted =
      view
      |> render_hook("add_stream_item", %{"label" => "Appended"})
      |> Test.get_react(id: "all-features-demo")
      |> stream_frame()

    assert [%{"label" => "Appended", "__dom_id" => inserted_dom_id}] = inserted["items"]
    assert [[^inserted_dom_id, -1, nil, false]] = inserted["inserts"]

    updated =
      view
      |> render_hook("rename_stream_item", %{"id" => "intro", "label" => "Updated"})
      |> Test.get_react(id: "all-features-demo")
      |> stream_frame()

    assert updated["items"] == [
             %{"__dom_id" => "items-intro", "id" => "intro", "label" => "Updated"}
           ]

    assert updated["inserts"] == [["items-intro", -1, nil, true]]

    reset =
      view
      |> render_hook("rotate_stream", %{})
      |> Test.get_react(id: "all-features-demo")
      |> stream_frame()

    assert reset["reset"]
    assert Enum.map(reset["items"], & &1["id"]) == ~w(forms uploads navigation)

    deleted =
      view
      |> render_hook("delete_stream_item", %{"id" => "forms"})
      |> Test.get_react(id: "all-features-demo")
      |> stream_frame()

    assert deleted["deletes"] == ["items-forms"]
  end

  test "rejects invalid forms without consuming uploads and survives stale payloads", %{
    view: view
  } do
    invalid = form_payload("x", "short", "1")

    render_hook(view, "validate_form", invalid)
    assert has_element?(view, ~s([data-testid="server-validation-applied"]), "1:x")

    render_hook(view, "submit_form", invalid)
    assert has_element?(view, ~s([data-testid="server-last-submit"]), "rejected")
    assert has_element?(view, ~s([data-testid="server-uploaded-files"]), "Uploaded files:")

    render_hook(view, "cancel_upload", %{"name" => "sample_files", "ref" => "stale"})
    render_hook(view, "validate_form", %{})
    assert has_element?(view, "#all-features-demo")

    render_hook(view, "submit_form", form_payload("Valid title", "ready", "2"))
    assert has_element?(view, ~s([data-testid="server-last-submit"]), "Valid title")
  end

  defp form_payload(title, notes, revision) do
    %{
      "_liveview_react_revision" => revision,
      "sample" => %{"notes" => notes, "title" => title}
    }
  end

  defp stream_frame(react) do
    Enum.find_value(react.streams_diff, fn
      ["stream", "/items", frame] -> frame
      _operation -> nil
    end) || flunk("expected an /items stream frame")
  end
end
