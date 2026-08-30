defmodule LiveViewReactExamplesTest do
  use ExUnit.Case, async: true

  test "demo sections keep overview first and include the comprehensive sample" do
    sections = LiveViewReactExamples.demo_sections()

    assert [%{section: "Overview", demos: [%{id: :all_features, path: "/sample"} | _]} | _] =
             sections

    assert Enum.at(sections, 1).section == "Basics"
    assert Enum.at(sections, 2).section == "LiveViews"
  end

  test "sample metadata covers the current bridge surface" do
    section_ids = Enum.map(LiveViewReactExamples.sample_sections(), & &1.id)

    assert section_ids == [
             "root",
             "ssr",
             "events",
             "streams",
             "forms",
             "navigation",
             "lifecycle"
           ]

    assert LiveViewReactExamples.demo_id_for_view(LiveViewReactExamplesWeb.LiveSampleDestination) ==
             :all_features
  end
end
