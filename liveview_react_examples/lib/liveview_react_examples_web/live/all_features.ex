defmodule LiveViewReactExamplesWeb.LiveAllFeatures do
  use LiveViewReactExamplesWeb, :live_view

  alias LiveViewReact.Forms
  alias Phoenix.LiveView.JS

  @form_id "all-features-form"
  @maximum_safe_integer 9_007_199_254_740_991
  @max_count_delta 100
  @max_form_input_bytes 1_024
  @max_navigation_step_length 64
  @max_notice_length 120
  @max_notes_length 240
  @max_stream_label_length 120
  @max_title_length 80
  @stream_id_pattern ~r/\A[A-Za-z0-9_-]{1,64}\z/

  def render(assigns) do
    ~H"""
    <main id="sample-shell" class="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-8">
      <section class="space-y-3">
        <p class="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500">
          LiveViewReact sample
        </p>
        <h1 class="text-4xl font-semibold tracking-tight text-zinc-950">
          One screen covering the current bridge surface
        </h1>
        <p class="max-w-3xl text-base leading-7 text-zinc-600">
          This page exercises the APIs that changed most from the old `live_react`
          shape: explicit roots, SSR hydration, declarative event callbacks, programmatic
          replies, streams, slots, forms, uploads, navigation, and connection state.
        </p>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article
          :for={section <- @sections}
          class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <p class="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-400">
            {section.id}
          </p>
          <h2 class="mt-2 text-lg font-semibold text-zinc-900">{section.title}</h2>
          <p class="mt-2 text-sm leading-6 text-zinc-600">{section.summary}</p>
        </article>
      </section>

      <section class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_22rem]">
        <div class="space-y-6">
          <section class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-semibold text-zinc-900">Native upload bridge</h2>
            <p class="mt-2 text-sm leading-6 text-zinc-600">
              `useLiveUpload` still talks to Phoenix uploads under the hood. The native input remains
              in the LiveView DOM, while a client-only React root drives the workflow after the
              connected LiveView creates its upload ref.
            </p>
            <.live_file_input
              upload={@uploads.sample_files}
              form={@form.id}
              class="mt-4 block w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm"
            />
            <div class="mt-4">
              <.react
                id="sample-forms-uploads-demo"
                component="SampleFormsUploads"
                sampleForm={@form}
                sampleUpload={@uploads.sample_files}
                socket={@socket}
                ssr={false}
              />
            </div>
          </section>

          <.react
            id="all-features-demo"
            component="AllFeatures"
            count={@count}
            currentPath={@current_path}
            currentStep={@current_step}
            livePid={@live_pid}
            notices={@notices}
            portalTargetId="sample-portal-outlet"
            searchReply={@search_reply}
            socket={@socket}
            items={@streams.items}
            r-on:server-increment={
              JS.push("increment_count", value: %{by: 3, source: "r-on"})
              |> JS.add_class("ring-2 ring-orange-300", to: "#sample-shell")
            }
          >
            <p class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700">
              Default slot content is rendered by HEEx and passed into React as inert nodes.
            </p>
            <:slot name="sidebar">
              <div class="rounded-xl bg-zinc-900 p-4 text-sm text-white">
                Named slot sees the authoritative LiveView count: {@count}
              </div>
            </:slot>
          </.react>

          <section class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-semibold text-zinc-900">Server state snapshot</h2>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <p data-testid="server-count"><span class="font-semibold">Count:</span> {@count}</p>
              <p data-testid="server-current-path">
                <span class="font-semibold">Current path:</span> {@current_path}
              </p>
              <p data-testid="server-current-step">
                <span class="font-semibold">Current step:</span> {@current_step}
              </p>
              <p data-testid="server-live-pid">
                <span class="font-semibold">LiveView pid:</span> {@live_pid}
              </p>
              <p data-testid="server-search-reply">
                <span class="font-semibold">Last search reply:</span> {@search_reply}
              </p>
              <p data-testid="server-validation-applied">
                <span class="font-semibold">Validation applied:</span> {@validation_applied}
              </p>
              <p data-testid="server-last-submit">
                <span class="font-semibold">Last submit:</span> {@last_submit}
              </p>
              <p data-testid="server-uploaded-files">
                <span class="font-semibold">Uploaded files:</span> {Enum.join(@uploaded_files, ", ")}
              </p>
              <p data-testid="server-notices">
                <span class="font-semibold">Server notices:</span> {Enum.join(@notices, " | ")}
              </p>
            </div>
          </section>
        </div>

        <aside class="space-y-4">
          <section class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-semibold text-zinc-900">Route probes</h2>
            <p class="mt-2 text-sm leading-6 text-zinc-600">
              Patch keeps the same LiveView process, navigate mounts a new one, and href performs a
              full document request.
            </p>
            <div class="mt-4 flex flex-col gap-2 text-sm">
              <.link patch={~p"/sample?step=server-patch"} class="text-orange-700 underline">
                Phoenix patch
              </.link>
              <.link navigate={~p"/sample/destination?via=server"} class="text-orange-700 underline">
                Phoenix navigate
              </.link>
              <.link href={~p"/sample?step=server-href"} class="text-orange-700 underline">
                Phoenix href reload
              </.link>
            </div>
          </section>

          <section
            id="sample-portal-outlet"
            class="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 shadow-sm"
          >
            <h2 class="text-lg font-semibold text-zinc-900">Portal target</h2>
            <p class="mt-2 text-sm leading-6 text-zinc-600">
              React can portal bounded UI here without taking over the rest of the LiveView page.
            </p>
          </section>

          <section class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-semibold text-zinc-900">Vite virtual registry</h2>
            <p class="mt-2 text-sm leading-6 text-zinc-600">
              This second root is discovered from a default-exported TSX file instead of the
              hand-written tagged registry used by the other demos.
            </p>
            <div class="mt-4">
              <.react
                id="vite-discovered-demo"
                component="RegistryBadge"
                message="Loaded through virtual:liveview-react/components"
                socket={@socket}
              />
            </div>
          </section>
        </aside>
      </section>
    </main>
    """
  end

  def mount(_params, _session, socket) do
    mount_generation =
      if connected?(socket) do
        connect_params = Phoenix.LiveView.get_connect_params(socket) || %{}
        Map.get(connect_params, "_mounts", 0)
      else
        0
      end

    socket =
      socket
      |> assign(
        count: 2,
        current_path: "/sample",
        current_step: "initial",
        form: build_form(LiveViewReactExamples.sample_form_values()),
        last_submit: "none",
        live_pid: inspect(self()),
        notices: ["mounted:#{mount_generation}"],
        search_reply: "none",
        sections: LiveViewReactExamples.sample_sections(),
        uploaded_files: [],
        validation_applied: "none"
      )
      |> allow_upload(:sample_files,
        accept: ~w(.txt .md),
        auto_upload: false,
        max_entries: 2,
        max_file_size: 1_024
      )
      |> stream(:items, LiveViewReactExamples.initial_items())

    {:ok, socket}
  end

  def handle_params(params, uri, socket) do
    path = URI.parse(uri).path || "/sample"

    current_step =
      case bounded_text(Map.get(params, "step", "initial"), @max_navigation_step_length) do
        {:ok, ""} -> "initial"
        {:ok, step} -> step
        :error -> "invalid"
      end

    {:noreply,
     assign(socket,
       current_path: path,
       current_step: current_step
     )}
  end

  def handle_event("increment_count", %{"by" => by}, socket) do
    case count_delta(by) do
      {:ok, delta} -> {:noreply, update(socket, :count, &(&1 + delta))}
      :error -> {:noreply, socket}
    end
  end

  def handle_event("increment_count", _params, socket), do: {:noreply, socket}

  def handle_event("emit_notice", %{"message" => message}, socket) when is_binary(message) do
    case bounded_text(message, @max_notice_length) do
      {:ok, ""} ->
        {:noreply, socket}

      {:ok, notice} ->
        notices = (socket.assigns.notices ++ [notice]) |> Enum.take(-5)

        {:noreply,
         socket
         |> assign(:notices, notices)
         |> push_event("sample_notice", %{message: notice})}

      :error ->
        {:noreply, socket}
    end
  end

  def handle_event("emit_notice", _params, socket), do: {:noreply, socket}

  def handle_event("search_reply", %{"query" => query}, socket) when is_binary(query) do
    reply =
      case bounded_text(query, @max_title_length) do
        {:ok, value} -> String.upcase(value)
        :error -> "INVALID QUERY"
      end

    {:reply, %{result: reply}, assign(socket, :search_reply, reply)}
  end

  def handle_event("search_reply", _params, socket) do
    {:reply, %{result: "INVALID QUERY"}, assign(socket, :search_reply, "INVALID QUERY")}
  end

  def handle_event("add_stream_item", %{"label" => label}, socket) when is_binary(label) do
    id = System.unique_integer([:positive]) |> Integer.to_string()

    case bounded_text(label, @max_stream_label_length) do
      {:ok, ""} ->
        {:noreply, stream_insert(socket, :items, %{id: id, label: "Generated #{id}"})}

      {:ok, text} ->
        {:noreply, stream_insert(socket, :items, %{id: id, label: text})}

      :error ->
        {:noreply, socket}
    end
  end

  def handle_event("add_stream_item", _params, socket), do: {:noreply, socket}

  def handle_event("rotate_stream", _params, socket) do
    {:noreply, stream(socket, :items, LiveViewReactExamples.replacement_items(), reset: true)}
  end

  def handle_event("rename_stream_item", %{"id" => id, "label" => label}, socket)
      when is_binary(id) and is_binary(label) do
    with true <- valid_stream_id?(id),
         {:ok, text} <- bounded_text(label, @max_stream_label_length) do
      label = if text == "", do: "Updated #{id}", else: text
      {:noreply, stream_insert(socket, :items, %{id: id, label: label}, update_only: true)}
    else
      _invalid -> {:noreply, socket}
    end
  end

  def handle_event("rename_stream_item", _params, socket), do: {:noreply, socket}

  def handle_event("delete_stream_item", %{"id" => id}, socket) when is_binary(id) do
    if valid_stream_id?(id) do
      {:noreply, stream_delete(socket, :items, %{id: id})}
    else
      {:noreply, socket}
    end
  end

  def handle_event("delete_stream_item", _params, socket), do: {:noreply, socket}

  def handle_event("validate_form", params, socket) do
    case form_submission(params) do
      {:ok, submission} ->
        {:reply, %{accepted_revision: submission.revision},
         assign(socket,
           form: submission.form,
           validation_applied: "#{submission.revision}:#{submission.values["title"]}"
         )}

      :error ->
        {:reply, %{error: "invalid_form_payload"}, socket}
    end
  end

  def handle_event("submit_form", params, socket) do
    case form_submission(params) do
      {:ok, %{errors: []} = submission} ->
        save_submission(socket, submission)

      {:ok, submission} ->
        reply = %{
          errors: validation_messages(submission.errors),
          status: "invalid"
        }

        socket =
          socket
          |> assign(form: submission.form, last_submit: "rejected")
          |> Forms.reply(submission.form, reply)

        {:noreply, socket}

      :error ->
        {:noreply, assign(socket, :last_submit, "invalid payload")}
    end
  end

  def handle_event(
        "cancel_upload",
        %{"name" => "sample_files", "ref" => ref},
        socket
      )
      when is_binary(ref) do
    if Enum.any?(socket.assigns.uploads.sample_files.entries, &(&1.ref == ref)) do
      {:reply, %{cancelled: ref}, cancel_upload(socket, :sample_files, ref)}
    else
      {:reply, %{error: "unknown_upload"}, socket}
    end
  end

  def handle_event("cancel_upload", _params, socket) do
    {:reply, %{error: "invalid_cancel_payload"}, socket}
  end

  defp save_submission(socket, submission) do
    consumed_files =
      consume_uploaded_entries(socket, :sample_files, fn _meta, entry ->
        {:ok, entry.client_name}
      end)

    title = String.trim(submission.values["title"])

    reply = %{
      status: "saved",
      title: title,
      uploaded_files: consumed_files
    }

    socket =
      socket
      |> assign(
        form: submission.form,
        last_submit: title,
        uploaded_files: consumed_files
      )
      |> Forms.reply(submission.form, reply)

    {:noreply, socket}
  end

  defp form_submission(%{"sample" => values, "_liveview_react_revision" => raw_revision} = params)
       when is_map(values) do
    with {:ok, values} <- normalize_form_values(values),
         {:ok, revision} <- form_revision(raw_revision) do
      errors = validation_errors(values)

      form =
        values
        |> build_form(errors)
        |> Forms.with_revision_from_params(params)

      {:ok, %{errors: errors, form: form, revision: revision, values: values}}
    end
  end

  defp form_submission(_params), do: :error

  defp build_form(values, errors \\ []) do
    Phoenix.Component.to_form(values,
      as: "sample",
      errors: errors,
      id: @form_id
    )
  end

  defp normalize_form_values(values) do
    with {:ok, title} <- form_text(Map.get(values, "title", "")),
         {:ok, notes} <- form_text(Map.get(values, "notes", "")) do
      {:ok, %{"notes" => notes, "title" => title}}
    end
  end

  defp form_text(value)
       when is_binary(value) and byte_size(value) <= @max_form_input_bytes do
    if String.valid?(value), do: {:ok, value}, else: :error
  end

  defp form_text(_value), do: :error

  defp form_revision(revision)
       when is_integer(revision) and revision >= 0 and revision <= @maximum_safe_integer,
       do: {:ok, revision}

  defp form_revision(revision) when is_binary(revision) and byte_size(revision) <= 16 do
    if Regex.match?(~r/\A(?:0|[1-9][0-9]*)\z/, revision) do
      form_revision(String.to_integer(revision))
    else
      :error
    end
  end

  defp form_revision(_revision), do: :error

  defp count_delta(delta)
       when is_integer(delta) and delta >= -@max_count_delta and delta <= @max_count_delta,
       do: {:ok, delta}

  defp count_delta(delta) when is_binary(delta) and byte_size(delta) <= 4 do
    case Integer.parse(delta) do
      {value, ""} -> count_delta(value)
      _invalid -> :error
    end
  end

  defp count_delta(_delta), do: :error

  defp bounded_text(value, max_length) when is_binary(value) do
    if String.valid?(value) and byte_size(value) <= max_length * 4 do
      value = String.trim(value)

      if String.length(value) <= max_length, do: {:ok, value}, else: :error
    else
      :error
    end
  end

  defp bounded_text(_value, _max_length), do: :error

  defp valid_stream_id?(id), do: Regex.match?(@stream_id_pattern, id)

  defp validation_errors(%{"notes" => notes, "title" => title}) do
    title_length = title |> String.trim() |> String.length()
    notes_length = String.length(notes)

    title_error =
      cond do
        title_length == 0 -> {:title, {"can't be blank", []}}
        title_length < 3 -> {:title, {"must be at least 3 characters", []}}
        title_length > @max_title_length -> {:title, {"must be at most 80 characters", []}}
        true -> nil
      end

    notes_error =
      if notes_length > @max_notes_length,
        do: {:notes, {"must be at most 240 characters", []}},
        else: nil

    Enum.reject([title_error, notes_error], &is_nil/1)
  end

  defp validation_errors(_values), do: []

  defp validation_messages(errors) do
    Map.new(errors, fn {field, {message, _metadata}} -> {field, message} end)
  end
end

defmodule LiveViewReactExamplesWeb.LiveSampleDestination do
  use LiveViewReactExamplesWeb, :live_view

  @allowed_via MapSet.new(["href", "link", "react", "server"])

  def render(assigns) do
    ~H"""
    <main class="mx-auto max-w-3xl space-y-4 px-6 py-10">
      <h1 class="text-3xl font-semibold text-zinc-950">Navigation destination</h1>
      <p class="text-zinc-600">Reached via: {@via}</p>
      <.link navigate={~p"/sample"} class="text-orange-700 underline">
        Return to the comprehensive sample
      </.link>
    </main>
    """
  end

  def mount(params, _session, socket) do
    via =
      params
      |> Map.get("via", "unknown")
      |> normalize_via()

    {:ok, assign(socket, :via, via)}
  end

  defp normalize_via(value) when is_binary(value) do
    if MapSet.member?(@allowed_via, value), do: value, else: "unknown"
  end

  defp normalize_via(_value), do: "unknown"
end
