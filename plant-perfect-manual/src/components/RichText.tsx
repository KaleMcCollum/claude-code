import type { ReactNode } from "react";
import { type RichDoc, type RichNode, safeHref } from "@/lib/richtext";

/**
 * Shows a saved rich text document. Each kind of block is drawn by this code
 * (no raw HTML is ever inserted), and the words are shown exactly as stored.
 */
export function RichText({ doc }: { doc: RichDoc }) {
  // The editor always leaves an empty line after a table or list so the
  // cursor has somewhere to go. Nobody typed it, so it is not shown.
  // (The saved document itself is left untouched.)
  // (Anything that is not a document is shown as empty rather than breaking the page.)
  const blocks = Array.isArray(doc?.content) ? doc.content.filter((node) => node && typeof node === "object") : [];
  let end = blocks.length;
  while (end > 0 && blocks[end - 1].type === "paragraph" && !blocks[end - 1].content?.length) {
    end -= 1;
  }
  return <div className="rich">{renderChildren(blocks.slice(0, end))}</div>;
}

function renderChildren(nodes: RichNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, index) => renderNode(node, index));
}

function renderText(node: RichNode, key: number): ReactNode {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "underline") out = <u>{out}</u>;
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      if (href) {
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {out}
          </a>
        );
      }
    }
  }
  return <span key={key}>{out}</span>;
}

function span(value: unknown): number | undefined {
  return typeof value === "number" && value > 1 ? value : undefined;
}

function renderNode(node: RichNode, key: number): ReactNode {
  const children = () => renderChildren(node.content);
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "hardBreak":
      return <br key={key} />;
    case "paragraph":
      // An empty paragraph (a blank line, an empty table cell) keeps its height.
      return <p key={key}>{node.content?.length ? children() : <br />}</p>;
    case "heading": {
      // The page already uses h1 (section name) and h2 (Official / Discussion).
      const level = node.attrs?.level === 3 ? 3 : node.attrs?.level === 1 ? 1 : 2;
      return level === 3 ? (
        <h4 key={key} className="rt-h3">
          {children()}
        </h4>
      ) : (
        <h3 key={key} className={`rt-h${level}`}>
          {children()}
        </h3>
      );
    }
    case "bulletList":
      return <ul key={key}>{children()}</ul>;
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return (
        <ol key={key} start={start}>
          {children()}
        </ol>
      );
    }
    case "listItem":
      return <li key={key}>{children()}</li>;
    case "taskList":
      return (
        <ul key={key} className="tasks">
          {children()}
        </ul>
      );
    case "taskItem":
      return (
        <li key={key}>
          <input type="checkbox" checked={node.attrs?.checked === true} disabled readOnly />
          <div>{children()}</div>
        </li>
      );
    case "table":
      return (
        <div key={key} className="table-wrap">
          <table>
            <tbody>{children()}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{children()}</tr>;
    case "tableHeader":
      return (
        <th key={key} colSpan={span(node.attrs?.colspan)} rowSpan={span(node.attrs?.rowspan)}>
          {children()}
        </th>
      );
    case "tableCell":
      return (
        <td key={key} colSpan={span(node.attrs?.colspan)} rowSpan={span(node.attrs?.rowspan)}>
          {children()}
        </td>
      );
    default:
      return null;
  }
}
