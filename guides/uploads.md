# Uploads

LiveViewReact uses Phoenix LiveView's existing upload transport. It calls the
public hook `uploadTo` operation; it does not create an HTTP uploader, a
Channel, or depend on `LiveUploader` internals.

## Server setup

Configure uploads with normal LiveView APIs:

```elixir
def mount(_params, _session, socket) do
  {:ok,
   socket
   |> allow_upload(:attachments,
     accept: ~w(.png .jpg),
     max_entries: 3,
     max_file_size: 8_000_000
   )}
end

def handle_event("cancel-upload", %{"name" => "attachments", "ref" => ref}, socket) do
  {:noreply, cancel_upload(socket, :attachments, ref)}
end
```

The actual Phoenix input must be server-rendered and must stay outside the
React-owned mount target. Associate it with the React-rendered form by ID:

```heex
<.live_file_input upload={@uploads.attachments} form="profile-form" />

<.react
  id="profile-editor"
  component="ProfileEditor"
  socket={@socket}
  upload={@uploads.attachments}
/>
```

Do not render a synthetic file input in React. LiveView's
`<.live_file_input>` carries the hook, upload ref, preflight, progress, and
form integration that Phoenix requires.

## React hook

```tsx
import { useLiveUpload, type LiveUploadConfig } from "liveview_react";

export function Attachments({ upload }: { upload: LiveUploadConfig }) {
  const files = useLiveUpload(upload, {
    formId: "profile-form",
    changeEvent: "validate",
    submitEvent: "save",
    cancelEvent: "cancel-upload",
  });

  return (
    <section {...files.dropTargetProps}>
      <button type="button" onClick={files.openFileDialog}>
        Choose files
      </button>

      {files.entries.map((entry) => (
        <article key={entry.ref}>
          <span>{entry.client_name}</span>
          <progress max={100} value={entry.progress} />
          <button type="button" onClick={() => void files.cancel(entry.ref)}>
            Cancel
          </button>
        </article>
      ))}

      <button type="button" onClick={files.submit}>
        Submit form
      </button>
    </section>
  );
}
```

The result exposes the encoded entries and errors, accepted extensions,
maximum size/count, picker control, official drop-target props, upload status,
cancellation, native form submission, and interrupted selections.
`addFiles(files)` is available for a programmatic `FileList` or `File[]` and
still delegates to Phoenix's public upload operation.

The hook validates the real input before use: ID/ref, name, associated form,
`multiple`, `accept`, auto-upload, target scope, and duplicate inputs must all
match the encoded config. Invalid or unknown wire fields, duplicate entry refs,
foreign error refs, cyclic values, and prototype-polluting keys fail closed.

## Capacity and errors

For one-entry uploads, a new single selection follows Phoenix replacement
semantics; a multi-file batch is rejected. For multi-entry uploads, the hook
counts active server entries, pending retained files, and new file identities.
It never silently truncates a selection. Phoenix remains authoritative for
consumed-entry accounting in `max_entries_mode: "total"`, because that internal
counter is intentionally not exposed on the public wire.

Config-level errors have the upload config ref. Entry errors have that entry's
ref and are also projected onto `entry.errors`. Server validation and
`upload_errors/2` remain the source of truth.

## Reconnect and file lifetime

Browser `File` objects are retained only in hook-local memory. When the
connection drops, selected files become `interrupted`; they are not uploaded or
submitted automatically. `retryInterrupted()` is explicit and is allowed only
after the server supplies a fresh upload config ref. The hook then creates a new
browser `File` with the same bytes and public metadata before restarting from
zero through Phoenix's public upload API. This avoids coupling to Phoenix's
per-object tracking fields. If capacity narrowed, the retry fails without
discarding the retained files.

Once a retained file has been correlated with a server entry, the hook releases
the `File` when that entry completes, is cancelled, or disappears. Unmount also
removes the native input listener. This policy avoids both accidental replay
and long-lived file references.
