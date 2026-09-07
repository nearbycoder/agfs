import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";

// Prefix every item to support a selectable empty filter without collisions.
// Required fields retain "" when unset so browser form validation still works.
const itemValue = (value: string | number) => `value:${value}`;
type SelectProps = Pick<
  ComponentProps<typeof SelectPrimitive.Trigger>,
  | "id"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "aria-invalid"
  | "className"
> & {
  value: string | number;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  children: ReactNode;
};
export function Select({
  value,
  onValueChange,
  disabled,
  required,
  placeholder = "Choose an option",
  children,
  className,
  ...triggerProps
}: SelectProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | undefined>();
  useEffect(() => {
    // A body portal would be inert behind the native mobile navigation dialog.
    setContainer(trigger.current?.closest("dialog") ?? undefined);
  }, []);
  return (
    <SelectPrimitive.Root
      value={required && value === "" ? "" : itemValue(value)}
      onValueChange={(next) =>
        onValueChange(next.startsWith("value:") ? next.slice(6) : "")
      }
      disabled={disabled}
      required={required}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        {...triggerProps}
        className={cn(
          "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm font-normal text-foreground shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 [&>span:first-child]:min-w-0 [&>span:first-child]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={container}>
        <SelectPrimitive.Content
          aria-label={triggerProps["aria-label"]}
          aria-labelledby={triggerProps["aria-labelledby"]}
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-40 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center bg-popover text-muted-foreground">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {children}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center bg-popover text-muted-foreground">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
export function SelectItem({
  value,
  children,
  disabled,
}: {
  value: string | number;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Item
      value={itemValue(value)}
      disabled={disabled}
      className="relative flex min-h-9 cursor-pointer select-none items-center rounded-md py-2 pr-8 pl-3 text-sm leading-5 break-words outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
export function SelectGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <SelectPrimitive.Group>
      <SelectPrimitive.Label className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </SelectPrimitive.Label>
      {children}
    </SelectPrimitive.Group>
  );
}
