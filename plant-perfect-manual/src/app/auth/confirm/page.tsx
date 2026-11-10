import type { Metadata } from "next";
import { ConfirmForm } from "./ConfirmForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  return (
    <main className="login">
      {value ? (
        <ConfirmForm token={value} />
      ) : (
        <div>
          <h1>This link no longer works</h1>
          <p>
            <a className="btn btn-primary" href="/login">
              Get a new link
            </a>
          </p>
        </div>
      )}
    </main>
  );
}
