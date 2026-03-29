import type { ReactNode } from "react";

export function CodeWindow(props: { children: ReactNode; title: string }) {
  return (
    <div className="code-window">
      <div className="code-window__chrome">
        <span />
        <span />
        <span />
        <strong>{props.title}</strong>
      </div>
      <pre>{props.children}</pre>
    </div>
  );
}
