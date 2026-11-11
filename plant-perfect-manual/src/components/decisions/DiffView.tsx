import { RichText } from "@/components/RichText";
import { compareDocs } from "@/lib/diff";
import type { RichDoc } from "@/lib/richtext";

type Props = {
  /** The text before the change (null when there was none). */
  before: RichDoc | null;
  after: RichDoc;
  /** Said when nothing differs at all. */
  sameMessage: string;
  /** Headings for the two full texts, used when they are too long to compare word by word. */
  beforeHeading?: string;
  afterHeading?: string;
};

/**
 * What changed between two versions of official text, word by word, in
 * reading order: words taken out are crossed out in gray, words added are
 * underlined. Used on a proposal's page and in version history, so both
 * always show a change the same way.
 */
export function DiffView({
  before,
  after,
  sameMessage,
  beforeHeading = "Before",
  afterHeading = "After",
}: Props) {
  const comparison = compareDocs(before, after);

  if (comparison.kind === "same") return <p className="diff-note">{sameMessage}</p>;
  if (comparison.kind === "formatting") {
    return <p className="diff-note">Only the formatting or layout changed.</p>;
  }
  if (comparison.kind === "tooLong") {
    return (
      <div className="diff-full">
        <p className="muted small">
          These texts are too long to mark every changed word, so both are shown in full.
        </p>
        <h3>{beforeHeading}</h3>
        {before ? <RichText doc={before} /> : <p className="muted">There was no official text.</p>}
        <h3>{afterHeading}</h3>
        <RichText doc={after} />
      </div>
    );
  }

  return (
    <div className="diff-box">
      <p className="diff">
        {comparison.parts.map((part, index) =>
          part.kind === "removed" ? (
            <del key={index}>{part.text}</del>
          ) : part.kind === "added" ? (
            <ins key={index}>{part.text}</ins>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      <p className="muted small diff-key">
        <del>Crossed out</del> was taken out. <ins>Underlined</ins> was added.
      </p>
    </div>
  );
}
