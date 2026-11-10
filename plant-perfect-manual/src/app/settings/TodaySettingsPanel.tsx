"use client";

import { useState, useTransition } from "react";
import { saveSettingsAction } from "./actions";

type Props = { openingDate: string; staleDays: number };

/** The two settings that drive the Today page. Owners only. */
export function TodaySettingsPanel({ openingDate, staleDays }: Props) {
  const [form, setForm] = useState({ openingDate, staleDays: String(staleDays) });
  const [busy, startWork] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startWork(async () => {
          const result = await saveSettingsAction(form);
          setError(result.ok ? null : result.error);
          setMessage(result.ok ? (result.message ?? "Saved.") : null);
        });
      }}
    >
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
      <div className="form-grid">
        <label className="field">
          <span>Opening date</span>
          <input
            className="input"
            type="date"
            name="openingDate"
            value={form.openingDate}
            required
            onChange={(event) => setForm({ ...form, openingDate: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Days before a section counts as stale</span>
          <input
            className="input"
            type="number"
            name="staleDays"
            inputMode="numeric"
            min={1}
            max={365}
            step={1}
            value={form.staleDays}
            required
            onChange={(event) => setForm({ ...form, staleDays: event.target.value })}
          />
        </label>
        <div />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Saving" : "Save"}
      </button>
      <p className="muted small" style={{ maxWidth: 720, marginTop: 10 }}>
        The opening date sets the countdown on the Today page. Sections that have not been updated
        for this many days are listed there as stale.
      </p>
    </form>
  );
}
