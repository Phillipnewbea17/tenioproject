import { useEffect, useState } from "react";
import {
  FiActivity,
  FiAlertCircle,
  FiChevronLeft,
  FiChevronRight,
  FiEye,
  FiLock,
  FiRefreshCw,
  FiSearch,
} from "react-icons/fi";
import { getActivityLogOptions, getActivityLogs } from "../services/api";
import ModalDialog from "../components/ModalDialog";
import "./ActivityLog.css";

const EMPTY_FILTERS = { search: "", user: "", module: "", action: "", from: "", to: "" };

// Badge tone from the action name. The text is always shown, so color is
// only a secondary cue.
function actionTone(action) {
  const value = action.toLowerCase();
  if (/(delet|reject|fail|blocked|deactivat)/.test(value)) return "danger";
  if (/(creat|issued|approved|published|released|activated|restored|reactivated|logged in)/.test(value)) return "success";
  if (/(status|replac|role|password|archived)/.test(value)) return "warning";
  return "neutral";
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? { date: "—", time: "" }
    : {
        date: date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
        time: date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" }),
      };
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function fieldLabel(field) {
  const text = field.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ActionBadge({ action }) {
  return <span className={`al-badge al-badge--${actionTone(action)}`}>{action}</span>;
}

export default function ActivityLog() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [options, setOptions] = useState({ modules: [], actions: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const rangeError = filters.from && filters.to && filters.from > filters.to
    ? "The start date must be on or before the end date."
    : "";

  useEffect(() => {
    let cancelled = false;
    getActivityLogOptions()
      .then((result) => { if (!cancelled) setOptions(result); })
      .catch(() => { /* Dropdowns stay at "All"; the list shows any error. */ });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Search waits until typing pauses.
  useEffect(() => {
    if (searchInput === filters.search) return undefined;
    const timer = setTimeout(() => {
      setLoading(true);
      setPage(1);
      setFilters((current) => ({ ...current, search: searchInput.trim() }));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search]);

  useEffect(() => {
    if (rangeError) return undefined;
    let cancelled = false;

    getActivityLogs(filters, page)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        setMeta(result.meta);
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || "Failed to load the activity log.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filters, page, rangeError, reloadKey]);

  function updateFilter(name, value) {
    setLoading(true);
    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function goToPage(next) {
    setLoading(true);
    setPage(next);
  }

  function resetFilters() {
    setSearchInput("");
    setLoading(true);
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }

  function refresh() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  const hasFilters = Object.values(filters).some(Boolean) || Boolean(searchInput);
  const total = meta?.total ?? 0;
  const firstRow = total ? (meta.current_page - 1) * meta.per_page + 1 : 0;
  const lastRow = total ? Math.min(meta.current_page * meta.per_page, total) : 0;

  return <section className="scms-al" aria-labelledby="al-page-title">
    <header className="al-page-header">
      <div>
        <p className="al-eyebrow">Activity Log / Audit Trail</p>
        <h1 id="al-page-title">Activity Log</h1>
        <p className="al-subtitle">Important actions are recorded automatically with who did them and when.</p>
      </div>
      <button className="al-button al-button--secondary" type="button" onClick={refresh} disabled={loading}>
        <FiRefreshCw aria-hidden="true" /> Refresh
      </button>
    </header>

    <p className="al-readonly"><FiLock aria-hidden="true" /> This log is read-only. Entries cannot be edited or deleted.</p>

    <section className="al-filters" aria-label="Activity log filters">
      <div className="al-filter al-filter--search">
        <label htmlFor="al-search">Search</label>
        <div className="al-search-box">
          <FiSearch aria-hidden="true" />
          <input id="al-search" type="search" placeholder="Search staff, record or details…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </div>
      </div>
      <div className="al-filter">
        <label htmlFor="al-user">Staff / user</label>
        <select id="al-user" value={filters.user} onChange={(event) => updateFilter("user", event.target.value)}>
          <option value="">All staff</option>
          {options.users.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="al-filter">
        <label htmlFor="al-module">Module</label>
        <select id="al-module" value={filters.module} onChange={(event) => updateFilter("module", event.target.value)}>
          <option value="">All modules</option>
          {options.modules.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="al-filter">
        <label htmlFor="al-action">Action</label>
        <select id="al-action" value={filters.action} onChange={(event) => updateFilter("action", event.target.value)}>
          <option value="">All actions</option>
          {options.actions.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="al-filter al-filter--date">
        <label htmlFor="al-from">From</label>
        <input id="al-from" type="date" value={filters.from} max={filters.to || undefined} aria-invalid={Boolean(rangeError)} onChange={(event) => updateFilter("from", event.target.value)} />
      </div>
      <div className="al-filter al-filter--date">
        <label htmlFor="al-to">To</label>
        <input id="al-to" type="date" value={filters.to} min={filters.from || undefined} aria-invalid={Boolean(rangeError)} onChange={(event) => updateFilter("to", event.target.value)} />
      </div>
      {hasFilters && <button className="al-text-button" type="button" onClick={resetFilters}>Clear filters</button>}
    </section>
    {rangeError && <p className="al-field-error" role="alert">{rangeError}</p>}

    {error && <div className="al-message al-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="al-text-button" type="button" onClick={refresh}>Try again</button>
    </div>}

    <section className={`al-panel${loading && meta ? " is-refreshing" : ""}`} aria-busy={loading} aria-label="Activity log entries">
      {!meta && loading ? <div className="al-empty"><FiActivity aria-hidden="true" /><p>Loading activity…</p></div>
      : entries.length === 0 ? <div className="al-empty">
        <FiActivity aria-hidden="true" />
        <h3>{hasFilters ? "No matching activity" : "No activity recorded yet"}</h3>
        <p>{hasFilters ? "Try other filters or a wider date range." : "Actions like logins, approvals and record changes will appear here."}</p>
      </div>
      : <div className="al-table-wrap">
        <table className="al-table">
          <caption className="al-sr-only">Activity log entries, newest first.</caption>
          <thead><tr>
            <th scope="col">Date &amp; time</th>
            <th scope="col">Staff / user</th>
            <th scope="col">Action</th>
            <th scope="col">Module</th>
            <th scope="col">Affected record</th>
            <th scope="col" className="al-actions-heading"><span className="al-sr-only">Details</span></th>
          </tr></thead>
          <tbody>{entries.map((entry) => {
            const when = formatDateTime(entry.createdAt);
            return <tr key={entry.id}>
              <td data-label="When"><div className="al-stack"><span>{when.date}</span><small>{when.time}</small></div></td>
              <td data-label="Staff"><div className="al-stack"><span>{entry.userName || "Unknown"}</span>{entry.role && <small>{entry.role}</small>}</div></td>
              <td data-label="Action"><ActionBadge action={entry.action} /></td>
              <td data-label="Module"><span>{entry.module}</span></td>
              <td data-label="Record"><div className="al-stack"><span className="al-record">{entry.recordLabel || "—"}</span>{entry.description && <small className="al-description">{entry.description}</small>}</div></td>
              <td className="al-actions-cell">
                <button className="al-row-button" type="button" aria-label={`View details of ${entry.action} by ${entry.userName || "unknown user"}`} onClick={() => setSelected(entry)}>
                  <FiEye aria-hidden="true" /> Details
                </button>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>}

      <footer className="al-footer">
        <p aria-live="polite">{total ? `Showing ${firstRow.toLocaleString("en-PH")}–${lastRow.toLocaleString("en-PH")} of ${total.toLocaleString("en-PH")} entries` : ""}</p>
        {meta && meta.last_page > 1 && <nav className="al-pagination" aria-label="Activity log pages">
          <button className="al-icon-button" type="button" aria-label="Newer entries" disabled={meta.current_page === 1 || loading} onClick={() => goToPage(meta.current_page - 1)}><FiChevronLeft aria-hidden="true" /></button>
          <span>Page {meta.current_page} of {meta.last_page}</span>
          <button className="al-icon-button" type="button" aria-label="Older entries" disabled={meta.current_page === meta.last_page || loading} onClick={() => goToPage(meta.current_page + 1)}><FiChevronRight aria-hidden="true" /></button>
        </nav>}
      </footer>
    </section>

    {selected && <DetailDialog entry={selected} onClose={() => setSelected(null)} />}
  </section>;
}

function DetailDialog({ entry, onClose }) {
  const when = formatDateTime(entry.createdAt);
  const changes = Object.entries(entry.changes);

  return <ModalDialog prefix="al" title={`Log entry #${entry.id}`} subtitle={`${when.date} at ${when.time}`} onClose={onClose}>
      <div className="al-dialog-body">
        <dl className="al-details">
          <div><dt>Action</dt><dd><ActionBadge action={entry.action} /></dd></div>
          <div><dt>Module</dt><dd>{entry.module}</dd></div>
          <div><dt>Staff / user</dt><dd>{entry.userName || "Unknown"}</dd></div>
          <div><dt>Role</dt><dd>{entry.role || "—"}</dd></div>
          <div className="al-details-wide"><dt>Affected record</dt><dd>{entry.recordLabel || "—"}{entry.recordType && <small> ({entry.recordType}{entry.recordId ? ` #${entry.recordId}` : ""})</small>}</dd></div>
          <div className="al-details-wide"><dt>Details</dt><dd>{entry.description || "—"}</dd></div>
          <div><dt>IP address</dt><dd>{entry.ipAddress || "—"}</dd></div>
        </dl>

        <h3 className="al-section-title">Changes</h3>
        {changes.length === 0 ? <p className="al-muted">No field changes were recorded for this action.</p>
        : <div className="al-table-wrap al-table-wrap--changes">
          <table className="al-table al-table--changes">
            <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{changes.map(([field, value]) => <tr key={field}>
              <th scope="row">{fieldLabel(field)}</th>
              <td className="al-before">{formatValue(value?.from)}</td>
              <td className="al-after">{formatValue(value?.to)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
      <footer className="al-dialog-footer">
        <button className="al-button al-button--secondary" type="button" onClick={onClose}>Close</button>
      </footer>
  </ModalDialog>;
}
