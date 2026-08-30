import { createElement, StrictMode, useEffect, type ReactNode } from "react";

import { LiveViewReactProvider } from "./context";
import { ClientBridgeProvider } from "./runtime/client-bridge-context";
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
  readonly clientContext?: LiveViewReactContextValue | null;
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
  readonly onCommit?: () => void;
}

function HydrationCommit({ children, onCommit }: HydrationCommitProps) {
  useEffect(() => {
    onCommit?.();
  }, [onCommit]);
  return children;
}

export function createComponentTree({
  Component,
  children,
  clientContext = null,
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
  let builtInProviders: ReactNode = createElement(
    LiveViewConnectionProvider,
    { store: connectionStore },
    wrappedComponent,
  );
  if (clientContext !== null) {
    builtInProviders = createElement(
      ClientBridgeProvider,
      { value: clientContext },
      builtInProviders,
    );
  }
  builtInProviders = createElement(
    LiveViewReactProvider,
    { value: context },
    builtInProviders,
  );
  const stableTree = createElement(
    HydrationCommit,
    onHydrated ? { onCommit: onHydrated } : {},
    builtInProviders,
  );

  return strictMode ? createElement(StrictMode, null, stableTree) : stableTree;
}
