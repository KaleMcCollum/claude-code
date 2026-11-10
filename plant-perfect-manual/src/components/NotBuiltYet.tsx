/** Honest stand-in for pages that belong to a later build phase. */
export function NotBuiltYet({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <p className="notice">Not built yet. This page is part of {phase}.</p>
      <p className="muted">{children}</p>
    </>
  );
}
