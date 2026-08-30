import { Children, useLayoutEffect, useRef } from "react";

function requireStreamItem(streamName, item) {
  if (
    typeof item !== "object" ||
    item === null ||
    typeof item.__dom_id !== "string" ||
    typeof item.id !== "string" ||
    typeof item.label !== "string"
  ) {
    throw new TypeError(`${streamName} contains an invalid stream item`);
  }

  return item;
}

function StreamList({ items, name }) {
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

function recordHydrationEvidence(probe) {
  const capture = window.__liveViewReactStreamHydrationCapture;
  if (!capture || window.__liveViewReactStreamHydrationEvidence) return;

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
}) {
  const probeRef = useRef(null);
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

export function E2EClientOnlyStreamProbe({ client_only }) {
  return (
    <section data-testid="client-only-stream-probe">
      <StreamList items={client_only} name="client-only" />
    </section>
  );
}
