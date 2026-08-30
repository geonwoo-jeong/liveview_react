import { useEffect, useLayoutEffect, useRef } from "react";

import { useRequiredClientBridge } from "../runtime/client-bridge-context";

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

  const { handleEvent, removeHandleEvent } =
    useRequiredClientBridge("useLiveEvent");
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    let active = true;
    const eventReference = handleEvent(event, (payload: TPayload) => {
      if (active) handlerRef.current(payload);
    });

    return () => {
      active = false;
      removeHandleEvent(eventReference);
    };
  }, [event, handleEvent, removeHandleEvent]);
}
