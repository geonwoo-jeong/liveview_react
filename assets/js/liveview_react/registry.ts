import type {
  ComponentRegistry,
  ComponentRegistryEntry,
  LiveViewReactComponent,
} from "./types";

function isComponent(value: unknown): value is LiveViewReactComponent {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;

  const reactType = (value as Record<string, unknown>).$$typeof;
  return (
    reactType === Symbol.for("react.forward_ref") ||
    reactType === Symbol.for("react.lazy") ||
    reactType === Symbol.for("react.memo")
  );
}

function validateEntry(
  componentName: string,
  entry: unknown,
): ComponentRegistryEntry {
  if (typeof entry !== "object" || entry === null) {
    throw new TypeError(
      `Component "${componentName}" must use a tagged { component } or { load } registry entry`,
    );
  }

  const candidate = entry as Record<string, unknown>;
  const hasComponent = Object.hasOwn(candidate, "component");
  const hasLoader = Object.hasOwn(candidate, "load");

  if (hasComponent === hasLoader) {
    throw new TypeError(
      `Component "${componentName}" must define exactly one of { component } or { load }`,
    );
  }

  if (hasComponent && !isComponent(candidate.component)) {
    throw new TypeError(
      `Component "${componentName}" has an invalid component value`,
    );
  }

  if (hasLoader && typeof candidate.load !== "function") {
    throw new TypeError(`Component "${componentName}" has an invalid loader`);
  }

  return entry as ComponentRegistryEntry;
}

export function normalizeRegistry(
  registry: ComponentRegistry,
): ComponentRegistry {
  if (typeof registry !== "object" || registry === null) {
    throw new TypeError("components must be a registry object");
  }

  const entries = Object.entries(registry).map(([componentName, entry]) => {
    if (componentName.length === 0) {
      throw new TypeError("Component registry names must not be empty");
    }

    const validatedEntry = validateEntry(componentName, entry);
    return [componentName, Object.freeze({ ...validatedEntry })] as const;
  });

  return Object.freeze(Object.fromEntries(entries));
}

export function getRegistryEntry(
  registry: ComponentRegistry,
  componentName: string,
): ComponentRegistryEntry {
  if (!Object.hasOwn(registry, componentName)) {
    throw new Error(`Component "${componentName}" is not registered`);
  }

  return validateEntry(componentName, registry[componentName]);
}

export function getEagerComponent(
  entry: ComponentRegistryEntry,
): LiveViewReactComponent | null {
  return "component" in entry && entry.component ? entry.component : null;
}

export async function loadComponent(
  componentName: string,
  entry: ComponentRegistryEntry,
): Promise<LiveViewReactComponent> {
  const eagerComponent = getEagerComponent(entry);
  if (eagerComponent) return eagerComponent;
  if (!("load" in entry) || typeof entry.load !== "function") {
    throw new TypeError(
      `Component "${componentName}" is missing a lazy loader`,
    );
  }

  const loaded = await entry.load();
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    !isComponent(loaded.default)
  ) {
    throw new TypeError(
      `Loader for component "${componentName}" must resolve to { default: Component }`,
    );
  }

  return loaded.default;
}
