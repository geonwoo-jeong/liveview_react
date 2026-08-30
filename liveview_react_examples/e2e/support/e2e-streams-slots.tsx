import { Children, useLayoutEffect, useRef, type ReactNode } from "react";
import type { StreamItem } from "liveview_react";

interface E2EStreamItem extends StreamItem {
  readonly id: string;
  readonly label: string;
}

interface StreamListProps {
  readonly items: readonly StreamItem[];
  readonly name: string;
}

interface E2EStreamsSlotsProbeProps {
  readonly children?: ReactNode;
  readonly lastOperation: string;
  readonly mountPhase: string;
  readonly negative: readonly StreamItem[];
  readonly positive: readonly StreamItem[];
  readonly primary: readonly StreamItem[];
  readonly react_missing_update_only_limit: readonly StreamItem[];
  readonly react_reset_update_only: readonly StreamItem[];
  readonly react_update_limit: readonly StreamItem[];
  readonly react_update_only_limit: readonly StreamItem[];
  readonly sidebar?: ReactNode;
}

interface E2EClientOnlyStreamProbeProps {
  readonly client_only: readonly StreamItem[];
}

interface StreamHydrationWindow {
  readonly __liveViewReactStreamHydrationCapture?: {
    readonly node: Element;
    readonly selector: string;
  };
  readonly __liveViewReactStreamHydrationEvidence?: unknown;
}

function isE2EStreamItem(item: unknown): item is E2EStreamItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "__dom_id" in item &&
    typeof item.__dom_id === "string" &&
    "id" in item &&
    typeof item.id === "string" &&
    "label" in item &&
    typeof item.label === "string"
  );
}

function requireStreamItem(streamName: string, item: unknown): E2EStreamItem {
  if (!isE2EStreamItem(item)) {
    throw new TypeError(`${streamName} contains an invalid stream item`);
  }

  return item;
}

function StreamList({ items, name }: StreamListProps) {
  if (!Array.isArray(items)) {
    throw new TypeError(`${name} stream prop is required`);
  }

  return (
    <ol data-testid={`stream-${name}`}>
      {items.map((candidate) => {
        const item = requireStreamItem(name, candidate);

        return (
          <li
            id={item.__dom_id}
            key={item.__dom_id}
            data-stream-dom-id={item.__dom_id}
            data-stream-logical-id={item.id}
            data-testid={`stream-item-${item.__dom_id}`}
          >
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

function recordHydrationEvidence(probe: HTMLElement): void {
  const hydrationWindow = window as unknown as StreamHydrationWindow;
  const capture = hydrationWindow.__liveViewReactStreamHydrationCapture;
  if (!capture || hydrationWindow.__liveViewReactStreamHydrationEvidence) {
    return;
  }

  const streamIds = Array.from(
    probe.querySelectorAll(
      '[data-testid="stream-primary"] [data-stream-dom-id]',
    ),
    (item) => item.getAttribute("data-stream-dom-id"),
  );
  const mountPhase = probe.querySelector(
    '[data-testid="react-mount-phase"]',
  )?.textContent;

  Object.defineProperty(window, "__liveViewReactStreamHydrationEvidence", {
    configurable: true,
    value: Object.freeze({
      mountPhase,
      nodePreserved: capture.node === document.querySelector(capture.selector),
      streamIds: Object.freeze(streamIds),
    }),
  });
}

export function E2EStreamsSlotsProbe({
  children,
  lastOperation,
  mountPhase,
  negative,
  positive,
  primary,
  react_missing_update_only_limit,
  react_reset_update_only,
  react_update_limit,
  react_update_only_limit,
  sidebar,
}: E2EStreamsSlotsProbeProps) {
  const probeRef = useRef<HTMLElement | null>(null);
  const hasDefaultSlot = Children.count(children) > 0;
  const hasNamedSlot = Children.count(sidebar) > 0;

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;

    probe.setAttribute("data-react-committed", "true");
    recordHydrationEvidence(probe);
  }, []);

  return (
    <section
      ref={probeRef}
      data-react-committed="false"
      data-testid="streams-slots-probe"
    >
      <output data-testid="react-last-operation">{lastOperation}</output>
      <output data-testid="react-mount-phase">{mountPhase}</output>

      <StreamList items={primary} name="primary" />
      <StreamList items={positive} name="positive" />
      <StreamList items={negative} name="negative" />
      <StreamList items={react_update_limit} name="react-update-limit" />
      <StreamList
        items={react_update_only_limit}
        name="react-update-only-limit"
      />
      <StreamList
        items={react_missing_update_only_limit}
        name="react-missing-update-only-limit"
      />
      <StreamList
        items={react_reset_update_only}
        name="react-reset-update-only"
      />

      <section
        data-testid="default-slot-region"
        data-slot-state={hasDefaultSlot ? "present" : "absent"}
      >
        {hasDefaultSlot ? children : "default:none"}
      </section>
      <section
        data-testid="named-slot-region"
        data-slot-state={hasNamedSlot ? "present" : "absent"}
      >
        {hasNamedSlot ? sidebar : "named:none"}
      </section>
    </section>
  );
}

export function E2EClientOnlyStreamProbe({
  client_only,
}: E2EClientOnlyStreamProbeProps) {
  return (
    <section data-testid="client-only-stream-probe">
      <StreamList items={client_only} name="client-only" />
    </section>
  );
}
