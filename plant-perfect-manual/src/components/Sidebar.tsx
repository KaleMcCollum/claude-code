"use client";

import Form from "next/form";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/login/actions";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, MenuIcon, PlusIcon, SearchIcon } from "./icons";

export type TreeItem = { id: string; number: string; title: string; children: TreeItem[] };

type Props = {
  tree: TreeItem[];
  userName: string;
  /** Proposals waiting for approval, shown as a plain number after "Proposals". */
  proposalsWaiting: number;
  canWriteNotes: boolean;
  canManageSections: boolean;
  canOpenSettings: boolean;
};

const PAGES = [
  { href: "/", label: "Today" },
  { href: "/daily-log", label: "Daily Log" },
  { href: "/proposals", label: "Proposals" },
  { href: "/todo", label: "To-do" },
  { href: "/documents", label: "Documents" },
];

/** A small dot on the link that was just pressed, while its page loads. */
function PendingDot() {
  const { pending } = useLinkStatus();
  return pending ? <span className="pending-dot" aria-hidden="true" /> : null;
}

function NavLink({
  href,
  current,
  children,
  onClick,
  ariaLabel,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  /** A fuller name for screen readers, when the words on the link are not enough. */
  ariaLabel?: string;
}) {
  return (
    <Link
      className="nav-link"
      href={href}
      aria-current={current ? "page" : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
      <PendingDot />
    </Link>
  );
}

function idsOnPath(tree: TreeItem[], id: string): string[] {
  for (const item of tree) {
    if (item.id === id) return [item.id];
    const below = idsOnPath(item.children, id);
    if (below.length > 0) return [item.id, ...below];
  }
  return [];
}

/**
 * The one navigation for the whole app. It is the same on every page; only
 * the main area changes. On phones it slides in from the Menu button.
 */
export function Sidebar({
  tree,
  userName,
  proposalsWaiting,
  canWriteNotes,
  canManageSections,
  canOpenSettings,
}: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Sections the user opened or closed by hand. Others follow the current page.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const sectionMatch = pathname.match(/^\/sections\/([0-9a-f-]{36})/i);
  const currentSectionId = sectionMatch ? sectionMatch[1] : null;
  const openPath = currentSectionId ? idsOnPath(tree, currentSectionId) : [];
  const isOpen = (id: string) => toggled[id] ?? openPath.includes(id);
  const closeMenu = () => setMenuOpen(false);

  const renderTree = (items: TreeItem[]) => (
    <ul>
      {items.map((item) => {
        const hasChildren = item.children.length > 0;
        const open = hasChildren && isOpen(item.id);
        return (
          <li key={item.id}>
            <div className="tree-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} subsections of ${item.title}`}
                  onClick={() => setToggled((t) => ({ ...t, [item.id]: !open }))}
                >
                  {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                </button>
              ) : (
                <span className="tree-spacer" />
              )}
              <NavLink
                href={`/sections/${item.id}`}
                current={item.id === currentSectionId}
                onClick={() => {
                  if (hasChildren) setToggled((t) => ({ ...t, [item.id]: true }));
                  closeMenu();
                }}
              >
                <span className="num">{item.number}</span>
                <span>{item.title}</span>
              </NavLink>
            </div>
            {open && renderTree(item.children)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon size={22} />
        </button>
        <Link href="/" className="topbar-title">
          Plant Perfect Fargo
        </Link>
        {canWriteNotes && (
          <Link href="/daily-log/today?new=1" className="icon-btn" aria-label="New note">
            <PlusIcon size={22} />
          </Link>
        )}
      </header>

      <nav
        className={`sidebar${menuOpen ? " open" : ""}`}
        aria-label="Main"
        onKeyDown={(event) => {
          if (event.key === "Escape") closeMenu();
        }}
      >
        <div className="sidebar-head">
          <Link href="/" className="brand" onClick={closeMenu}>
            Plant Perfect Fargo
            <span>Operations Manual</span>
          </Link>
          <button type="button" className="icon-btn sidebar-close" aria-label="Close menu" onClick={closeMenu}>
            <CloseIcon size={20} />
          </button>
        </div>

        {canWriteNotes && (
          <Link href="/daily-log/today?new=1" className="btn btn-primary new-note" onClick={closeMenu}>
            <PlusIcon size={16} /> New note
          </Link>
        )}

        <Form action="/search" className="search-form" role="search" onSubmit={closeMenu}>
          <SearchIcon size={16} />
          <input className="input" type="search" name="q" placeholder="Search" aria-label="Search" />
        </Form>

        <div className="sidebar-scroll">
        <ul className="nav">
          {PAGES.map((page) => {
            const waiting = page.href === "/proposals" ? proposalsWaiting : 0;
            return (
              <li key={page.href}>
                <NavLink
                  href={page.href}
                  current={page.href === "/" ? pathname === "/" : pathname.startsWith(page.href)}
                  onClick={closeMenu}
                  ariaLabel={waiting > 0 ? `${page.label}, ${waiting} waiting` : undefined}
                >
                  {page.label}
                  {waiting > 0 && <span className="nav-count">{waiting}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="nav-heading">
          <span>Manual sections</span>
          {canManageSections && (
            <Link href="/sections/manage" onClick={closeMenu}>
              Edit
            </Link>
          )}
        </div>
        <div className="tree">{renderTree(tree)}</div>
        </div>

        <div className="sidebar-foot">
          {canOpenSettings && (
            <NavLink href={`/settings?from=${encodeURIComponent(pathname)}`} current={false} onClick={closeMenu}>
              Settings
            </NavLink>
          )}
          <div className="whoami">
            <span>Signed in as {userName}</span>
            <form action={signOutAction}>
              <button type="submit" className="btn-text">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
      <button
        type="button"
        className={`backdrop${menuOpen ? " open" : ""}`}
        aria-label="Close menu"
        tabIndex={-1}
        onClick={closeMenu}
      />
    </>
  );
}
