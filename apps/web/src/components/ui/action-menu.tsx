import * as Menu from "@radix-ui/react-dropdown-menu";
import { Ellipsis } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button";
import { cn } from "~/lib/utils";

export function ActionMenu({
  label,
  children,
  disabled,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
        >
          <Ellipsis className="size-4" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          sideOffset={6}
          align="end"
          collisionPadding={12}
          className="action-menu z-50 min-w-44 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{
            maxHeight: "var(--radix-dropdown-menu-content-available-height)",
          }}
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function ActionMenuItem({
  className,
  ...props
}: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex min-h-10 w-full cursor-default items-center justify-start gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
