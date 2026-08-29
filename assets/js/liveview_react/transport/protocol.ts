export const TRANSPORT_VERSION = "1";

export type TransportKind = "patch" | "snapshot";

export class UnsupportedTransportVersionError extends Error {
  constructor(actualVersion: string | null) {
    super(
      `data-liveview-react-version must be "${TRANSPORT_VERSION}", received ${JSON.stringify(actualVersion)}`,
    );
    this.name = "UnsupportedTransportVersionError";
  }
}

export function assertTransportVersion(element: HTMLElement): void {
  const version = element.getAttribute("data-liveview-react-version");
  if (version !== TRANSPORT_VERSION) {
    throw new UnsupportedTransportVersionError(version);
  }
}

export function readTransportKind(
  element: HTMLElement,
  attributeName: "data-props-kind" | "data-streams-kind",
): TransportKind {
  const kind = element.getAttribute(attributeName);
  if (kind === "patch" || kind === "snapshot") return kind;

  throw new Error(`${attributeName} must be either "snapshot" or "patch"`);
}

export function isFullSnapshotFrame(element: HTMLElement): boolean {
  return (
    element.getAttribute("data-props-kind") === "snapshot" &&
    element.getAttribute("data-streams-kind") === "snapshot"
  );
}
