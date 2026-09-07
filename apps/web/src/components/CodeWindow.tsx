import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { cn } from "~/lib/utils";
export function CodeWindow(props: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    if (typeof props.children !== "string") return;
    try {
      await navigator.clipboard.writeText(props.children);
      setCopied(true);
      setError(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(true);
    }
  }
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-[#12201b] text-zinc-100 shadow-lg shadow-black/10",
        props.className,
      )}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/10 px-5 py-2">
        <strong className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Terminal className="size-3.5 shrink-0" />
          {props.title}
        </strong>
        {typeof props.children === "string" ? (
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={"Copy " + props.title}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            {copied ? (
              <Check className="size-4 text-emerald-300" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>
      <pre className="overflow-x-auto p-5 text-xs leading-7 text-zinc-200 sm:text-sm">
        {props.children}
      </pre>
      <span
        role="status"
        className={error ? "block px-5 pb-3 text-xs text-amber-200" : "sr-only"}
      >
        {error
          ? "Copy failed. Select and copy the commands manually."
          : copied
            ? "Copied to clipboard"
            : ""}
      </span>
    </div>
  );
}
