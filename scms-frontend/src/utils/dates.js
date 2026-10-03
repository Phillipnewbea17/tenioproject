// Date helpers shared by the Senior IDs, Funds, Help Desk and Reports pages.
// Dates from the API are "YYYY-MM-DD" strings or ISO timestamps.

/** Today's local date as "YYYY-MM-DD" (the format of <input type="date">). */
export function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** True for a real calendar date in "YYYY-MM-DD" form. */
export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

// Plain dates are read at noon so a timezone offset can't move them a day.
function toDate(value) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T12:00:00` : value);
}

/** "Oct 3, 2026", or the fallback when the value is empty or invalid. */
export function formatDate(value, fallback = "—") {
  const date = toDate(value);
  return !value || Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 3, 2026, 2:15 PM", or the fallback when the value is empty or invalid. */
export function formatDateTime(value, fallback = "—") {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
