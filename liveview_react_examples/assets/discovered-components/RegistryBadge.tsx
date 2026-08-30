import { useSampleRootName } from "../react-components/root-options";

export default function RegistryBadge({
  message,
}: {
  readonly message: string;
}) {
  const rootName = useSampleRootName();

  return (
    <div
      data-testid="sample-registry-badge"
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
    >
      <p className="font-semibold">{message}</p>
      <p className="mt-1 text-emerald-700">Root wrapper: {rootName}</p>
    </div>
  );
}
