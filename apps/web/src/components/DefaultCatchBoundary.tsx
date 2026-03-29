export function DefaultCatchBoundary(props: { error: Error }) {
  return (
    <main className="status-screen">
      <div className="status-card">
        <p className="eyebrow">System fault</p>
        <h1>{props.error.message}</h1>
        <p>The request did not complete cleanly. Refresh the page or inspect the server logs.</p>
      </div>
    </main>
  );
}
