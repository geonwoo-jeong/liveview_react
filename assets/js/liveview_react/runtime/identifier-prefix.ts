export function createIdentifierPrefix(rootId: string): string {
  if (typeof rootId !== "string" || rootId.length === 0) {
    throw new TypeError("React root id must be a non-empty string");
  }

  return `liveview-react-${rootId}-`;
}
