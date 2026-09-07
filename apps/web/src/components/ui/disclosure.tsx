import { Children, useState, type ComponentProps } from "react";
import { cn } from "~/lib/utils";

/** Native keyboard semantics, consistent layout, and optional mount-on-first-open.
 * Once visited, content stays mounted to retain form state and navigation guards. */
export function Disclosure({
  children,
  className,
  defaultOpen = false,
  lazy = false,
  open: controlledOpen,
  onToggle,
  ...props
}: ComponentProps<"details"> & { defaultOpen?: boolean; lazy?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [visited, setVisited] = useState(defaultOpen || !!controlledOpen);
  const [summary, ...content] = Children.toArray(children);
  return (
    <details
      {...props}
      open={controlledOpen ?? open}
      className={cn("disclosure", className)}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) setVisited(true);
        onToggle?.(event);
      }}
    >
      {summary}
      <div className="disclosure-body">
        {!lazy || visited || controlledOpen ? content : null}
      </div>
    </details>
  );
}
export function DisclosureSummary({
  className,
  ...props
}: ComponentProps<"summary">) {
  return <summary className={cn("disclosure-summary", className)} {...props} />;
}
