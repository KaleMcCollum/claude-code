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
 *
 * A reworded sentence is one long crossed-out run followed by one long
 * underlined run, and on a phone such a run goes over several lines. Where
 * a line of it ends, the space there must not be crossed out or underlined
 * (it would look like a stray dash). The browser leaves that space out when
 * the run is laid out as ordinary text, so a run with nothing in it but
 * words and single spaces is ("run-plain"). A run with a line break, a tab,
 * two spaces in a row or any other kind of space keeps the layout that
 * shows every one of them exactly as typed.
 *
 * `touches`: it comes straight after another changed piece with no space
 * between them ("$13.00/hr." replaced by "$15.00/hr."), so it is given a
 * little air.
 */
function Changed({ kind, text, touches }: { kind: "added" | "removed"; text: string; touches: boolean }) {
  const Mark = kind === "added" ? "ins" : "del";
  const words = text.trim();
  if (words === "") return <Mark>{text}</Mark>;
  const start = text.indexOf(words);
  const plain = !/[^\S ]| {2}/.test(words);
  const look = [plain ? "run-plain" : "", touches && start === 0 ? "touching" : ""].filter(Boolean).join(" ");
  return (
    <>
      {text.slice(0, start)}
      <Mark className={look || undefined}>{words}</Mark>
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
        {comparison.parts.map((part, index) => {
          if (part.kind === "same") return <span key={index}>{part.text}</span>;
          const before = comparison.parts[index - 1];
          // Straight after another changed piece that does not end in a space or a line break.
          const touches = before !== undefined && before.kind !== "same" && !/\s$/.test(before.text);
          return <Changed key={index} kind={part.kind} text={part.text} touches={touches} />;
        })}
      </p>
      <p className="muted small diff-key">
        <del>Crossed out</del> was taken out. <ins>Underlined</ins> was added.
      </p>
    </div>
  );
}
