import { flushSync } from "react-dom";
import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Disclosure, DisclosureSummary } from "./disclosure";
import { cn } from "~/lib/utils";

/** Keep optional controls available without competing with the main task. */
export function AdvancedSettings({
  children,
  summary,
  title = "Advanced settings",
  className,
}: {
  children: ReactNode;
  summary: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [revealInvalid, setRevealInvalid] = useState(false);
  return (
    <Disclosure
      className={cn("advanced-settings", className)}
      open={open}
      data-invalid-reveal={revealInvalid || undefined}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) setRevealInvalid(false);
      }}
      onInvalidCapture={(event) => {
        // A collapsed optional field may still need correction before submit.
        const field = event.target;
        flushSync(() => {
          setRevealInvalid(true);
          setOpen(true);
        });
        if (field instanceof HTMLElement) field.focus();
      }}
    >
      <DisclosureSummary>
        <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
            {summary}
          </span>
        </span>
      </DisclosureSummary>
      {children}
    </Disclosure>
  );
}
