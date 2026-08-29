import type { ComponentType, ExoticComponent, ReactNode } from "react";
import type { RootOptions } from "react-dom/client";

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonArray = readonly JsonValue[];
export type JsonValue =
  null | boolean | number | string | JsonArray | JsonObject;

export type EventPayload = Readonly<Record<string, unknown>>;

export type PushEvent = <TReply = unknown>(
  event: string,
  payload?: EventPayload,
) => Promise<TReply>;

export type LiveViewTarget = string | number | HTMLElement;

export interface TargetedEventReply<TReply = unknown> {
  readonly ref: number;
  readonly reply: TReply;
}

export type PushEventTo = <TReply = unknown>(
  target: LiveViewTarget,
  event: string,
  payload?: EventPayload,
) => Promise<readonly PromiseSettledResult<TargetedEventReply<TReply>>[]>;

export type HandleEvent = <TPayload = unknown>(
  event: string,
  callback: (payload: TPayload) => void,
) => unknown;

export type RemoveHandleEvent = (callbackReference: unknown) => void;

export type UploadFiles = FileList | readonly File[];

export type Upload = (name: string, files: UploadFiles) => void;

export type UploadTo = (
  target: LiveViewTarget,
  name: string,
  files: UploadFiles,
) => void;

export interface LiveUploadEntry {
  readonly ref: string;
  readonly cancelled: boolean;
  readonly client_last_modified: number;
  readonly client_name: string;
  readonly client_relative_path: string;
  readonly client_size: number;
  readonly client_type: string;
  readonly progress: number;
  readonly done: boolean;
  readonly valid: boolean;
  readonly preflighted: boolean;
  readonly errors: readonly unknown[];
}

export interface LiveUploadError {
  readonly ref: string;
  readonly error: unknown;
}

export interface LiveUploadConfig {
  readonly ref: string;
  readonly name: string;
  readonly accept: "any" | readonly string[];
  readonly max_entries: number;
  readonly max_entries_mode: "selected" | "total";
  readonly max_file_size: number;
  readonly auto_upload: boolean;
  readonly entries: readonly LiveUploadEntry[];
  readonly errors: readonly LiveUploadError[];
}

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

export interface LiveViewReactRootWrapperContext {
  readonly children: ReactNode;
  readonly componentName: string;
  readonly element: HTMLElement | null;
}

export type LiveViewReactRootWrapper = (
  context: LiveViewReactRootWrapperContext,
) => ReactNode;

export interface LiveViewReactRootOptions {
  readonly onCaughtError?: NonNullable<RootOptions["onCaughtError"]>;
  readonly onRecoverableError?: NonNullable<RootOptions["onRecoverableError"]>;
  readonly onUncaughtError?: NonNullable<RootOptions["onUncaughtError"]>;
  readonly strictMode?: boolean;
  readonly wrapRoot?: LiveViewReactRootWrapper;
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
