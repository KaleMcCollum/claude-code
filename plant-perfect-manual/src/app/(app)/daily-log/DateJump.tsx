"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isDateKey } from "@/lib/time";

/**
 * "Go to a date": a date field and a Go button. Nothing happens while the
 * date is still being picked; the page changes only when Go is pressed.
 */
export function DateJump({ today }: { today: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="date-jump"
      // The checks below answer in plain words, in place.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!isDateKey(value)) {
          setError("Choose a date first.");
        } else if (value > today) {
          setError("That day has not happened yet. Choose today or an earlier date.");
        } else {
          setError(null);
          router.push(`/daily-log/${value}`);
        }
      }}
    >
      <label className="field">
        <span>Go to a date</span>
        <input
          className="input"
          type="date"
          name="date"
          max={today}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
      </label>
      <button type="submit" className="btn">
        Go
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
