import { createElement, type ReactNode } from "react";

import { LiveViewReactProvider } from "./context";
import type {
  ComponentProps,
  LiveViewReactComponent,
  LiveViewReactContextValue,
} from "./types";

interface ComponentTreeOptions {
  readonly Component: LiveViewReactComponent;
  readonly props: ComponentProps;
  readonly children: readonly ReactNode[];
  readonly context: LiveViewReactContextValue;
}

export function createComponentTree({
  Component,
  props,
  children,
  context,
}: ComponentTreeOptions): ReactNode {
  const component = createElement(Component, props, ...children);

  return createElement(LiveViewReactProvider, { value: context }, component);
}
