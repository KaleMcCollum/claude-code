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
  /**
   * Where the whole new text can be read on this page. Said when the words
   * are the same but a link now points somewhere else, which the
   * word-by-word display cannot show.
   */
  whereToLook?: string;
};

/**
 * One changed piece of the word-by-word display. A piece that has words in
 * it is marked without the spaces and line breaks at its start and end (an
 * added sentence should not underline the space before it). A piece that is
 * nothing but spaces or line breaks is marked as it is, or it could not be
 * seen at all.
 */
function Changed({ kind, text }: { kind: "added" | "removed"; text: string }) {
  const Mark = kind === "added" ? "ins" : "del";
  const words = text.trim();
  if (words === "") return <Mark>{text}</Mark>;
  const start = text.indexOf(words);
  return (
    <>
      {text.slice(0, start)}
      <Mark>{words}</Mark>
      {text.slice(start + words.length)}
    </>
  );
}

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
  whereToLook = "Open the full proposed text to see it.",
}: Props) {
  const comparison = compareDocs(before, after);

  if (comparison.kind === "same") return <p className="diff-note">{sameMessage}</p>;
  if (comparison.kind === "formatting") {
    // The same words in the same order. A link that points somewhere else,
    // or a checkbox that is now ticked, is more than layout, so it is said.
    const { links, checks } = comparison;
    return (
      <p className="diff-note">
        {links && checks
          ? `The words are the same. A link's address was changed, and a checkbox was ticked or unticked. ${whereToLook}`
          : links
            ? `The words are the same. A link's address was changed. ${whereToLook}`
            : checks
              ? "The words are the same. A checkbox was ticked or unticked."
              : "Only the formatting or layout changed."}
      </p>
    );
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
          part.kind === "same" ? (
            <span key={index}>{part.text}</span>
          ) : (
            <Changed key={index} kind={part.kind} text={part.text} />
          ),
        )}
      </p>
      <p className="muted small diff-key">
        <del>Crossed out</del> was taken out. <ins>Underlined</ins> was added.
      </p>
    </div>
  );
}
