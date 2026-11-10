"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { addUserAction, changeRoleAction, removeUserAction } from "./actions";

export type UserView = {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  added: string;
  lastActive: string;
  isYou: boolean;
};

type Props = { users: UserView[]; roles: { key: string; name: string }[] };

export function UsersPanel({ users, roles }: Props) {
  const [busy, startWork] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const defaultRole = roles.find((role) => role.key === "advisor")?.key ?? roles[0]?.key ?? "";
  const [form, setForm] = useState({ name: "", email: "", roleKey: defaultRole });

  const run = (work: () => Promise<ActionResult>, onSuccess?: () => void) => {
    startWork(async () => {
      const result = await work();
      if (result.ok) {
        setError(null);
        setMessage(result.message ?? null);
        onSuccess?.();
      } else {
        setMessage(null);
        setError(result.error);
      }
    });
  };

  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <table className="records">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Added</th>
            <th scope="col">Last active</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <strong>{user.name}</strong>
                {user.isYou && <span className="muted"> (you)</span>}
              </td>
              <td data-label="Email">{user.email}</td>
              <td data-label="Role">
                <select
                  className="select"
                  aria-label={`Role for ${user.name}`}
                  value={user.roleKey}
                  disabled={busy}
                  onChange={(event) => run(() => changeRoleAction(user.id, event.target.value))}
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </td>
              <td data-label="Added">{user.added}</td>
              <td data-label="Last active">{user.lastActive}</td>
              <td>
                {removing === user.id ? (
                  <span className="row">
                    <span>Remove {user.name}?</span>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => run(() => removeUserAction(user.id), () => setRemoving(null))}
                    >
                      Yes, remove
                    </button>
                    <button type="button" className="btn" onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  !user.isYou && (
                    <button
                      type="button"
                      className="btn-text danger"
                      aria-label={`Remove ${user.name}`}
                      onClick={() => setRemoving(user.id)}
                    >
                      Remove
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ margin: "28px 0 10px", fontSize: 16 }}>Add user</h3>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => addUserAction(form),
            () => setForm({ name: "", email: "", roleKey: defaultRole }),
          );
        }}
      >
        <label className="field">
          <span>Name or nickname</span>
          <input
            className="input"
            name="name"
            value={form.name}
            maxLength={80}
            autoComplete="off"
            required
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            name="email"
            value={form.email}
            autoComplete="off"
            autoCapitalize="none"
            required
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select
            className="select"
            name="role"
            value={form.roleKey}
            onChange={(event) => setForm({ ...form, roleKey: event.target.value })}
          >
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Working" : "Create user"}
          </button>
        </div>
      </form>
      <p className="muted small" style={{ maxWidth: 720 }}>
        The new user gets an email invitation with a sign-in link. There are no passwords. Owners
        can do everything. Advisors can read, comment and endorse, but cannot edit, approve or open
        Settings.
      </p>
    </>
  );
}
