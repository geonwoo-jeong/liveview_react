export const TRANSPORT_VERSION = 2 as const;

export type TransportKind = "patch" | "snapshot";
export type StreamTransportKind = "hydration" | TransportKind;

export class UnsupportedTransportVersionError extends Error {
  constructor(actualVersion: string | null) {
    super(
      `data-liveview-react-version must be "${String(TRANSPORT_VERSION)}", received ${JSON.stringify(actualVersion)}`,
    );
    this.name = "UnsupportedTransportVersionError";
  }
}

export function assertTransportVersion(element: HTMLElement): void {
  const version = element.getAttribute("data-liveview-react-version");
  if (version !== String(TRANSPORT_VERSION)) {
    throw new UnsupportedTransportVersionError(version);
  }
}

export function readPropsTransportKind(element: HTMLElement): TransportKind {
  const attributeName = "data-props-kind";
  const kind = element.getAttribute(attributeName);
  if (kind === "patch" || kind === "snapshot") return kind;

  throw new Error(`${attributeName} must be either "snapshot" or "patch"`);
}

export function readStreamsTransportKind(
  element: HTMLElement,
): StreamTransportKind {
  const attributeName = "data-streams-kind";
  const kind = element.getAttribute(attributeName);
  if (kind === "hydration" || kind === "patch" || kind === "snapshot") {
    return kind;
  }

  throw new Error(
    `${attributeName} must be "hydration", "snapshot", or "patch"`,
  );
}

export function isFullSnapshotFrame(element: HTMLElement): boolean {
  return (
    element.getAttribute("data-props-kind") === "snapshot" &&
    element.getAttribute("data-streams-kind") === "snapshot"
  );
}
