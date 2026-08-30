import { useEffect } from "react";
import { useLiveViewReact } from "liveview_react";
import { Toaster, toast } from "sonner";

const FLASH_KINDS = ["info", "error"] as const;

type FlashKind = (typeof FLASH_KINDS)[number];

type FlashSonnerProps = {
  readonly flash: Readonly<Partial<Record<FlashKind, string | null>>>;
};

export function FlashSonner({ flash }: FlashSonnerProps) {
  const { pushEvent } = useLiveViewReact();

  useEffect(() => {
    for (const kind of FLASH_KINDS) {
      const message = flash[kind];
      if (!message) continue;

      toast[kind](message, {
        id: kind,
        duration: Infinity,
        richColors: true,
        closeButton: true,
        onDismiss: () => {
          void pushEvent("lv:clear-flash", { key: kind });
        },
      });
    }
  }, [flash, pushEvent]);

  return <Toaster />;
}
