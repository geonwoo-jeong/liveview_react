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
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new TypeError(
      `Component "${componentName}" must use a tagged { component } or { load } registry entry`,
    );
  }

  const prototype = Object.getPrototypeOf(entry);
  const keys = Reflect.ownKeys(entry);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 1 ||
    (keys[0] !== "component" && keys[0] !== "load")
  ) {
    throw new TypeError(
      `Component "${componentName}" must use a tagged { component } or { load } registry entry with no extra keys`,
    );
  }

  const key = keys[0];
  const descriptor = Object.getOwnPropertyDescriptor(entry, key);
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    throw new TypeError(
      `Component "${componentName}" must use an enumerable tagged data property`,
    );
  }

  if (key === "component" && !isComponent(descriptor.value)) {
    throw new TypeError(
      `Component "${componentName}" has an invalid component value`,
    );
  }

  if (key === "load" && typeof descriptor.value !== "function") {
    throw new TypeError(`Component "${componentName}" has an invalid loader`);
  }

  return entry as ComponentRegistryEntry;
}

function readRegistryEntries(registry: unknown): readonly [string, unknown][] {
  if (
    typeof registry !== "object" ||
    registry === null ||
    Array.isArray(registry)
  ) {
    throw new TypeError("components must be a plain registry object");
  }

  const prototype = Object.getPrototypeOf(registry);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("components must be a plain registry object");
  }

  return Reflect.ownKeys(registry).map((key) => {
    if (typeof key !== "string") {
      throw new TypeError("Component registry keys must be enumerable strings");
    }

    const descriptor = Object.getOwnPropertyDescriptor(registry, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(
        "Component registry keys must be enumerable data properties",
      );
    }

    return [key, descriptor.value] as const;
  });
}

export function normalizeRegistry(
  registry: ComponentRegistry,
): ComponentRegistry {
  const entries = readRegistryEntries(registry).map(
    ([componentName, entry]) => {
      if (componentName.length === 0) {
        throw new TypeError("Component registry names must not be empty");
      }

      const validatedEntry = validateEntry(componentName, entry);
      return [componentName, Object.freeze({ ...validatedEntry })] as const;
    },
  );

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
