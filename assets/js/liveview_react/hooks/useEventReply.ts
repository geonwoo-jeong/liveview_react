import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { EventPayload, PushEvent } from "../types";
import { useLiveReact } from "./useLiveReact";

export class LiveEventReplyCancelledError extends Error {
  constructor(message = "Live event reply was cancelled") {
    super(message);
    this.name = "LiveEventReplyCancelledError";
  }
}

export class LiveEventReplyTimeoutError extends Error {
  constructor(event: string, timeoutMs: number) {
    super(`Live event "${event}" timed out after ${timeoutMs}ms`);
    this.name = "LiveEventReplyTimeoutError";
  }
}

export interface UseEventReplyOptions<TReply, TData = TReply | null> {
  readonly initialData?: TData;
  readonly reduce?: (current: TData, reply: TReply) => TData;
  readonly timeout?: number;
}

export interface UseEventReplyResult<TReply, TData = TReply | null> {
  readonly cancel: () => void;
  readonly data: TData;
  readonly error: unknown;
  readonly execute: (payload?: EventPayload) => Promise<TReply>;
  readonly isLoading: boolean;
}

interface ActiveRequest<TReply> {
  readonly id: number;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (reply: TReply) => void;
  readonly timeoutId: ReturnType<typeof setTimeout> | null;
}

interface ReplyConfig<TReply, TData> {
  readonly event: string;
  readonly pushEvent: PushEvent;
  readonly reduce: ((current: TData, reply: TReply) => TData) | undefined;
  readonly timeout: number | undefined;
}

interface ReplyState<TData> {
  readonly data: TData;
  readonly error: unknown;
  readonly isLoading: boolean;
}

function assertEventName(event: string): void {
  if (typeof event !== "string" || event.length === 0) {
    throw new TypeError("useEventReply requires a non-empty event name");
  }
}

function assertOptions<TReply, TData>(
  options: UseEventReplyOptions<TReply, TData>,
): number | undefined {
  if (options.reduce !== undefined && typeof options.reduce !== "function") {
    throw new TypeError("useEventReply reduce must be a function");
  }

  if (options.timeout === undefined) return undefined;
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new TypeError("useEventReply timeout must be a positive number");
  }

  return options.timeout;
}

function isPromiseLike<TValue>(value: unknown): value is PromiseLike<TValue> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function getInitialData<TReply, TData>(
  options: UseEventReplyOptions<TReply, TData>,
): TData {
  return (
    Object.hasOwn(options, "initialData") ? options.initialData : null
  ) as TData;
}

export function useEventReply<TReply, TData = TReply | null>(
  event: string,
  options: UseEventReplyOptions<TReply, TData> = {},
): UseEventReplyResult<TReply, TData> {
  assertEventName(event);
  const timeout = assertOptions(options);
  const { pushEvent } = useLiveReact();
  const initialDataRef = useRef<TData>(getInitialData(options));
  const [state, setState] = useState<ReplyState<TData>>(() => ({
    data: initialDataRef.current,
    error: null,
    isLoading: false,
  }));
  const activeRequestRef = useRef<ActiveRequest<TReply> | null>(null);
  const configRef = useRef<ReplyConfig<TReply, TData>>({
    event,
    pushEvent,
    reduce: options.reduce,
    timeout,
  });
  const dataRef = useRef(initialDataRef.current);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  useLayoutEffect(() => {
    configRef.current = {
      event,
      pushEvent,
      reduce: options.reduce,
      timeout,
    };
  }, [event, options.reduce, pushEvent, timeout]);

  const takeActiveRequest = useCallback(
    (requestId?: number): ActiveRequest<TReply> | null => {
      const activeRequest = activeRequestRef.current;
      if (activeRequest === null) return null;
      if (requestId !== undefined && activeRequest.id !== requestId) {
        return null;
      }

      activeRequestRef.current = null;
      if (activeRequest.timeoutId !== null) {
        clearTimeout(activeRequest.timeoutId);
      }

      return activeRequest;
    },
    [],
  );

  const cancelActiveRequest = useCallback(
    (reason: LiveEventReplyCancelledError, updateState: boolean): boolean => {
      const activeRequest = takeActiveRequest();
      if (activeRequest === null) return false;

      activeRequest.reject(reason);
      if (updateState && mountedRef.current) {
        setState((current) => ({
          ...current,
          error: reason,
          isLoading: false,
        }));
      }

      return true;
    },
    [takeActiveRequest],
  );

  const cancel = useCallback(() => {
    cancelActiveRequest(new LiveEventReplyCancelledError(), true);
  }, [cancelActiveRequest]);

  useLayoutEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancelActiveRequest(
        new LiveEventReplyCancelledError(
          "Live event reply was cancelled because the component unmounted",
        ),
        false,
      );
    };
  }, [cancelActiveRequest]);

  const execute = useCallback(
    (payload?: EventPayload): Promise<TReply> => {
      if (!mountedRef.current) {
        return Promise.reject(
          new LiveEventReplyCancelledError(
            "Cannot execute a live event reply after the component unmounted",
          ),
        );
      }

      cancelActiveRequest(new LiveEventReplyCancelledError(), false);
      const config = configRef.current;
      const requestId = ++requestIdRef.current;
      setState((current) => ({
        ...current,
        error: null,
        isLoading: true,
      }));

      return new Promise<TReply>((resolve, reject) => {
        const fail = (reason: unknown): void => {
          const activeRequest = takeActiveRequest(requestId);
          if (activeRequest === null) return;

          activeRequest.reject(reason);
          if (mountedRef.current) {
            setState((current) => ({
              ...current,
              error: reason,
              isLoading: false,
            }));
          }
        };
        const timeoutMs = config.timeout;
        const timeoutId =
          timeoutMs === undefined
            ? null
            : setTimeout(
                () =>
                  fail(new LiveEventReplyTimeoutError(config.event, timeoutMs)),
                timeoutMs,
              );

        activeRequestRef.current = {
          id: requestId,
          reject,
          resolve,
          timeoutId,
        };

        let pushResult: unknown;
        try {
          pushResult = config.pushEvent<TReply>(config.event, payload);
        } catch (reason: unknown) {
          fail(reason);
          return;
        }

        if (!isPromiseLike<TReply>(pushResult)) {
          fail(new TypeError("LiveView pushEvent must return a Promise"));
          return;
        }

        Promise.resolve(pushResult).then((reply) => {
          if (activeRequestRef.current?.id !== requestId) return;

          let nextData: TData;
          try {
            nextData = config.reduce
              ? config.reduce(dataRef.current, reply)
              : (reply as unknown as TData);
          } catch (reason: unknown) {
            fail(reason);
            return;
          }

          const activeRequest = takeActiveRequest(requestId);
          if (activeRequest === null) return;
          dataRef.current = nextData;
          if (mountedRef.current) {
            setState({
              data: nextData,
              error: null,
              isLoading: false,
            });
          }
          activeRequest.resolve(reply);
        }, fail);
      });
    },
    [cancelActiveRequest, takeActiveRequest],
  );

  return {
    cancel,
    data: state.data,
    error: state.error,
    execute,
    isLoading: state.isLoading,
  };
}
