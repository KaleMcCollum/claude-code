"use client";

import { useState, useTransition } from "react";
import {
  archiveSectionAction,
  createSectionAction,
  moveSectionAction,
  renameSectionAction,
  reorderSectionsAction,
  restoreSectionAction,
} from "@/app/(app)/sections/actions";
import type { ActionResult } from "@/lib/actions";
import { ArrowDownIcon, ArrowUpIcon, GripIcon } from "./icons";

export type ManageItem = {
  id: string;
  number: string;
  title: string;
  depth: number;
  children: ManageItem[];
};

export type ArchivedItem = {
  id: string;
  title: string;
  detail: string;
};

type Props = { tree: ManageItem[]; archived: ArchivedItem[]; maxDepth: number; maxTitleLength: number };

type Open =
  | { kind: "rename"; id: string; value: string }
  | { kind: "add"; parentId: string | null; value: string }
  | { kind: "archive"; id: string }
  | null;

type Drop = { id: string; where: "before" | "after" } | null;

/** Owners' screen for changing the manual's structure. Nothing here deletes anything. */
export function SectionManager({ tree, archived, maxDepth, maxTitleLength }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startWork] = useTransition();
  const [dragging, setDragging] = useState<{ id: string; parentId: string | null } | null>(null);
  const [drop, setDrop] = useState<Drop>(null);

  const run = (work: () => Promise<ActionResult>, closeOnSuccess = true) => {
    startWork(async () => {
      const result = await work();
      if (result.ok) {
        setError(null);
        if (closeOnSuccess) setOpen(null);
      } else {
        setError(result.error);
      }
    });
  };

  const addForm = (parentId: string | null, value: string) => (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => createSectionAction(parentId, value));
      }}
    >
      <input
        className="input"
        value={value}
        maxLength={maxTitleLength}
        placeholder={parentId ? "Name of the new subsection" : "Name of the new section"}
        aria-label={parentId ? "Name of the new subsection" : "Name of the new section"}
        autoFocus
        onChange={(event) => setOpen({ kind: "add", parentId, value: event.target.value })}
      />
      <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
        Add
      </button>
      <button type="button" className="btn" onClick={() => setOpen(null)}>
        Cancel
      </button>
    </form>
  );

  const renderList = (items: ManageItem[], parentId: string | null) => (
    <ul>
      {items.map((item, index) => {
        const isRenaming = open?.kind === "rename" && open.id === item.id;
        const isArchiving = open?.kind === "archive" && open.id === item.id;
        const isAdding = open?.kind === "add" && open.parentId === item.id;
        const canDropHere = dragging !== null && dragging.parentId === parentId && dragging.id !== item.id;
        const dropClass = drop?.id === item.id && canDropHere ? ` drop-${drop.where}` : "";
        return (
          <li key={item.id}>
            <div
              className={`manage-row${dragging?.id === item.id ? " dragging" : ""}${dropClass}`}
              draggable={open === null && !busy}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                setDragging({ id: item.id, parentId });
              }}
              onDragEnd={() => {
                setDragging(null);
                setDrop(null);
              }}
              onDragOver={(event) => {
                if (!canDropHere) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const box = event.currentTarget.getBoundingClientRect();
                const where = event.clientY < box.top + box.height / 2 ? "before" : "after";
                if (drop?.id !== item.id || drop.where !== where) setDrop({ id: item.id, where });
              }}
              onDrop={(event) => {
                if (!canDropHere || !dragging) return;
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                const where = event.clientY < box.top + box.height / 2 ? "before" : "after";
                const ids = items.map((i) => i.id).filter((id) => id !== dragging.id);
                ids.splice(ids.indexOf(item.id) + (where === "after" ? 1 : 0), 0, dragging.id);
                setDragging(null);
                setDrop(null);
                run(() => reorderSectionsAction(parentId, ids));
              }}
            >
              <span className="grip" title="Drag to change the order" aria-hidden="true">
                <GripIcon size={16} />
              </span>
              <span className="title">
                <span className="num">{item.number}</span> {item.title}
              </span>
              <span className="actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${item.title} up`}
                  title="Move up"
                  disabled={busy || index === 0}
                  onClick={() => run(() => moveSectionAction(item.id, "up"))}
                >
                  <ArrowUpIcon size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${item.title} down`}
                  title="Move down"
                  disabled={busy || index === items.length - 1}
                  onClick={() => run(() => moveSectionAction(item.id, "down"))}
                >
                  <ArrowDownIcon size={16} />
                </button>
                <button
                  type="button"
                  className="btn-text"
                  aria-label={`Rename ${item.title}`}
                  onClick={() => setOpen({ kind: "rename", id: item.id, value: item.title })}
                >
                  Rename
                </button>
                {item.depth < maxDepth && (
                  <button
                    type="button"
                    className="btn-text"
                    aria-label={`Add a subsection under ${item.title}`}
                    onClick={() => setOpen({ kind: "add", parentId: item.id, value: "" })}
                  >
                    Add subsection
                  </button>
                )}
                <button
                  type="button"
                  className="btn-text danger"
                  aria-label={`Archive ${item.title}`}
                  onClick={() => setOpen({ kind: "archive", id: item.id })}
                >
                  Archive
                </button>
              </span>

              {isRenaming && open?.kind === "rename" && (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(() => renameSectionAction(item.id, open.value));
                  }}
                >
                  <input
                    className="input"
                    value={open.value}
                    maxLength={maxTitleLength}
                    aria-label={`New name for ${item.title}`}
                    autoFocus
                    onChange={(event) => setOpen({ kind: "rename", id: item.id, value: event.target.value })}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy || !open.value.trim()}>
                    Save name
                  </button>
                  <button type="button" className="btn" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </form>
              )}

              {isArchiving && (
                <div className="inline-form">
                  <span>
                    Archive &ldquo;{item.number} {item.title}&rdquo;
                    {item.children.length > 0 ? " and its subsections" : ""}? Nothing is deleted. You
                    can restore it at the bottom of this page.
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => run(() => archiveSectionAction(item.id))}
                  >
                    Archive section
                  </button>
                  <button type="button" className="btn" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {isAdding && open?.kind === "add" && addForm(item.id, open.value)}
            </div>
            {item.children.length > 0 && renderList(item.children, item.id)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <div className="manage-list">{renderList(tree, null)}</div>

      <div className="manage-add">
        {open?.kind === "add" && open.parentId === null ? (
          addForm(null, open.value)
        ) : (
          <button
            type="button"
            className="btn"
            style={{ margin: "10px 0" }}
            onClick={() => setOpen({ kind: "add", parentId: null, value: "" })}
          >
            Add section
          </button>
        )}
      </div>

      {archived.length > 0 && (
        <section className="block" aria-labelledby="archived-heading">
          <div className="block-head">
            <h2 id="archived-heading">Archived sections</h2>
          </div>
          <ul className="sublist">
            {archived.map((item) => (
              <li key={item.id} className="manage-row">
                <span className="title">
                  {item.title}
                  <span className="muted small"> {item.detail}</span>
                </span>
                <span className="actions">
                  <button
                    type="button"
                    className="btn-text"
                    aria-label={`Restore ${item.title}`}
                    disabled={busy}
                    onClick={() => run(() => restoreSectionAction(item.id))}
                  >
                    Restore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
