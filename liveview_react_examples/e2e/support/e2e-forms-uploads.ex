defmodule LiveViewReactExamplesWeb.LiveFormsUploadsE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  alias LiveViewReact.Forms

  @form_id "e2e-live-form"
  @initial_values %{"title" => "initial"}

  def render(assigns) do
    ~H"""
    <main data-testid="forms-uploads-harness" class="space-y-4 p-6">
      <section aria-label="server form state" class="space-y-2">
        <output data-testid="server-mount-generation">{@mount_generation}</output>
        <output data-testid="server-validation-received">{@validation_received}</output>
        <output data-testid="server-validation-applied">{@validation_applied}</output>
        <output data-testid="server-last-submit">{@last_submit}</output>
        <output data-testid="server-uploaded-files">{Enum.join(@uploaded_files, ",")}</output>
        <output data-testid="server-auto-progress">{Enum.join(@auto_progress_events, ",")}</output>
        <output data-testid="server-cancelled-refs">{Enum.join(@cancelled_refs, ",")}</output>
      </section>

      <.react
        id="e2e-forms-uploads-root"
        component="E2EFormsUploadsProbe"
        autoProgressEvents={@auto_progress_events}
        autoUpload={@uploads.auto_files}
        manualUpload={@uploads.manual_files}
        mountGeneration={@mount_generation}
        serverForm={@form}
        socket={@socket}
        ssr={false}
        uploadedFiles={@uploaded_files}
      />

      <section data-testid="native-upload-inputs" aria-label="native LiveView upload inputs">
        <.live_file_input
          upload={@uploads.manual_files}
          form={@form.id}
          data-testid="manual-native-input"
        />
        <.live_file_input
          upload={@uploads.auto_files}
          form={@form.id}
          data-testid="auto-native-input"
        />
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
        auto_progress_events: [],
        cancelled_refs: [],
        form: build_form(@initial_values),
        last_submit: "none",
        mount_generation: mount_generation,
        uploaded_files: [],
        validation_applied: "none",
        validation_received: "none"
      )
      |> allow_upload(:manual_files,
        accept: ~w(.txt),
        auto_upload: false,
        max_entries: 2,
        max_file_size: 64
      )
      |> allow_upload(:auto_files,
        accept: ~w(.txt),
        auto_upload: true,
        max_entries: 1,
        max_file_size: 1_024,
        progress: &handle_auto_progress/3
      )

    {:ok, socket}
  end

  def handle_event(
        "validate_form",
        %{"profile" => values, "_liveview_react_revision" => _revision} = params,
        socket
      )
      when is_map(values) do
    form =
      values
      |> build_form(validation_errors(values))
      |> Forms.with_revision_from_params(params)

    revision = validated_revision(params)
    title = Map.get(values, "title", "")
    delay = if title == "slow", do: 350, else: 20
    Process.send_after(self(), {:apply_validation, form, revision, title}, delay)

    {:reply, %{accepted_revision: revision},
     assign(socket, :validation_received, "#{revision}:#{title}")}
  end

  def handle_event("validate_form", _params, socket) do
    {:reply, %{error: "invalid_form_payload"}, socket}
  end

  def handle_event(
        "submit_form",
        %{"profile" => values, "_liveview_react_revision" => _revision} = params,
        socket
      )
      when is_map(values) do
    manual_files =
      consume_uploaded_entries(socket, :manual_files, fn _metadata, entry ->
        {:ok, entry.client_name}
      end)
      |> Enum.sort()

    revision = validated_revision(params)

    submit_reply = %{
      manual_files: manual_files,
      revision: revision,
      status: "saved",
      title: Map.get(values, "title", "")
    }

    form =
      values
      |> build_form(validation_errors(values))
      |> Forms.with_revision_from_params(params)

    uploaded_files = socket.assigns.uploaded_files ++ Enum.map(manual_files, &"manual:#{&1}")

    socket =
      socket
      |> Forms.reply(form, submit_reply)
      |> assign(
        form: form,
        last_submit: "#{revision}:#{Map.get(values, "title", "")}",
        uploaded_files: uploaded_files
      )

    {:noreply, socket}
  end

  def handle_event("submit_form", _params, socket) do
    {:noreply, assign(socket, :last_submit, "invalid_form_payload")}
  end

  def handle_event("cancel_upload", %{"name" => name, "ref" => ref}, socket)
      when is_binary(ref) do
    case upload_name(name) do
      {:ok, upload_name} ->
        {:reply, %{cancelled: ref},
         socket
         |> cancel_upload(upload_name, ref)
         |> update(:cancelled_refs, &(&1 ++ [ref]))}

      :error ->
        {:reply, %{error: "unknown_upload"}, socket}
    end
  end

  def handle_event("cancel_upload", _params, socket) do
    {:reply, %{error: "invalid_cancel_payload"}, socket}
  end

  def handle_info({:apply_validation, form, revision, title}, socket) do
    {:noreply,
     assign(socket,
       form: form,
       validation_applied: "#{revision}:#{title}"
     )}
  end

  defp handle_auto_progress(:auto_files, entry, socket) do
    progress_event = "#{entry.client_name}:#{entry.progress}"
    socket = update(socket, :auto_progress_events, &(&1 ++ [progress_event]))

    if entry.done? do
      uploaded_name =
        consume_uploaded_entry(socket, entry, fn _metadata ->
          {:ok, entry.client_name}
        end)

      {:noreply, update(socket, :uploaded_files, &(&1 ++ ["auto:#{uploaded_name}"]))}
    else
      {:noreply, socket}
    end
  end

  defp build_form(values, errors \\ []) do
    Phoenix.Component.to_form(values,
      as: "profile",
      errors: errors,
      id: @form_id
    )
  end

  defp validation_errors(%{"title" => "slow"}),
    do: [title: {"stale slow validation", []}]

  defp validation_errors(%{"title" => title}) when is_binary(title) and byte_size(title) < 3,
    do: [title: {"must be at least 3 characters", []}]

  defp validation_errors(_values), do: []

  defp validated_revision(%{"_liveview_react_revision" => revision})
       when is_integer(revision),
       do: revision

  defp validated_revision(%{"_liveview_react_revision" => revision})
       when is_binary(revision),
       do: String.to_integer(revision)

  defp upload_name("manual_files"), do: {:ok, :manual_files}
  defp upload_name("auto_files"), do: {:ok, :auto_files}
  defp upload_name(_name), do: :error
end
