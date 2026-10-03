import { useEffect, useMemo, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiCreditCard,
  FiEdit2,
  FiEye,
  FiPlus,
  FiPrinter,
  FiRefreshCw,
  FiSearch,
  FiSlash,
  FiX,
} from "react-icons/fi";
import ModalDialog from "../components/ModalDialog";
import useSubmit from "../hooks/useSubmit";
import { formatDate, formatDateTime, isISODate, todayISO } from "../utils/dates";
import { useSearchParams } from "react-router-dom";
import scmsLogo from "../assets/scms-logo.png";
import "./SeniorIds.css";
import {
  getSeniorCitizens,
  getSeniorIds,
  getSeniorId,
  issueSeniorId,
  activateSeniorId,
  updateSeniorId,
  requestSeniorIdReplacement,
  replaceSeniorId,
  deactivateSeniorId,
  isAdministrator,
} from "../services/api";

// Local/LGU ID only. This must not be presented as the national Digital
// Senior Citizens ID, so the card and page say "Local ID" explicitly.
const LOCALITY = "Los Angeles, Ubay, Bohol";
const PAGE_SIZE = 8;

const STATUS_INFO = {
  "Pending Issuance": { tone: "pending", description: "ID number assigned; the card has not been released yet." },
  Active: { tone: "active", description: "Valid ID currently held by the senior." },
  "For Replacement": { tone: "replace", description: "Senior asked for a new card; waiting to be processed." },
  Inactive: { tone: "inactive", description: "No longer valid (replaced or deactivated)." },
};

// Mirrors SeniorIdController: these count as the senior's current ID.
const CURRENT_STATUSES = ["Pending Issuance", "Active", "For Replacement"];
const INELIGIBLE_SENIOR_STATUSES = ["Archived", "Inactive", "Deceased"];
const REPLACEMENT_REASONS = ["Lost", "Damaged", "Incorrect Information", "Other"];

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function address(purok) {
  return purok ? `${purok}, ${LOCALITY}` : LOCALITY;
}

function StatusBadge({ status }) {
  const tone = STATUS_INFO[status]?.tone || "inactive";
  return <span className={`sid-status sid-status--${tone}`}><span aria-hidden="true" />{status}</span>;
}

function Field({ name, label, required = false, error, wide = false, hint, children }) {
  return <div className={`sid-field${wide ? " sid-field--wide" : ""}`}>
    <label htmlFor={`sid-${name}`}>
      {label}{required ? <span className="sid-required" aria-hidden="true"> *</span> : <span className="sid-optional"> (optional)</span>}
    </label>
    {children}
    {hint && <span className="sid-field-hint">{hint}</span>}
    {error && <span id={`sid-${name}-error`} className="sid-field-error">{error}</span>}
  </div>;
}

function Detail({ label, children }) {
  return <div className="sid-detail"><dt>{label}</dt><dd>{children || "Not recorded"}</dd></div>;
}

export default function SeniorIds() {
  const [ids, setIds] = useState([]);
  const [seniors, setSeniors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [modal, setModal] = useState(() => {
    const issue = Number(searchParams.get("issue"));
    const view = Number(searchParams.get("view"));
    if (issue) return { mode: "issue", seniorCitizenId: issue };
    if (view) return { mode: "view-id", id: view };
    return null;
  });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (searchParams.has("issue") || searchParams.has("view")) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getSeniorIds(), getSeniorCitizens()])
      .then(([idRows, seniorRows]) => {
        if (cancelled) return;
        setIds(idRows);
        setSeniors(seniorRows);
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || "Failed to load OSCA IDs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reloadKey]);

  function load() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  // Registered seniors who can still be issued an ID.
  const eligibleSeniors = useMemo(() => {
    const withCurrentId = new Set(
      ids.filter((id) => CURRENT_STATUSES.includes(id.status)).map((id) => id.senior.id)
    );
    return seniors
      .filter((senior) => !withCurrentId.has(senior.id) && !INELIGIBLE_SENIOR_STATUSES.includes(senior.status))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ids, seniors]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ids.filter((id) =>
      (!query || [id.idNumber, id.senior.name, id.senior.seniorId, id.senior.purok]
        .some((value) => value.toLowerCase().includes(query))) &&
      (status === "All" || id.status === status)
    );
  }, [ids, search, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const hasFilters = Boolean(search.trim() || status !== "All");
  const countOf = (value) => ids.filter((id) => id.status === value).length;
  const stats = [
    { label: "Active IDs", value: countOf("Active"), icon: FiCreditCard, tone: "active" },
    { label: "Pending issuance", value: countOf("Pending Issuance"), icon: FiClock, tone: "pending" },
    { label: "For replacement", value: countOf("For Replacement"), icon: FiRefreshCw, tone: "replace" },
    { label: "Inactive", value: countOf("Inactive"), icon: FiSlash, tone: "inactive" },
  ];

  function resetFilters() {
    setSearch(""); setStatus("All"); setPage(1);
  }

  // Keep the list in sync with records returned by an action.
  function applySaved(...saved) {
    setIds((current) => {
      const byId = new Map(current.map((row) => [row.id, row]));
      saved.forEach((row) => byId.set(row.id, row));
      return [...byId.values()].sort((a, b) => b.id - a.id);
    });
  }

  async function runAction(action, record, form) {
    let shown;
    let message;

    if (action === "issue") {
      shown = await issueSeniorId(form);
      applySaved(shown);
      message = `${shown.idNumber} issued to ${shown.senior.name}.`;
    } else if (action === "activate") {
      shown = await activateSeniorId(record.id, form.dateIssued);
      applySaved(shown);
      message = `${shown.idNumber} is now active.`;
    } else if (action === "edit") {
      shown = await updateSeniorId(record.id, form);
      applySaved(shown);
      message = `${shown.idNumber} updated.`;
    } else if (action === "request-replacement") {
      shown = await requestSeniorIdReplacement(record.id, form);
      applySaved(shown);
      message = `Replacement requested for ${shown.idNumber}.`;
    } else if (action === "replace") {
      const { previous, replacement } = await replaceSeniorId(record.id, form);
      applySaved(previous, replacement);
      shown = replacement;
      message = `${previous.idNumber} was deactivated and replaced by ${replacement.idNumber}.`;
    } else if (action === "deactivate") {
      shown = await deactivateSeniorId(record.id, form.remarks);
      applySaved(shown);
      message = `${shown.idNumber} deactivated.`;
    }

    setNotice(message);
    setModal({ mode: "view", record: shown });
  }

  function openAction(mode, record) {
    setModal({ mode, record });
  }

  return <section className="scms-sid" aria-labelledby="sid-page-title">
    <header className="sid-page-header">
      <div>
        <p className="sid-eyebrow">OSCA ID Management</p>
        <h1 id="sid-page-title">OSCA IDs</h1>
        <p className="sid-subtitle">
          Issue, replace and track Office of Senior Citizens Affairs (OSCA) IDs for seniors of {LOCALITY}.
        </p>
      </div>
      <button className="sid-button sid-button--primary" type="button" disabled={loading || Boolean(error)} onClick={() => setModal({ mode: "issue" })}>
        <FiPlus aria-hidden="true" /> Issue ID
      </button>
    </header>

    {error && <div className="sid-message sid-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="sid-text-button" type="button" onClick={load}>Try again</button>
    </div>}
    {notice && <div className="sid-message sid-message--success" role="status">
      <FiCheckCircle aria-hidden="true" /><span>{notice}</span>
      <button className="sid-icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><FiX aria-hidden="true" /></button>
    </div>}

    <div className="sid-stats" aria-label="OSCA ID summary">
      {stats.map(({ label, value, icon: Icon, tone }) => <div className="sid-stat" key={label}>
        <span className={`sid-stat-icon sid-stat-icon--${tone}`}><Icon aria-hidden="true" /></span>
        <div><span className="sid-stat-label">{label}</span><strong className="sid-stat-value">{loading || error ? "—" : value}</strong></div>
      </div>)}
    </div>

    {!loading && !error && eligibleSeniors.length > 0 && <div className="sid-callout">
      <FiCreditCard aria-hidden="true" />
      <span><strong>{eligibleSeniors.length}</strong> registered {eligibleSeniors.length === 1 ? "senior does" : "seniors do"} not have an ID yet.</span>
      <button className="sid-text-button" type="button" onClick={() => setModal({ mode: "issue" })}>Issue an ID</button>
    </div>}

    <section className="sid-panel" aria-labelledby="sid-list-title">
      <div className="sid-panel-heading">
        <div><h2 id="sid-list-title">ID records</h2><p>Every issued, replaced and deactivated ID is kept here.</p></div>
      </div>
      <div className="sid-toolbar">
        <div className="sid-search-group">
          <label htmlFor="sid-search">Search IDs</label>
          <div className="sid-search-box">
            <FiSearch aria-hidden="true" />
            <input id="sid-search" type="search" placeholder="Search by ID number or senior name…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="sid-filter">
          <label htmlFor="sid-status-filter">Status</label>
          <select id="sid-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="All">All statuses</option>{Object.keys(STATUS_INFO).map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        {hasFilters && <button className="sid-text-button sid-reset" type="button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {loading ? <div className="sid-empty"><span className="sid-empty-icon"><FiClock aria-hidden="true" /></span><h3>Loading IDs…</h3></div>
      : error ? <div className="sid-empty"><FiAlertCircle aria-hidden="true" /><h3>IDs are unavailable</h3><p>Resolve the message above to view ID records.</p></div>
      : filtered.length === 0 ? <div className="sid-empty">
        <span className="sid-empty-icon">{hasFilters ? <FiSearch aria-hidden="true" /> : <FiCreditCard aria-hidden="true" />}</span>
        <h3>{hasFilters ? "No matching IDs" : "No IDs issued yet"}</h3>
        <p>{hasFilters ? "Try another ID number or name, or adjust the filter." : "Issue the first ID to an approved senior to start tracking."}</p>
        <button className="sid-button sid-button--secondary" type="button" onClick={hasFilters ? resetFilters : () => setModal({ mode: "issue" })}>
          {hasFilters ? "Clear filters" : <><FiPlus aria-hidden="true" /> Issue first ID</>}
        </button>
      </div>
      : <div className="sid-table-wrap">
        <table className="sid-table">
          <caption className="sid-sr-only">OSCA ID records. Use View to open the ID card and its history.</caption>
          <thead><tr><th scope="col">Senior</th><th scope="col">ID number</th><th scope="col">Purok</th><th scope="col">Date issued</th><th scope="col">Status</th><th scope="col" className="sid-actions-heading">Actions</th></tr></thead>
          <tbody>{visible.map((record) => <tr key={record.id}>
            <td className="sid-person-cell"><div className="sid-person">
              <span className="sid-avatar" aria-hidden="true">{initials(record.senior.name)}</span>
              <div><strong>{record.senior.name}</strong><span>Record {record.senior.seniorId || "—"}</span></div>
            </div></td>
            <td data-label="ID number"><span className="sid-id-number">{record.idNumber}</span></td>
            <td data-label="Purok"><span>{record.senior.purok || "—"}</span></td>
            <td data-label="Issued"><span className="sid-date">{record.dateIssued ? formatDate(record.dateIssued) : "Not yet"}</span></td>
            <td data-label="Status"><StatusBadge status={record.status} /></td>
            <td className="sid-actions-cell"><div className="sid-row-actions">
              <button className="sid-row-button" type="button" aria-label={`View ID ${record.idNumber} for ${record.senior.name}`} onClick={() => setModal({ mode: "view", record })}><FiEye aria-hidden="true" /> View</button>
              {record.status === "Pending Issuance" && <button className="sid-row-button" type="button" onClick={() => openAction("activate", record)}><FiCheck aria-hidden="true" /> Mark issued</button>}
              {record.status === "Active" && <button className="sid-row-button" type="button" onClick={() => openAction("request-replacement", record)}><FiRefreshCw aria-hidden="true" /> Walk-in replacement</button>}
              {record.status === "For Replacement" && <button className="sid-row-button" type="button" onClick={() => openAction("replace", record)}><FiRefreshCw aria-hidden="true" /> Process</button>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}

      <footer className="sid-table-footer">
        <p aria-live="polite">{loading || error ? "" : filtered.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} IDs` : "0 IDs"}</p>
        {totalPages > 1 && <nav className="sid-pagination" aria-label="OSCA ID pages">
          <button className="sid-icon-button" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft aria-hidden="true" /></button>
          <span>Page {currentPage} of {totalPages}</span>
          <button className="sid-icon-button" type="button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><FiChevronRight aria-hidden="true" /></button>
        </nav>}
      </footer>
    </section>

    {modal?.mode === "view" && <ViewDialog key={`view-${modal.record.id}`} record={modal.record} allIds={ids}
      onClose={() => setModal(null)} onAction={openAction} />}
    {modal?.mode === "view-id" && !loading && ids.some((id) => id.id === modal.id) && <ViewDialog key={`view-${modal.id}`}
      record={ids.find((id) => id.id === modal.id)} allIds={ids}
      onClose={() => setModal(null)} onAction={openAction} />}
    {modal?.mode === "issue" && !loading && <IssueDialog seniors={eligibleSeniors} initialSeniorId={modal.seniorCitizenId}
      onClose={() => setModal(null)} onSave={(form) => runAction("issue", null, form)} />}
    {modal && !["view", "view-id", "issue"].includes(modal.mode) && <ActionDialog key={`${modal.mode}-${modal.record.id}`} mode={modal.mode} record={modal.record}
      onClose={() => setModal({ mode: "view", record: modal.record })} onSave={(form) => runAction(modal.mode, modal.record, form)} />}
  </section>;
}

// MM/DD/YYYY, as printed on OSCA cards.
function cardDate(value) {
  if (!isISODate(value)) return "—";
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

// Age on the date of issue (today while the card is still pending).
function ageOn(birthDate, onDate, fallback) {
  if (!isISODate(birthDate) || !isISODate(onDate)) return fallback ?? null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

// Cards that are not valid get a stamp so they can't pass as active.
// Longer text gets a smaller size class so it stays on one line.
function fitClass(text, long, veryLong) {
  const length = (text || "").length;
  return length > veryLong ? "is-very-long" : length > long ? "is-long" : undefined;
}

const CARD_STAMP = { "Pending Issuance": "Pending issuance", "For Replacement": "For replacement", Inactive: "Inactive" };

/** OSCA ID card, laid out like the printed Office of Senior Citizens Affairs card. */
function DigitalIdCard({ record }) {
  const { senior } = record;
  const sex = /^f/i.test(senior.gender) ? "F" : /^m/i.test(senior.gender) ? "M" : "—";
  const age = ageOn(senior.birthDate, record.dateIssued || todayISO(), senior.age);
  const stamp = CARD_STAMP[record.status];

  return <figure className="sid-card" aria-label={`OSCA ID card ${record.idNumber} for ${senior.name}${stamp ? `, ${stamp.toLowerCase()}` : ""}`}>
    <img className="sid-card-watermark" src={scmsLogo} alt="" aria-hidden="true" />
    <header className="sid-card-head">
      <img className="sid-card-seal" src={scmsLogo} alt="" aria-hidden="true" />
      <div className="sid-card-office">
        <span>Republic of the Philippines</span>
        <span>Province of Bohol</span>
        <strong className="sid-card-osca">Office of Senior Citizens Affairs</strong>
        <strong className="sid-card-lgu">MUNICIPALITY OF UBAY</strong>
      </div>
    </header>
    <div className="sid-card-photo" aria-hidden="true"><span>{initials(senior.name)}</span><small>Photo</small></div>
    <dl className="sid-card-lines">
      <div className="sid-card-line sid-card-line--name"><dt>Name :</dt><dd className={fitClass(senior.name, 22, 30)}>{senior.name}</dd></div>
      <div className="sid-card-line"><dt>Address:</dt><dd className={fitClass(address(senior.purok), 30, 40)}>{address(senior.purok)}</dd></div>
    </dl>
    <dl className="sid-card-facts">
      <div><dt>Date of Birth</dt><dd>{cardDate(senior.birthDate)}</dd></div>
      <div><dt>Age</dt><dd>{age ?? "—"}</dd></div>
      <div><dt>Sex</dt><dd>{sex}</dd></div>
      <div><dt>Date of Issue</dt><dd>{record.dateIssued ? cardDate(record.dateIssued) : "—"}</dd></div>
    </dl>
    <div className="sid-card-bottom">
      <span className="sid-card-idno">ID No. {record.idNumber}</span>
      <div className="sid-card-sign"><strong className={fitClass(senior.name, 24, 24)}>{senior.name}</strong><span>Printed Name and Signature/Thumbmark</span></div>
    </div>
    <p className="sid-card-foot">This card is non-transferable and valid anywhere in the country</p>
    {stamp && <span className="sid-card-stamp">{stamp}</span>}
  </figure>;
}

/** Print only the card, at real ID size (see the print rules in SeniorIds.css). */
function printCard() {
  const cleanup = () => document.body.classList.remove("sid-printing");
  document.body.classList.add("sid-printing");
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}

function ViewDialog({ record: initial, allIds, onClose, onAction }) {
  const [record, setRecord] = useState(initial);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");

  // ID History covers every ID this senior has held, not only this one.
  useEffect(() => {
    let cancelled = false;
    const related = allIds.filter((id) => id.senior.id === initial.senior.id);
    const targets = related.some((id) => id.id === initial.id) ? related : [initial, ...related];

    Promise.all(targets.map((id) => getSeniorId(id.id)))
      .then((details) => {
        if (cancelled) return;
        const self = details.find((detail) => detail.id === initial.id);
        if (self) setRecord(self);
        setHistory(details
          .flatMap((detail) => detail.history.map((entry) => ({ ...entry, idNumber: detail.idNumber })))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id - a.id));
      })
      .catch((error) => { if (!cancelled) setHistoryError(error.message || "Failed to load ID history."); });

    return () => { cancelled = true; };
  }, [initial, allIds]);

  const { senior } = record;
  const isCurrent = CURRENT_STATUSES.includes(record.status);
  // Edit and Deactivate are administrator-only (the server checks too).
  const admin = isAdministrator() !== false;

  return <ModalDialog prefix="sid" title="OSCA ID" subtitle={`${record.idNumber} · ${senior.name}`} wide onClose={onClose}>
    <div className="sid-dialog-body">
      <DigitalIdCard record={record} />
      <p className="sid-status-note">{STATUS_INFO[record.status]?.description}</p>

      <h3 className="sid-section-title">ID information</h3>
      <dl className="sid-details">
        <Detail label="Senior record ID">{senior.seniorId}</Detail>
        <Detail label="Address">{address(senior.purok)}</Detail>
        <Detail label="Date registered">{senior.registeredAt ? formatDate(senior.registeredAt) : ""}</Detail>
        <Detail label="Issued by">{record.issuedBy}</Detail>
        {record.replacementReason && <Detail label="Replacement reason">{record.replacementReason}</Detail>}
        {record.replacementRequestedAt && <Detail label="Replacement requested">{formatDate(record.replacementRequestedAt)}{record.replacementSource ? ` · ${record.replacementSource === "App" ? "senior app" : "walk-in"}` : ""}</Detail>}
        {record.replacedBy && <Detail label="Replaced by">{record.replacedBy}</Detail>}
      </dl>
      <h3 className="sid-section-title">Remarks</h3>
      <p className="sid-remarks">{record.remarks || "No remarks added."}</p>

      <h3 className="sid-section-title">ID history</h3>
      {historyError ? <p className="sid-field-error">{historyError}</p>
      : history === null ? <p className="sid-muted">Loading history…</p>
      : history.length === 0 ? <p className="sid-muted">No history recorded.</p>
      : <ol className="sid-history">
        {history.map((entry) => <li key={entry.id}>
          <div className="sid-history-head">
            <strong>{entry.action}</strong>
            <span className="sid-id-number">{entry.idNumber}</span>
          </div>
          <p className="sid-history-meta">
            {formatDateTime(entry.createdAt)}{entry.performedBy ? ` · by ${entry.performedBy}` : ""}
          </p>
          {(entry.reason || entry.previousIdNumber || entry.newIdNumber || entry.dateRequested) && <p className="sid-history-facts">
            {entry.reason && <span>Reason: {entry.reason}</span>}
            {entry.dateRequested && <span>Requested {formatDate(entry.dateRequested)}</span>}
            {entry.previousIdNumber && entry.newIdNumber && <span>{entry.previousIdNumber} → {entry.newIdNumber}</span>}
          </p>}
          {entry.details && <p className="sid-history-details">{entry.details}</p>}
        </li>)}
      </ol>}
    </div>
    <footer className="sid-dialog-footer">
      {isCurrent && admin && <button className="sid-button sid-button--danger" type="button" onClick={() => onAction("deactivate", record)}><FiSlash aria-hidden="true" /> Deactivate</button>}
      <button className="sid-button sid-button--secondary" type="button" onClick={printCard}><FiPrinter aria-hidden="true" /> Print card</button>
      <span className="sid-footer-spacer" />
      {isCurrent && admin && <button className="sid-button sid-button--secondary" type="button" onClick={() => onAction("edit", record)}><FiEdit2 aria-hidden="true" /> Edit</button>}
      {record.status === "Pending Issuance" && <button className="sid-button sid-button--primary" type="button" onClick={() => onAction("activate", record)}><FiCheck aria-hidden="true" /> Mark issued</button>}
      {record.status === "Active" && <button className="sid-button sid-button--primary" type="button" onClick={() => onAction("request-replacement", record)}><FiRefreshCw aria-hidden="true" /> Record walk-in replacement</button>}
      {record.status === "For Replacement" && <button className="sid-button sid-button--primary" type="button" onClick={() => onAction("replace", record)}><FiRefreshCw aria-hidden="true" /> Process replacement</button>}
      {!isCurrent && <button className="sid-button sid-button--secondary" type="button" onClick={onClose}>Close</button>}
    </footer>
  </ModalDialog>;
}

function IssueDialog({ seniors, initialSeniorId, onClose, onSave }) {
  const [query, setQuery] = useState("");
  // Preselect the senior when opened from their Records profile (if they can get an ID).
  const [form, setForm] = useState({
    seniorCitizenId: seniors.some((senior) => senior.id === initialSeniorId) ? initialSeniorId : null,
    status: "Active",
    dateIssued: todayISO(),
    remarks: "",
  });
  const [errors, setErrors] = useState({});
  const { saving, saveError, submit, clearError } = useSubmit(onSave);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return seniors.filter((senior) => !q || [senior.name, senior.senior_id, senior.purok]
      .some((value) => String(value || "").toLowerCase().includes(q)));
  }, [seniors, query]);

  function set(name, value) {
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!form.seniorCitizenId) nextErrors.seniorCitizenId = "Choose the senior who will receive the ID.";
    if (form.status === "Active" && (!isISODate(form.dateIssued) || form.dateIssued > todayISO())) {
      nextErrors.dateIssued = "Choose a valid date issued that is today or earlier.";
    }
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length) submit({ ...form, remarks: form.remarks.trim() });
  }

  return <ModalDialog prefix="sid" title="Issue OSCA ID" subtitle="The system assigns the next ID number automatically." onClose={onClose}>
    <form className="sid-form" noValidate onSubmit={handleSubmit}>
      <div className="sid-dialog-body">
        {saveError && <div className="sid-message sid-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        <fieldset className="sid-fieldset"><legend>Senior citizen</legend>
          {seniors.length === 0 ? <p className="sid-muted">Every registered senior already has a current ID. Add or approve seniors in Records first.</p>
          : <>
            <div className="sid-field">
              <label htmlFor="sid-senior-search">Find senior</label>
              <div className="sid-search-box"><FiSearch aria-hidden="true" />
                <input id="sid-senior-search" type="search" data-initial-focus placeholder="Search name, record ID or purok…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
            </div>
            <div className="sid-senior-list" role="radiogroup" aria-label="Seniors without an ID" aria-describedby={errors.seniorCitizenId ? "sid-seniorCitizenId-error" : undefined}>
              {matches.length === 0 ? <p className="sid-muted">No seniors match “{query}”.</p>
              : matches.map((senior) => <label key={senior.id} className={`sid-senior-option${form.seniorCitizenId === senior.id ? " selected" : ""}`}>
                <input type="radio" name="seniorCitizenId" value={senior.id} checked={form.seniorCitizenId === senior.id} onChange={() => set("seniorCitizenId", senior.id)} />
                <span className="sid-avatar" aria-hidden="true">{initials(senior.name)}</span>
                <span className="sid-senior-option-text"><strong>{senior.name}</strong><small>{senior.senior_id} · {senior.purok} · Age {senior.age}</small></span>
              </label>)}
            </div>
            {errors.seniorCitizenId && <span id="sid-seniorCitizenId-error" className="sid-field-error">{errors.seniorCitizenId}</span>}
          </>}
        </fieldset>
        <fieldset className="sid-fieldset"><legend>Issuance</legend><div className="sid-form-grid">
          <Field name="status" label="Status" required hint={STATUS_INFO[form.status].description}>
            <select id="sid-status" value={form.status} onChange={(event) => set("status", event.target.value)}>
              <option value="Active">Active – card released now</option>
              <option value="Pending Issuance">Pending Issuance – card not yet released</option>
            </select>
          </Field>
          {form.status === "Active" && <Field name="dateIssued" label="Date issued" required error={errors.dateIssued}>
            <input id="sid-dateIssued" type="date" max={todayISO()} value={form.dateIssued} aria-invalid={Boolean(errors.dateIssued)} onChange={(event) => set("dateIssued", event.target.value)} />
          </Field>}
          <Field name="remarks" label="Remarks" wide>
            <textarea id="sid-remarks" rows={3} maxLength={1000} value={form.remarks} onChange={(event) => set("remarks", event.target.value)} placeholder="Add a note about this issuance…" />
          </Field>
        </div></fieldset>
      </div>
      <footer className="sid-dialog-footer">
        <span className="sid-footer-spacer" />
        <button className="sid-button sid-button--secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="sid-button sid-button--primary" type="submit" disabled={saving || seniors.length === 0}><FiCheck aria-hidden="true" />{saving ? "Issuing…" : "Issue ID"}</button>
      </footer>
    </form>
  </ModalDialog>;
}

const ACTION_COPY = {
  activate: { title: "Mark ID as issued", subtitle: "The card has been released to the senior.", submit: "Mark issued", busy: "Saving…" },
  edit: { title: "Edit ID information", subtitle: "Administrators only. Changes are recorded in ID history.", submit: "Save changes", busy: "Saving…" },
  "request-replacement": { title: "Record walk-in replacement", subtitle: "For seniors who ask at the office; seniors can also request a replacement in the app. The ID stays usable until the replacement is processed.", submit: "Record request", busy: "Saving…" },
  replace: { title: "Process replacement", subtitle: "The current ID becomes Inactive and a new ID number is issued today.", submit: "Issue replacement", busy: "Issuing…" },
  deactivate: { title: "Deactivate ID", subtitle: "Administrators only. The ID becomes Inactive and cannot be reactivated.", submit: "Deactivate ID", busy: "Deactivating…", danger: true },
};

function ActionDialog({ mode, record, onClose, onSave }) {
  const copy = ACTION_COPY[mode];
  const [form, setForm] = useState(() => ({
    dateIssued: mode === "activate" ? todayISO() : record.dateIssued,
    remarks: mode === "edit" ? record.remarks : "",
    reason: record.replacementReason || "",
    dateRequested: record.replacementRequestedAt || todayISO(),
  }));
  const [errors, setErrors] = useState({});
  const { saving, saveError, submit, clearError } = useSubmit(onSave);
  const needsReason = mode === "request-replacement" || mode === "replace";
  const needsDateIssued = mode === "activate" || (mode === "edit" && record.status !== "Pending Issuance");

  function set(name, value) {
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (needsDateIssued && (!isISODate(form.dateIssued) || form.dateIssued > todayISO())) {
      nextErrors.dateIssued = "Choose a valid date issued that is today or earlier.";
    }
    if (needsReason && !REPLACEMENT_REASONS.includes(form.reason)) nextErrors.reason = "Choose the reason for replacement.";
    if (needsReason && (!isISODate(form.dateRequested) || form.dateRequested > todayISO())) {
      nextErrors.dateRequested = "Choose a valid request date that is today or earlier.";
    }
    if (mode === "deactivate" && !form.remarks.trim()) nextErrors.remarks = "Explain why this ID is being deactivated.";
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length) submit({ ...form, remarks: form.remarks.trim() });
  }

  return <ModalDialog prefix="sid" title={copy.title} subtitle={`${record.idNumber} · ${record.senior.name}`} onClose={onClose}>
    <form className="sid-form" noValidate onSubmit={handleSubmit}>
      <div className="sid-dialog-body">
        <p className="sid-dialog-lead">{copy.subtitle}</p>
        {saveError && <div className="sid-message sid-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        <div className="sid-form-grid">
          {needsDateIssued && <Field name="dateIssued" label="Date issued" required error={errors.dateIssued}>
            <input id="sid-dateIssued" type="date" data-initial-focus max={todayISO()} value={form.dateIssued} aria-invalid={Boolean(errors.dateIssued)} onChange={(event) => set("dateIssued", event.target.value)} />
          </Field>}
          {needsReason && <>
            <Field name="reason" label="Reason for replacement" required error={errors.reason}>
              <select id="sid-reason" data-initial-focus value={form.reason} aria-invalid={Boolean(errors.reason)} onChange={(event) => set("reason", event.target.value)}>
                <option value="" disabled>Select reason</option>
                {REPLACEMENT_REASONS.map((value) => <option key={value}>{value}</option>)}
              </select>
            </Field>
            <Field name="dateRequested" label="Date requested" required error={errors.dateRequested}>
              <input id="sid-dateRequested" type="date" max={todayISO()} value={form.dateRequested} aria-invalid={Boolean(errors.dateRequested)} onChange={(event) => set("dateRequested", event.target.value)} />
            </Field>
          </>}
          {mode !== "activate" && <Field name="remarks" label={mode === "deactivate" ? "Reason for deactivation" : "Remarks"} required={mode === "deactivate"} error={errors.remarks} wide>
            <textarea id="sid-remarks" rows={3} maxLength={1000} data-initial-focus={mode === "edit" || mode === "deactivate" ? true : undefined} value={form.remarks} aria-invalid={Boolean(errors.remarks)} onChange={(event) => set("remarks", event.target.value)} placeholder="Add details for the ID history…" />
          </Field>}
        </div>
      </div>
      <footer className="sid-dialog-footer">
        <span className="sid-footer-spacer" />
        <button className="sid-button sid-button--secondary" type="button" onClick={onClose}>Back</button>
        <button className={`sid-button ${copy.danger ? "sid-button--danger-solid" : "sid-button--primary"}`} type="submit" disabled={saving}>
          <FiCheck aria-hidden="true" />{saving ? copy.busy : copy.submit}
        </button>
      </footer>
    </form>
  </ModalDialog>;
}
