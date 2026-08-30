import { useEffect } from "react";
import { useLiveViewReact } from "liveview_react";
import { Toaster, toast } from "sonner";

export function FlashSonner({ flash }) {
  const { pushEvent } = useLiveViewReact();

  useEffect(() => {
    for (const kind of ["info", "error"]) {
      const message = flash[kind];
      if (!message) continue;

      toast[kind](message, {
        id: kind,
        duration: Infinity,
        richColors: true,
        closeButton: true,
        onDismiss: () => pushEvent("lv:clear-flash", { key: kind }),
      });
    }
  }, [flash, pushEvent]);

  return <Toaster />;
}
