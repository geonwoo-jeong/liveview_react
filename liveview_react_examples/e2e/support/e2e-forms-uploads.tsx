import { useState } from "react";
import {
  useLiveForm,
  useLiveUpload,
  type LiveFormServerSnapshot,
  type LiveUploadConfig,
  type LiveUploadSelection,
  type UseLiveUploadResult,
} from "liveview_react";

interface FormValues {
  readonly title: string;
}

interface SubmitReply {
  readonly manual_files: readonly string[];
  readonly revision: number;
  readonly status: string;
  readonly title: string;
}

interface UploadEntriesProps {
  readonly name: string;
  readonly onCancel: (entryRef: string) => Promise<void> | void;
  readonly upload: UseLiveUploadResult;
}

interface UploadSelectionsProps {
  readonly name: string;
  readonly selections: readonly LiveUploadSelection[];
}

interface E2EFormsUploadsProbeProps {
  readonly autoProgressEvents: readonly string[];
  readonly autoUpload: LiveUploadConfig;
  readonly manualUpload: LiveUploadConfig;
  readonly mountGeneration: number;
  readonly serverForm: LiveFormServerSnapshot<FormValues>;
  readonly uploadedFiles: readonly string[];
}

function json(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function UploadEntries({ name, upload, onCancel }: UploadEntriesProps) {
  return (
    <ul data-testid={`${name}-entries`}>
      {upload.entries.map((entry) => (
        <li
          key={entry.ref}
          data-testid={`${name}-entry`}
          data-entry-ref={entry.ref}
        >
          <span>{entry.client_name}</span>
          <span data-testid={`${name}-entry-progress`}>{entry.progress}</span>
          <span data-testid={`${name}-entry-errors`}>{json(entry.errors)}</span>
          <button type="button" onClick={() => void onCancel(entry.ref)}>
            cancel {entry.client_name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function UploadSelections({ name, selections }: UploadSelectionsProps) {
  return (
    <output data-testid={`${name}-selections`}>
      {selections
        .map(
          (selection) =>
            `${selection.file.name}:${selection.status}:${selection.entryRef ?? "pending"}`,
        )
        .join(",") || "none"}
    </output>
  );
}

export function E2EFormsUploadsProbe({
  autoProgressEvents,
  autoUpload,
  manualUpload,
  mountGeneration,
  serverForm,
  uploadedFiles,
}: E2EFormsUploadsProbeProps) {
  const form = useLiveForm<FormValues, SubmitReply>(serverForm, {
    changeEvent: "validate_form",
    debounce: 15,
    submitEvent: "submit_form",
  });
  const manual = useLiveUpload(manualUpload, {
    cancelEvent: "cancel_upload",
    changeEvent: "validate_form",
    formId: form.id,
    submitEvent: "submit_form",
  });
  const automatic = useLiveUpload(autoUpload, {
    cancelEvent: "cancel_upload",
    changeEvent: "validate_form",
    formId: form.id,
    submitEvent: "submit_form",
  });
  const title = form.field(["title"], { required: true, type: "text" });
  const [cancelReply, setCancelReply] = useState("none");
  const [retryResult, setRetryResult] = useState("none");
  const [submitResult, setSubmitResult] = useState("none");

  async function cancelEntry(
    upload: UseLiveUploadResult,
    ref: string,
  ): Promise<void> {
    try {
      setCancelReply(json(await upload.cancel(ref)));
    } catch (error) {
      setCancelReply(`error:${errorMessage(error)}`);
    }
  }

  async function cancelEveryManualEntry(): Promise<void> {
    try {
      setCancelReply(json(await manual.cancelAll()));
    } catch (error) {
      setCancelReply(`error:${errorMessage(error)}`);
    }
  }

  async function submitForm(): Promise<void> {
    setSubmitResult("pending");
    try {
      setSubmitResult(json(await form.submit()));
    } catch (error) {
      setSubmitResult(`error:${errorMessage(error)}`);
    }
  }

  function retryManualUpload(): void {
    try {
      manual.retryInterrupted();
      setRetryResult("retried");
    } catch (error) {
      setRetryResult(`error:${errorMessage(error)}`);
    }
  }

  return (
    <section data-testid="forms-uploads-probe">
      <output data-testid="connection-state">
        {manual.connected ? "connected" : "disconnected"}:
        {manual.reconnecting ? "reconnecting" : "stable"}
      </output>
      <output data-testid="react-mount-generation">{mountGeneration}</output>

      <form {...form.formProps}>
        <input {...form.revisionInputProps} />
        <label htmlFor="e2e-title">Title</label>
        <input id="e2e-title" data-testid="form-title" {...title.inputProps} />
        <output data-testid="form-title-value">
          {String(form.values.title)}
        </output>
        <output data-testid="form-title-errors">
          {title.displayErrors.join(",") || "none"}
        </output>
        <output data-testid="form-valid">{String(form.valid)}</output>
        <output data-testid="form-dirty">{String(form.dirty)}</output>
        <output data-testid="form-touched">{String(form.touched)}</output>
        <output data-testid="form-validating">{String(form.validating)}</output>
        <output data-testid="form-submitting">{String(form.submitting)}</output>
        <output data-testid="form-revision">{form.revision}</output>
        <output data-testid="form-submit-reply">
          {json(form.submitReply)}
        </output>
        <output data-testid="form-submit-result">{submitResult}</output>

        <button
          data-testid="submit-form"
          type="button"
          onClick={() => void submitForm()}
        >
          submit form
        </button>
        <button data-testid="reset-form" type="button" onClick={form.reset}>
          reset form
        </button>
      </form>

      <section aria-label="manual upload controls">
        <output data-testid="manual-config">
          {manual.autoUpload ? "auto" : "manual"}:{manual.maxEntries}:
          {manual.acceptAttribute}
        </output>
        <output data-testid="manual-input-id">{manual.inputId}</output>
        <output data-testid="manual-errors">{json(manual.errors)}</output>
        <output data-testid="manual-form-errors">
          {json(manual.formErrors)}
        </output>
        <output data-testid="manual-uploading">
          {String(manual.isUploading)}
        </output>
        <UploadSelections name="manual" selections={manual.selections} />
        <UploadEntries
          name="manual"
          upload={manual}
          onCancel={(ref) => cancelEntry(manual, ref)}
        />
        <button
          data-testid="open-manual-dialog"
          type="button"
          onClick={manual.openFileDialog}
        >
          choose manual files
        </button>
        <button
          data-testid="cancel-all-manual"
          type="button"
          onClick={() => void cancelEveryManualEntry()}
        >
          cancel all manual files
        </button>
        <button
          data-testid="retry-manual"
          type="button"
          onClick={retryManualUpload}
        >
          retry interrupted manual files
        </button>
        <div
          {...manual.dropTargetProps}
          data-testid="manual-dropzone"
          onDragOver={(event) => event.preventDefault()}
        >
          drop manual files
        </div>
      </section>

      <section aria-label="automatic upload controls">
        <output data-testid="auto-config">
          {automatic.autoUpload ? "auto" : "manual"}:{automatic.maxEntries}:
          {automatic.acceptAttribute}
        </output>
        <output data-testid="auto-errors">{json(automatic.errors)}</output>
        <output data-testid="auto-uploading">
          {String(automatic.isUploading)}
        </output>
        <UploadSelections name="auto" selections={automatic.selections} />
        <UploadEntries
          name="auto"
          upload={automatic}
          onCancel={(ref) => cancelEntry(automatic, ref)}
        />
        <button
          data-testid="open-auto-dialog"
          type="button"
          onClick={automatic.openFileDialog}
        >
          choose automatic file
        </button>
        <div
          {...automatic.dropTargetProps}
          data-testid="auto-dropzone"
          onDragOver={(event) => event.preventDefault()}
        >
          drop automatic file
        </div>
      </section>

      <output data-testid="cancel-reply">{cancelReply}</output>
      <output data-testid="retry-result">{retryResult}</output>
      <output data-testid="react-uploaded-files">
        {uploadedFiles.join(",")}
      </output>
      <output data-testid="react-auto-progress">
        {autoProgressEvents.join(",")}
      </output>
    </section>
  );
}
