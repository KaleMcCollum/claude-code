import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login">
      <h1>Page not found</h1>
      <p className="muted">
        That page does not exist, or the section was archived. Nothing has been lost.
      </p>
      <p>
        <Link className="btn btn-primary" href="/">
          Go to Today
        </Link>
      </p>
    </main>
  );
}
