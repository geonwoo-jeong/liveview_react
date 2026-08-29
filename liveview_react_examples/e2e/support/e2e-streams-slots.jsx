import { Children } from "react";

function requireStreamItem(streamName, item) {
  if (
    typeof item !== "object" ||
    item === null ||
    typeof item.__dom_id !== "string" ||
    typeof item.label !== "string"
  ) {
    throw new TypeError(`${streamName} contains an invalid stream item`);
  }

  return item;
}

function StreamList({ items = [], name }) {
  return (
    <ol data-testid={`stream-${name}`}>
      {items.map((candidate) => {
        const item = requireStreamItem(name, candidate);

        return (
          <li
            id={item.__dom_id}
            key={item.__dom_id}
            data-stream-dom-id={item.__dom_id}
            data-testid={`stream-item-${item.__dom_id}`}
          >
            {item.label}
          </li>
        );
      })}
    </ol>
  );
}

export function E2EStreamsSlotsProbe({
  children,
  lastOperation,
  negative = [],
  positive = [],
  primary = [],
  sidebar,
}) {
  const hasDefaultSlot = Children.count(children) > 0;
  const hasNamedSlot = Children.count(sidebar) > 0;

  return (
    <section data-testid="streams-slots-probe">
      <output data-testid="react-last-operation">{lastOperation}</output>

      <StreamList items={primary} name="primary" />
      <StreamList items={positive} name="positive" />
      <StreamList items={negative} name="negative" />

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
