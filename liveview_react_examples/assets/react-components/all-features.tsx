import {
  Children,
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useEventReply,
  useLiveConnection,
  useLiveEvent,
  useLiveForm,
  useLiveNavigation,
  useLiveUpload,
  useLiveViewReact,
} from "liveview_react";
import type {
  LiveFormServerSnapshot,
  LiveUploadConfig,
  StreamItem,
} from "liveview_react";
import { React19Capabilities } from "./react19-capabilities";

type SectionProps = {
  readonly title: string;
  readonly children: ReactNode;
};

type SampleStreamItem = StreamItem & {
  readonly id: string;
  readonly label: string;
};

type CounterContextValue = {
  readonly count: number;
  readonly incrementByOne: () => void;
};

type AllFeaturesProps = {
  readonly children?: ReactNode;
  readonly count: number;
  readonly currentPath: string;
  readonly currentStep: string;
  readonly items: readonly SampleStreamItem[];
  readonly livePid: string;
  readonly notices: readonly string[];
  readonly onServerIncrement?:
    | ((payload: { by: number; source: string }) => void)
    | null;
  readonly portalTargetId: string;
  readonly searchReply: string;
  readonly sidebar?: ReactNode;
};

type SampleFormsUploadsProps = {
  readonly sampleForm: LiveFormServerSnapshot;
  readonly sampleUpload: LiveUploadConfig;
};

const CounterContext = createContext<CounterContextValue | null>(null);

function Section({ title, children }: SectionProps) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <div className="mt-4 space-y-4 text-sm text-zinc-700">{children}</div>
    </section>
  );
}

function CounterSummary() {
  const context = useContext(CounterContext);

  if (context === null) {
    throw new Error("CounterSummary must render inside CounterContext");
  }

  return (
    <div className="flex items-center justify-between rounded-xl bg-orange-50 px-4 py-3">
      <span>React Context sees count {context.count}</span>
      <button
        type="button"
        className="rounded-lg bg-orange-600 px-3 py-2 font-medium text-white"
        onClick={context.incrementByOne}
      >
        +1 via pushEvent
      </button>
    </div>
  );
}

function PortalSurface({
  children,
  targetId,
}: {
  readonly children: ReactNode;
  readonly targetId: string;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(targetId));
  }, [targetId]);

  if (target === null) {
    return null;
  }

  return createPortal(children, target);
}

function UploadEntries({
  onCancel,
  upload,
}: {
  readonly onCancel: (ref: string) => Promise<void>;
  readonly upload: ReturnType<typeof useLiveUpload>;
}) {
  return (
    <ul className="space-y-2">
      {upload.entries.map((entry) => (
        <li
          key={entry.ref}
          className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2"
        >
          <span>
            {entry.client_name} {entry.progress}% {entry.errors.join(", ")}
          </span>
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-1"
            onClick={() => void onCancel(entry.ref)}
          >
            cancel
          </button>
        </li>
      ))}
    </ul>
  );
}

function uploadAcceptLabel(accept: LiveUploadConfig["accept"]) {
  return Array.isArray(accept) ? accept.join(", ") : accept;
}

function json(value: unknown) {
  return JSON.stringify(value);
}

export function AllFeatures({
  children,
  count,
  currentPath,
  currentStep,
  items,
  livePid,
  notices,
  onServerIncrement,
  portalTargetId,
  searchReply,
  sidebar,
}: AllFeaturesProps) {
  const { pushEvent } = useLiveViewReact();
  const connection = useLiveConnection();
  const navigation = useLiveNavigation();
  const search = useEventReply<{ result: string }, { result: string }>(
    "search_reply",
    {
      initialData: { result: searchReply },
    },
  );
  const [hydrated, setHydrated] = useState(false);
  const [noticeFeed, setNoticeFeed] = useState<readonly string[]>(notices);
  const [streamDraft, setStreamDraft] = useState("");
  const hasDefaultSlot = Children.count(children) > 0;
  const hasSidebarSlot = Children.count(sidebar) > 0;
  const firstItemId = items[0]?.id ?? null;

  useEffect(() => {
    setHydrated(true);
  }, []);

  useLiveEvent<{ message: string }>("sample_notice", ({ message }) => {
    setNoticeFeed((current) => [...current, message].slice(-5));
  });

  const counterContext: CounterContextValue = {
    count,
    incrementByOne: () => {
      void pushEvent("increment_count", { by: 1, source: "context" });
    },
  };

  async function emitNotice() {
    await pushEvent("emit_notice", { message: `notice:${Date.now()}` });
  }

  async function requestSearchReply() {
    await search.execute({
      query: currentStep === "initial" ? "sample" : currentStep,
    });
  }

  async function addStreamItem() {
    await pushEvent("add_stream_item", { label: streamDraft });
    setStreamDraft("");
  }

  async function renameFirstStreamItem() {
    if (firstItemId === null) {
      return;
    }

    await pushEvent("rename_stream_item", {
      id: firstItemId,
      label: streamDraft,
    });
    setStreamDraft("");
  }

  return (
    <CounterContext.Provider value={counterContext}>
      <PortalSurface targetId={portalTargetId}>
        <div
          data-testid="sample-portal-content"
          className="mt-4 rounded-xl bg-zinc-900 p-4 text-sm text-white"
        >
          Portal mounted from React root {livePid} at count {count}.
        </div>
      </PortalSurface>

      <div className="space-y-6">
        <Section title="SSR, root lifecycle, and connection state">
          <p>
            The root arrived through SSR, then hydrated into a connected bridge.
            Path <strong>{currentPath}</strong>, step{" "}
            <strong>{currentStep}</strong>, pid <strong>{livePid}</strong>.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <output
              data-testid="sample-connection-state"
              className="rounded-xl bg-zinc-100 px-3 py-2"
            >
              {hydrated ? "hydrated" : "ssr"} /{" "}
              {connection.connected ? "connected" : "disconnected"} /{" "}
              {connection.reconnecting ? "reconnecting" : "stable"}
            </output>
            <output
              data-testid="sample-count"
              className="rounded-xl bg-zinc-100 px-3 py-2"
            >
              authoritative count:{count}
            </output>
          </div>
          <CounterSummary />
          <React19Capabilities />
        </Section>

        <Section title="Events, replies, and server commands">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="sample-r-on-increment"
              className="rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white"
              onClick={() => onServerIncrement?.({ by: 3, source: "r-on" })}
            >
              r-on callback
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              phx-click="increment_count"
              phx-value-by="2"
            >
              React phx-click
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() => void emitNotice()}
            >
              push_event emit
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() => void requestSearchReply()}
            >
              useEventReply execute
            </button>
          </div>
          <output className="block rounded-xl bg-zinc-100 px-3 py-2">
            latest reply:{search.data.result}
          </output>
          <output className="block rounded-xl bg-zinc-100 px-3 py-2">
            notices:{noticeFeed.join(" | ")}
          </output>
        </Section>

        <Section title="Streams, slots, registry loading, and portals">
          <div className="flex flex-wrap gap-2">
            <input
              data-testid="sample-stream-input"
              value={streamDraft}
              onChange={(event) => setStreamDraft(event.target.value)}
              placeholder="New or updated stream item"
              maxLength={120}
              className="rounded-lg border border-zinc-300 px-3 py-2"
            />
            <button
              type="button"
              data-testid="sample-stream-append"
              className="rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white"
              onClick={() => void addStreamItem()}
            >
              append stream item
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() => void renameFirstStreamItem()}
            >
              update first item
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() => void pushEvent("rotate_stream", {})}
            >
              reset stream
            </button>
          </div>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.__dom_id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2"
              >
                <span>
                  {item.label}{" "}
                  <span className="text-zinc-400">({item.__dom_id})</span>
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-3 py-1"
                  onClick={() =>
                    void pushEvent("delete_stream_item", { id: item.id })
                  }
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 md:grid-cols-2">
            <div
              className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3"
              data-default-slot={hasDefaultSlot ? "present" : "absent"}
            >
              {hasDefaultSlot ? children : "No default slot"}
            </div>
            <div
              className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3"
              data-sidebar-slot={hasSidebarSlot ? "present" : "absent"}
            >
              {hasSidebarSlot ? sidebar : "No named slot"}
            </div>
          </div>
          <div
            data-testid="sample-lazy-registry"
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-zinc-600"
          >
            The AllFeatures root itself is resolved through the registry's lazy
            <code className="mx-1">load</code> entry before SSR or client mount.
          </div>
        </Section>

        <Section title="Navigation">
          <p>
            Patch stays on the same LiveView, navigate replaces it, and href
            performs a document-level transition.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() => navigation.patch("/sample?step=react-patch")}
            >
              useLiveNavigation.patch
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() =>
                navigation.navigate("/sample/destination?via=react")
              }
            >
              useLiveNavigation.navigate
            </button>
            <Link
              patch="/sample?step=link-patch"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
            >
              Link patch
            </Link>
            <Link
              navigate="/sample/destination?via=link"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
            >
              Link navigate
            </Link>
            <Link
              href="/sample?step=link-href"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
            >
              Link href
            </Link>
          </div>
        </Section>
      </div>
    </CounterContext.Provider>
  );
}

export function SampleFormsUploads({
  sampleForm,
  sampleUpload,
}: SampleFormsUploadsProps) {
  const form = useLiveForm(sampleForm, {
    changeEvent: "validate_form",
    debounce: 150,
    submitEvent: "submit_form",
  });
  const upload = useLiveUpload(sampleUpload, {
    cancelEvent: "cancel_upload",
    changeEvent: "validate_form",
    formId: form.id,
    submitEvent: "submit_form",
  });
  const titleField = form.field(["title"], { required: true, type: "text" });
  const notesField = form.field(["notes"], { type: "text" });
  const [submitState, setSubmitState] = useState("idle");

  async function submitSampleForm() {
    setSubmitState("pending");

    try {
      setSubmitState(json(await form.submit()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitState(`error:${message}`);
    }
  }

  async function cancelUpload(ref: string) {
    await upload.cancel(ref);
  }

  return (
    <div data-testid="sample-forms-uploads-root">
      <Section title="Forms and uploads">
        <p>
          This root is intentionally client-only because Phoenix upload refs are
          created for the connected LiveView and resolve a native browser input.
        </p>
        <form {...form.formProps} className="space-y-4">
          <input {...form.revisionInputProps} />
          <label className="block space-y-2">
            <span className="font-medium">Title</span>
            <input
              {...titleField.inputProps}
              data-testid="sample-form-title"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              minLength={3}
              maxLength={80}
            />
          </label>
          <output
            data-testid="sample-form-title-errors"
            className="block rounded-xl bg-zinc-100 px-3 py-2"
          >
            title errors:{titleField.displayErrors.join(", ") || "none"}
          </output>
          <label className="block space-y-2">
            <span className="font-medium">Notes</span>
            <input
              {...notesField.inputProps}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              maxLength={240}
            />
          </label>
          <output className="block rounded-xl bg-zinc-100 px-3 py-2">
            form state: valid {String(form.valid)} / dirty {String(form.dirty)}{" "}
            / touched {String(form.touched)}
          </output>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="sample-form-submit"
              className="rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white"
              onClick={() => void submitSampleForm()}
            >
              submit via useLiveForm
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={form.reset}
            >
              reset local draft
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={upload.openFileDialog}
            >
              choose files
            </button>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 px-3 py-2 font-medium"
              onClick={() => upload.retryInterrupted()}
            >
              retry interrupted
            </button>
          </div>
        </form>
        <div
          {...upload.dropTargetProps}
          className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4"
          onDragOver={(event) => event.preventDefault()}
        >
          Drop files here for the LiveView upload input
        </div>
        <output
          data-testid="sample-form-submit-state"
          className="block rounded-xl bg-zinc-100 px-3 py-2"
        >
          submit state:{submitState}
        </output>
        <output className="block rounded-xl bg-zinc-100 px-3 py-2">
          upload config:{upload.autoUpload ? "auto" : "manual"} /{" "}
          {upload.maxEntries} / {uploadAcceptLabel(sampleUpload.accept)}
        </output>
        <UploadEntries upload={upload} onCancel={cancelUpload} />
      </Section>
    </div>
  );
}
