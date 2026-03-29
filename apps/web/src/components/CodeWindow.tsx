import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function CodeWindow(props: { children: ReactNode; className?: string; title: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-[0_1px_2px_rgba(15,23,42,0.08),0_24px_64px_rgba(15,23,42,0.18)]",
        props.className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-zinc-800/90 px-5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-zinc-600" />
          <span className="size-2 rounded-full bg-zinc-700" />
          <span className="size-2 rounded-full bg-zinc-800" />
        </div>
        <strong className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">{props.title}</strong>
      </div>
      <pre className="overflow-x-auto p-5 text-sm leading-6 text-zinc-200">{props.children}</pre>
    </div>
  );
}
