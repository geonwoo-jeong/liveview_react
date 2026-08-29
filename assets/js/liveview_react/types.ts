import type { ComponentType, ExoticComponent } from "react";

export type EventPayload = Readonly<Record<string, unknown>>;

export type EventReplyHandler<TReply = unknown> = (
  reply: TReply,
  reference?: unknown,
) => void;

export type PushEvent = <TReply = unknown>(
  event: string,
  payload?: EventPayload,
  onReply?: EventReplyHandler<TReply>,
) => unknown;

export type PushEventTo = <TReply = unknown>(
  target: string | HTMLElement,
  event: string,
  payload?: EventPayload,
  onReply?: EventReplyHandler<TReply>,
) => unknown;

export type HandleEvent = <TPayload = unknown>(
  event: string,
  callback: (payload: TPayload) => void,
) => unknown;

export type RemoveHandleEvent = (callbackReference: unknown) => void;

export type UploadFiles = FileList | readonly File[];

export type Upload = (name: string, files: UploadFiles) => void;

export type UploadTo = (
  target: string | HTMLElement,
  name: string,
  files: UploadFiles,
) => void;

export interface LiveViewReactContextValue {
  readonly el: HTMLElement | null;
  readonly liveSocket: unknown;
  readonly pushEvent: PushEvent;
  readonly pushEventTo: PushEventTo;
  readonly handleEvent: HandleEvent;
  readonly removeHandleEvent: RemoveHandleEvent;
  readonly upload: Upload;
  readonly uploadTo: UploadTo;
}

export type LiveViewReactComponent = ComponentType<any> | ExoticComponent<any>;

export interface EagerComponentEntry {
  readonly component: LiveViewReactComponent;
  readonly load?: never;
}

export interface LazyComponentModule {
  readonly default: LiveViewReactComponent;
}

export interface LazyComponentEntry {
  readonly component?: never;
  readonly load: () => Promise<LazyComponentModule>;
}

export type ComponentRegistryEntry = EagerComponentEntry | LazyComponentEntry;

export type ComponentRegistry = Readonly<
  Record<string, ComponentRegistryEntry>
>;

export type ComponentProps = Readonly<Record<string, unknown>>;
export type SlotMap = Readonly<Record<string, string>>;
