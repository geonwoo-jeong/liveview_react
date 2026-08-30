import { useId, useState, useTransition } from "react";

import { useSampleRootName } from "./root-options";

export function React19Capabilities() {
  const inputId = useId();
  const rootName = useSampleRootName();
  const [value, setValue] = useState(0);
  const [isPending, startTransition] = useTransition();

  return (
    <div
      data-testid="sample-react19-capabilities"
      className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950"
    >
      <p>
        StrictMode root wrapper: <strong>{rootName}</strong>
      </p>
      <label htmlFor={inputId} className="block font-medium">
        Hydration-stable useId
      </label>
      <input
        id={inputId}
        readOnly
        value={inputId}
        className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2"
      />
      <button
        type="button"
        className="rounded-lg bg-violet-700 px-3 py-2 font-medium text-white"
        onClick={() =>
          startTransition(() => setValue((current) => current + 1))
        }
      >
        React transition: {isPending ? "pending" : value}
      </button>
    </div>
  );
}
