import { createElement, StrictMode, useEffect, type ReactNode } from "react";

import { LiveViewReactProvider } from "./context";
import { LiveViewConnectionProvider } from "./runtime/connection-context";
import type { ConnectionStore } from "./runtime/connection";
import type {
  ComponentProps,
  LiveViewReactComponent,
  LiveViewReactContextValue,
  LiveViewReactRootWrapper,
} from "./types";

export interface ComponentTreeOptions {
  readonly Component: LiveViewReactComponent;
  readonly children: readonly ReactNode[];
  readonly componentName?: string;
  readonly connectionStore: ConnectionStore;
  readonly context: LiveViewReactContextValue;
  readonly element?: HTMLElement | null;
  readonly onHydrated?: () => void;
  readonly props: ComponentProps;
  readonly strictMode?: boolean;
  readonly wrapRoot?: LiveViewReactRootWrapper;
}

interface HydrationCommitProps {
  readonly children?: ReactNode;
  readonly onCommit: () => void;
}

function HydrationCommit({ children, onCommit }: HydrationCommitProps) {
  useEffect(onCommit, [onCommit]);
  return children;
}

export function createComponentTree({
  Component,
  children,
  componentName = "Anonymous",
  connectionStore,
  context,
  element = null,
  onHydrated,
  props,
  strictMode = false,
  wrapRoot,
}: ComponentTreeOptions): ReactNode {
  const component = createElement(Component, props, ...children);
  const wrappedComponent = wrapRoot
    ? wrapRoot(
        Object.freeze({
          children: component,
          componentName,
          element,
        }),
      )
    : component;
  const builtInProviders = createElement(
    LiveViewReactProvider,
    { value: context },
    createElement(
      LiveViewConnectionProvider,
      { store: connectionStore },
      wrappedComponent,
    ),
  );
  const hydratingTree = onHydrated
    ? createElement(HydrationCommit, { onCommit: onHydrated }, builtInProviders)
    : builtInProviders;

  return strictMode
    ? createElement(StrictMode, null, hydratingTree)
    : hydratingTree;
}
