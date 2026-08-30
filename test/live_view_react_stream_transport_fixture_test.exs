defmodule LiveViewReact.StreamTransportFixtureTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.StreamAdapter
  alias Phoenix.LiveView.LiveStream

  @fixture_path Path.join([__DIR__, "fixtures", "stream_transport_v2.json"])

  test "one fixture locks dead-render materialization and connected replay patches" do
    fixture = @fixture_path |> File.read!() |> Jason.decode!()
    scenario = fixture["scenario"]

    assert fixture["transportVersion"] == 2
    assert scenario["streamName"] == "users"

    stream = build_stream(scenario)
    streams = %{"users" => stream}

    assert StreamAdapter.dead_render_snapshot(streams) ==
             scenario["expectedDeadRenderSnapshot"]

    assert json_data(StreamAdapter.connected_snapshot_patches(streams)) ==
             scenario["expectedConnectedSnapshotPatches"]
  end

  defp build_stream(scenario) do
    stream =
      LiveStream.new(
        :users,
        make_ref(),
        scenario["initialItems"],
        dom_id: fn item -> scenario["domIdPrefix"] <> to_string(item["id"]) end,
        limit: scenario["initialLimit"]
      )

    Enum.reduce(scenario["operations"], stream, &apply_operation/2)
  end

  defp apply_operation(%{"kind" => "insert"} = operation, stream) do
    LiveStream.insert_item(
      stream,
      operation["item"],
      operation["at"],
      operation["limit"],
      operation["updateOnly"]
    )
  end

  defp apply_operation(%{"kind" => "delete", "domId" => dom_id}, stream) do
    LiveStream.delete_item_by_dom_id(stream, dom_id)
  end

  defp apply_operation(%{"kind" => "reset"}, stream), do: LiveStream.reset(stream)

  defp json_data(value), do: value |> Jason.encode!() |> Jason.decode!()
end
