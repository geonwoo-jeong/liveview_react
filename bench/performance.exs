defmodule LiveViewReactBench.Renderer do
  @moduledoc false
  @behaviour LiveViewReact.SSR

  @impl true
  def render(%{component: component, props: props}) do
    encoded_size = props |> Jason.encode!() |> byte_size()
    ~s(<output data-component="#{component}" data-props-bytes="#{encoded_size}"></output>)
  end
end

defmodule LiveViewReactBench do
  @moduledoc false

  alias LiveViewReact.Patch
  alias LiveViewReact.StreamAdapter
  alias Phoenix.LiveView.LiveStream
  alias Phoenix.LiveView.Socket

  @list_count 1_000
  @form_section_count 50
  @form_fields_per_section 20
  @stream_count 10_000

  def run do
    IO.puts("LiveViewReact server performance report")
    IO.puts("Report only: timings vary by host and do not enforce thresholds.\n")

    {old_list, new_list} = list_fixture()
    report_list_transport(old_list, new_list)
    {old_form, new_form} = nested_form_fixture()
    report_form_transport(old_form, new_form)
    report_stream_transport()
    report_injected_ssr(new_form)
  end

  defp report_list_transport(old_list, new_list) do
    report_snapshot_patch(
      "1,000-item list with one nested field change",
      old_list,
      new_list
    )
  end

  defp report_form_transport(old_form, new_form) do
    report_snapshot_patch("1,000-field nested form with one field change", old_form, new_form)
  end

  defp report_snapshot_patch(label, previous_tree, current_tree) do
    full_assigns = root_assigns(current_tree, previous_tree, false)
    patch_assigns = root_assigns(current_tree, previous_tree, true)
    full_html = render_root(full_assigns)
    patch_html = render_root(patch_assigns)
    full_bytes = attribute_bytes!(full_html, "data-props")
    patch_bytes = attribute_bytes!(patch_html, "data-props-diff")

    ensure!(full_bytes > 0, "the full snapshot must not be empty")
    ensure!(patch_bytes > 0, "the compact patch must not be empty")
    ensure!(patch_bytes < full_bytes, "the one-field patch must be smaller than the snapshot")

    IO.puts(label)
    IO.puts("  full snapshot attribute bytes: #{full_bytes}")
    IO.puts("  one-field compact patch attribute bytes: #{patch_bytes}")
    IO.puts("  patch/full byte ratio: #{format_ratio(patch_bytes, full_bytes)}")
    measure("full snapshot render", 40, fn -> render_root(full_assigns) end)
    measure("compact patch render", 40, fn -> render_root(patch_assigns) end)
    IO.puts("")
  end

  defp report_stream_transport do
    items = stream_items()

    insert_stream = LiveStream.new(:rows, make_ref(), items, [])

    update_stream =
      Enum.reduce(items, LiveStream.new(:rows, make_ref(), [], []), fn item, stream ->
        updated_item = %{
          item
          | label: "updated-#{item.id}",
            metadata: %{item.metadata | rank: -item.id}
        }

        LiveStream.insert_item(stream, updated_item, -1, nil, true)
      end)

    delete_stream =
      Enum.reduce(1..@stream_count, LiveStream.new(:rows, make_ref(), [], []), fn index, stream ->
        LiveStream.delete_item_by_dom_id(stream, "rows-#{index}")
      end)

    IO.puts("10,000-item stream operation paths")
    report_stream_operation("insert", insert_stream, "upsert")
    report_stream_operation("update_only", update_stream, "replace")
    report_stream_operation("delete", delete_stream, "remove")
    IO.puts("")
  end

  defp report_stream_operation(label, stream, expected_operation) do
    patches = StreamAdapter.patches(%{rows: stream}, false)
    payload = Patch.serialize(patches)

    ensure!(
      length(patches) == @stream_count,
      "#{label} stream fixture must produce #{@stream_count} operations"
    )

    ensure!(
      Enum.all?(patches, &(&1.op == expected_operation)),
      "#{label} stream fixture produced an unexpected operation"
    )

    IO.puts("  #{label}")
    IO.puts("    operations: #{length(patches)} #{expected_operation}")
    IO.puts("    compact payload bytes: #{byte_size(payload)}")

    measure("#{label} adapter + serialization", 4, fn ->
      %{rows: stream}
      |> StreamAdapter.patches(false)
      |> Patch.serialize()
    end)

    measure("#{label} serialization only", 8, fn -> Patch.serialize(patches) end)
  end

  defp report_injected_ssr(form) do
    previous_renderer = Application.fetch_env(:liveview_react, :ssr_module)
    Application.put_env(:liveview_react, :ssr_module, LiveViewReactBench.Renderer)

    try do
      assigns =
        form
        |> root_assigns(nil, true)
        |> Map.put(:socket, %Socket{})
        |> Map.put(:__changed__, nil)

      html = render_root(assigns)

      ensure!(byte_size(html) > 0, "injected SSR must produce rendered HTML")
      IO.puts("Injected SSR integration")
      IO.puts("  rendered HTML bytes: #{byte_size(html)}")
      measure("dead render + injected SSR", 20, fn -> render_root(assigns) end)
      IO.puts("  renderer: deterministic in-process contract probe (not a JS engine)")
    after
      restore_env(:ssr_module, previous_renderer)
    end
  end

  defp nested_form_fixture do
    old_form = %{
      "form" => %{
        "sections" =>
          Map.new(1..@form_section_count, fn section_index ->
            section_id = "section-#{section_index}"

            fields =
              Map.new(1..@form_fields_per_section, fn field_index ->
                field_id = "field-#{field_index}"

                {field_id,
                 %{
                   "id" => "#{section_id}-#{field_id}",
                   "value" => "value-#{section_index}-#{field_index}",
                   "errors" => [],
                   "touched" => rem(field_index, 3) == 0
                 }}
              end)

            {section_id, %{"id" => section_id, "fields" => fields}}
          end),
        "submit_count" => 0
      }
    }

    new_form =
      put_in(
        old_form,
        ["form", "sections", "section-25", "fields", "field-10", "value"],
        "changed-by-server"
      )

    {old_form, new_form}
  end

  defp list_fixture do
    old_list = %{
      "items" =>
        Enum.map(1..@list_count, fn index ->
          %{
            "id" => index,
            "content" => %{
              "label" => "row-#{index}",
              "description" => "stable-description-#{index}"
            },
            "metadata" => %{"rank" => index, "visible" => true}
          }
        end)
    }

    new_list =
      put_in(
        old_list,
        ["items", Access.at(499), "content", "label"],
        "changed-by-server"
      )

    {old_list, new_list}
  end

  defp stream_items do
    Enum.map(1..@stream_count, fn index ->
      %{id: index, label: "row-#{index}", metadata: %{rank: index, stable: true}}
    end)
  end

  defp root_assigns(tree, previous_tree, diff?) do
    %{
      id: "performance-root",
      component: "PerformanceProbe",
      socket: %Socket{transport_pid: self()},
      tree: tree,
      diff: diff?,
      ssr: true,
      __changed__: if(is_nil(previous_tree), do: nil, else: %{tree: previous_tree})
    }
  end

  defp render_root(assigns) do
    assigns
    |> LiveViewReact.react()
    |> Phoenix.HTML.html_escape()
    |> Phoenix.HTML.safe_to_string()
  end

  defp attribute_bytes!(html, attribute) do
    pattern = ~r/#{Regex.escape(attribute)}="([^"]*)"/

    case Regex.run(pattern, html, capture: :all_but_first) do
      [value] -> byte_size(value)
      _missing -> raise "rendered root is missing #{attribute}"
    end
  end

  defp measure(label, iterations, operation) do
    Enum.each(1..2, fn _iteration -> operation.() end)

    {microseconds, _result} =
      :timer.tc(fn -> Enum.each(1..iterations, fn _ -> operation.() end) end)

    milliseconds = microseconds / iterations / 1_000
    IO.puts("    #{label}: #{:erlang.float_to_binary(milliseconds, decimals: 3)} ms/op")
  end

  defp format_ratio(part, whole) do
    percentage = part / whole * 100
    :erlang.float_to_binary(percentage, decimals: 2) <> "%"
  end

  defp ensure!(true, _message), do: :ok
  defp ensure!(false, message), do: raise(message)

  defp restore_env(key, {:ok, value}), do: Application.put_env(:liveview_react, key, value)
  defp restore_env(key, :error), do: Application.delete_env(:liveview_react, key)
end

LiveViewReactBench.run()
