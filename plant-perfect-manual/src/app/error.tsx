"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="login">
      <h1>Something went wrong</h1>
      <p className="muted">
        The page could not be shown. Nothing you saved has been lost. Try again, and if it keeps
        happening, tell whoever maintains the app what you were doing.
      </p>
      <p>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
      </p>
    </main>
  );
}
