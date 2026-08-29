import { useEffect, useEffectEvent } from "react";

import { useLiveReact } from "./useLiveReact";

function assertEventName(event: string): void {
  if (event.length === 0) {
    throw new TypeError("useLiveEvent requires a non-empty event name");
  }
}

export function useLiveEvent<TPayload>(
  event: string,
  handler: (payload: TPayload) => void,
): void {
  assertEventName(event);

  const { handleEvent, removeHandleEvent } = useLiveReact();
  const onEvent = useEffectEvent(handler);

  useEffect(() => {
    let active = true;
    const eventReference = handleEvent(event, (payload: TPayload) => {
      if (active) onEvent(payload);
    });

    return () => {
      active = false;
      removeHandleEvent(eventReference);
    };
  }, [event, handleEvent, removeHandleEvent]);
}
