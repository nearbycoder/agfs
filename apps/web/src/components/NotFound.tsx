import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="status-screen">
      <div className="status-card">
        <p className="eyebrow">Route missing</p>
        <h1>Nothing lives at this address.</h1>
        <p>Jump back to the AGFS control plane and keep moving.</p>
        <Link className="button button-primary" to="/">
          Return home
        </Link>
      </div>
    </main>
  );
}
