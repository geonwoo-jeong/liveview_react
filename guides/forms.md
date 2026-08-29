# Forms

LiveViewReact forms keep field edits local while LiveView remains authoritative
for validation and submission. A `Phoenix.HTML.Form` is transported as an
ordinary immutable prop; there is no second form channel or client-owned server
state.

## Server snapshot

Build a normal Phoenix form, then attach the client revision with
`LiveViewReact.Forms`:

```elixir
alias LiveViewReact.Forms

def mount(_params, _session, socket) do
  form =
    %{"email" => "", "marketing" => false}
    |> Phoenix.Component.to_form(as: :profile, id: "profile-form")
    |> Forms.with_metadata(revision: 0)

  {:ok, assign(socket, form: form)}
end

def handle_event("validate", %{"profile" => params} = event, socket) do
  form =
    params
    |> validate_profile()
    |> Phoenix.Component.to_form(as: :profile, id: "profile-form")
    |> Forms.with_revision_from_params(event)

  {:noreply, assign(socket, form: form)}
end

def handle_event("save", %{"profile" => params} = event, socket) do
  with {:ok, profile} <- save_profile(params) do
    form =
      profile
      |> Phoenix.Component.to_form(as: :profile, id: "profile-form")
      |> Forms.with_revision_from_params(event)

    socket =
      socket
      |> assign(form: form)
      |> Forms.reply(form, %{id: profile.id})

    {:noreply, socket}
  end
end
```

Pass that form directly to the root:

```heex
<.react
  id="profile-editor"
  component="ProfileEditor"
  socket={@socket}
  serverForm={@form}
/>
```

The wire shape is fixed to `id`, `name`, `values`, `errors`, `required`,
`valid`, and `revision`. Revisions are non-negative JavaScript-safe integers.
Unknown metadata and malformed revisions fail before rendering. Submit results
are events rather than transient props; `Forms.reply/3` encodes the reply and
dispatches it before the associated DOM patch.

Ecto support is optional. When `ecto` and `phoenix_ecto` are installed,
changed embeds and associations are normalized recursively. Unchanged embeds
with a cast callback retain their nested required/error tree. Unchanged
associations stay Encoder-controlled leaves so a loaded bidirectional graph is
never traversed implicitly.

## React form

```tsx
import {
  useLiveForm,
  type LiveFormServerSnapshot,
} from "liveview_react";

type ProfileValues = {
  readonly email: string;
  readonly marketing: boolean;
};

export default function ProfileEditor({
  serverForm,
}: {
  serverForm: LiveFormServerSnapshot<ProfileValues>;
}) {
  const form = useLiveForm<ProfileValues, { readonly id: number }>(serverForm, {
    changeEvent: "validate",
    submitEvent: "save",
    debounce: 150,
  });
  const email = form.field(["email"], { type: "email" });
  const marketing = form.field(["marketing"], { type: "checkbox" });

  return (
    <form {...form.formProps}>
      <input {...form.revisionInputProps} />

      <label>
        Email
        <input {...email.inputProps} />
      </label>
      {email.displayErrors.map((error) => (
        <p key={error}>{error}</p>
      ))}

      <label>
        {marketing.hiddenInputProps && (
          <input {...marketing.hiddenInputProps} />
        )}
        <input {...marketing.inputProps} />
        Marketing email
      </label>

      <button type="submit" disabled={form.submitting}>
        Save
      </button>
    </form>
  );
}
```

`field(path)` formats Phoenix bracket names and returns DOM props separately
from metadata. Render a single checkbox's hidden input before the checkbox.
Multiple checkboxes and multiple selects use `[]` names and keep values in
local state order. Radio, number, range, date, textarea, and select controls use
their native browser values; an empty numeric input becomes `null`.

Field change handlers stop only the underlying native event from reaching
LiveView's document delegation. React parent handlers still run. The hook sends
one debounced `changeEvent` containing the full named values, `_target`, and
`_liveview_react_revision`.

## Validation, submission, and reconnect

- Typing updates immutable local values immediately. A push-event acknowledgement
  is not a validation result; `errors`, `required`, and `valid` change only when
  a same-or-newer server snapshot arrives.
- Older revisions cannot overwrite newer local edits.
- `submit()` calls the form's native `requestSubmit()`. It never sends a second
  event. Native constraint validation and the form's `phx-submit` binding remain
  authoritative.
- A submit Promise completes only for a `Forms.reply/3` event with the same form
  ID/name and a same-or-newer revision. `nil` is an explicit reply. Validation
  snapshots and events for another form cannot accidentally finish a
  submission.
- On disconnect, an active submit is rejected and is never replayed. Pristine
  forms adopt the reconnect snapshot. Dirty forms retain local values and
  touched paths, merge current server errors, and revalidate exactly once after
  reconnect.
- `reset()` restores the last accepted server snapshot and cancels timers and
  any pending submit.

The hook owns reconnect recovery, so `formProps` sets
`phx-auto-recover="ignore"`. Do not add a second LiveView recovery strategy to
the same form.
