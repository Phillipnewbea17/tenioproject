import { useEffect, useMemo, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiCheckCircle,
  FiEdit2,
  FiEye,
  FiLifeBuoy,
  FiLock,
  FiMessageSquare,
  FiPlay,
  FiPlus,
  FiRotateCcw,
  FiSearch,
  FiUserPlus,
  FiX,
} from "react-icons/fi";
import {
  addHelpRequestNote,
  assignHelpRequest,
  changeHelpRequestStatus,
  createHelpRequest,
  getHelpRequest,
  getHelpRequestOptions,
  getHelpRequests,
  getSeniorCitizens,
  reopenHelpRequest,
  updateHelpRequest,
} from "../services/api";
import ModalDialog from "../components/ModalDialog";
import useSubmit from "../hooks/useSubmit";
import { formatDate, formatDateTime, todayISO } from "../utils/dates";
import "./HelpDesk.css";

const STATUS_INFO = {
  Pending: { label: "Pending", tone: "pending", description: "Received, nobody is working on it yet." },
  "Working on it": { label: "Working on it", tone: "working", description: "Assigned staff are handling the concern." },
  Resolved: { label: "Fixed / resolved", tone: "resolved", description: "Action taken; waiting to be closed." },
  Closed: { label: "Closed", tone: "closed", description: "Case finished and stored in the senior's help history." },
};

const PRIORITY_TONE = { Low: "low", Normal: "normal", High: "high", Urgent: "urgent" };

const DEFAULT_OPTIONS = {
  categories: [
    "Lost or damaged OSCA ID", "Delayed pension/assistance", "Program concern", "Document concern",
    "Registration concern", "Account/login concern", "General inquiry", "Other",
  ],
  priorities: ["Low", "Normal", "High", "Urgent"],
  // How staff received a walk-in case; app cases arrive through the senior app.
  channels: ["Walk-in", "Phone call", "Text message", "Other"],
  staff: [],
};

const EMPTY_FILTERS = { status: "", category: "", priority: "", assigned: "", source: "", search: "" };

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function HelpStatusBadge({ status }) {
  const info = STATUS_INFO[status] || STATUS_INFO.Pending;
  return <span className={`hd-status hd-status--${info.tone}`}><span aria-hidden="true" />{info.label}</span>;
}

/** Where the case came from: the senior app or a staff-recorded walk-in. */
function SourceTag({ source }) {
  return <span className={`hd-source hd-source--${source === "App" ? "app" : "walkin"}`}>{source === "App" ? "App" : "Walk-in"}</span>;
}

function PriorityBadge({ priority }) {
  return <span className={`hd-priority hd-priority--${PRIORITY_TONE[priority] || "normal"}`}>{priority}</span>;
}

function Field({ name, label, required = false, error, hint, wide = false, children }) {
  return <div className={`hd-field${wide ? " hd-field--wide" : ""}`}>
    <label htmlFor={`hd-${name}`}>{label}{required ? <span className="hd-required" aria-hidden="true"> *</span> : <span className="hd-optional"> (optional)</span>}</label>
    {children}
    {hint && <span className="hd-hint">{hint}</span>}
    {error && <span className="hd-error">{error}</span>}
  </div>;
}

export default function HelpDesk() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [data, setData] = useState(null);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    getHelpRequestOptions()
      .then((result) => { if (!cancelled) setOptions({ ...DEFAULT_OPTIONS, ...result }); })
      .catch(() => { /* Built-in lists are used; the staff list stays empty. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (searchInput.trim() === filters.search) return undefined;
    const timer = setTimeout(() => {
      setLoading(true);
      setFilters((current) => ({ ...current, search: searchInput.trim() }));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search]);

  useEffect(() => {
    let cancelled = false;
    getHelpRequests(filters)
      .then((result) => { if (!cancelled) { setData(result); setError(""); } })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || "Failed to load requests."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, reloadKey]);

  function updateFilter(name, value) {
    setLoading(true);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function reload() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  function saved(request, message) {
    setNotice(message);
    setModal({ mode: "view", request });
    reload();
  }

  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const hasFilters = Boolean(filters.category || filters.priority || filters.assigned || filters.source || searchInput);
  const tabs = [["", "All", total], ...Object.keys(STATUS_INFO).map((status) => [status, STATUS_INFO[status].label, counts[status] || 0])];

  return <section className="scms-hd" aria-labelledby="hd-page-title">
    <header className="hd-page-header">
      <div>
        <p className="hd-eyebrow">Help &amp; Complaint Desk</p>
        <h1 id="hd-page-title">Help &amp; Complaints</h1>
        <p className="hd-subtitle">Record, assign and resolve questions, requests and complaints from senior citizens.</p>
      </div>
      <button className="hd-button hd-button--primary" type="button" onClick={() => setModal({ mode: "create" })}>
        <FiPlus aria-hidden="true" /> Record walk-in
      </button>
    </header>

    {error && <div className="hd-message hd-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="hd-text-button" type="button" onClick={reload}>Try again</button>
    </div>}
    {notice && <div className="hd-message hd-message--success" role="status">
      <FiCheckCircle aria-hidden="true" /><span>{notice}</span>
      <button className="hd-icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><FiX aria-hidden="true" /></button>
    </div>}

    <div className="hd-toolbar-top">
      <nav className="hd-tabs" aria-label="Filter by status">
        {tabs.map(([value, label, count]) => <button key={label} type="button"
          className={`hd-tab${filters.status === value ? " active" : ""}`} aria-pressed={filters.status === value}
          onClick={() => updateFilter("status", value)}>
          {label}<span className="hd-tab-count">{data ? count : "–"}</span>
        </button>)}
      </nav>
      {data && <button type="button" className={`hd-mine${filters.assigned === "me" ? " active" : ""}`} aria-pressed={filters.assigned === "me"}
        onClick={() => updateFilter("assigned", filters.assigned === "me" ? "" : "me")}>
        Assigned to me · {data.mineOpen} open
      </button>}
    </div>

    <section className="hd-filters" aria-label="Request filters">
      <div className="hd-filter hd-filter--search">
        <label htmlFor="hd-search">Search</label>
        <div className="hd-search-box"><FiSearch aria-hidden="true" />
          <input id="hd-search" type="search" placeholder="Reference, senior, subject or description…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </div>
      </div>
      <div className="hd-filter">
        <label htmlFor="hd-f-category">Category</label>
        <select id="hd-f-category" value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
          <option value="">All categories</option>
          {options.categories.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="hd-filter">
        <label htmlFor="hd-f-priority">Priority</label>
        <select id="hd-f-priority" value={filters.priority} onChange={(event) => updateFilter("priority", event.target.value)}>
          <option value="">All priorities</option>
          {options.priorities.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="hd-filter">
        <label htmlFor="hd-f-source">Source</label>
        <select id="hd-f-source" value={filters.source} onChange={(event) => updateFilter("source", event.target.value)}>
          <option value="">All sources</option>
          <option value="App">Senior app</option>
          <option value="Walk-in">Walk-in</option>
        </select>
      </div>
      <div className="hd-filter">
        <label htmlFor="hd-f-assigned">Assigned to</label>
        <select id="hd-f-assigned" value={filters.assigned} onChange={(event) => updateFilter("assigned", event.target.value)}>
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {options.staff.map((user) => <option key={user.id} value={String(user.id)}>{user.name}</option>)}
        </select>
      </div>
      {hasFilters && <button className="hd-text-button" type="button" onClick={() => { setSearchInput(""); setLoading(true); setFilters((current) => ({ ...EMPTY_FILTERS, status: current.status })); }}>Clear filters</button>}
    </section>

    <section className={`hd-panel${loading && data ? " is-refreshing" : ""}`} aria-busy={loading} aria-label="Requests and complaints">
      {!data ? <div className="hd-empty"><FiLifeBuoy aria-hidden="true" /><p>{error ? "Requests are unavailable." : "Loading requests…"}</p></div>
      : data.requests.length === 0 ? <div className="hd-empty">
        <FiLifeBuoy aria-hidden="true" />
        <h3>{hasFilters || filters.status ? "No matching requests" : "No requests yet"}</h3>
        <p>{hasFilters || filters.status ? "Try another status or clear the filters." : "Questions and complaints seniors send from the app will appear here. Record a walk-in for seniors who visit or call the office."}</p>
      </div>
      : <div className="hd-table-wrap"><table className="hd-table">
        <caption className="hd-sr-only">Requests and complaints. Open cases are listed first, most urgent first.</caption>
        <thead><tr>
          <th scope="col">Request</th><th scope="col">Senior</th><th scope="col">Category</th><th scope="col">Priority</th>
          <th scope="col">Assigned to</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col"><span className="hd-sr-only">Actions</span></th>
        </tr></thead>
        <tbody>{data.requests.map((r) => <tr key={r.id}>
          <td data-label="Request"><div className="hd-stack"><strong>{r.subject}</strong><small>{r.reference}</small><SourceTag source={r.source} /></div></td>
          <td data-label="Senior"><div className="hd-stack"><span>{r.seniorName}</span>{r.seniorPurok && <small>{r.seniorPurok}</small>}</div></td>
          <td data-label="Category">{r.category}</td>
          <td data-label="Priority"><PriorityBadge priority={r.priority} /></td>
          <td data-label="Assigned">{r.assignedName || <span className="hd-muted">Unassigned</span>}</td>
          <td data-label="Submitted" className="hd-nowrap">{formatDate(r.submittedAt)}</td>
          <td data-label="Status"><HelpStatusBadge status={r.status} /></td>
          <td className="hd-actions-cell"><button className="hd-row-button" type="button" aria-label={`View ${r.reference}: ${r.subject}`} onClick={() => setModal({ mode: "view", request: r })}><FiEye aria-hidden="true" /> View</button></td>
        </tr>)}</tbody>
      </table></div>}
      {data && <footer className="hd-footer"><p>{data.requests.length} {data.requests.length === 1 ? "request" : "requests"} shown</p></footer>}
    </section>

    {modal?.mode === "view" && <CaseDialog key={`view-${modal.request.id}`} initial={modal.request}
      onClose={() => setModal(null)}
      onOpen={(request) => setModal({ mode: "view", request })}
      onAction={(mode, request) => setModal({ mode, request })}
      onNoteAdded={(request) => { setNotice(`Note added to ${request.reference}.`); reload(); }} />}
    {modal?.mode === "create" && <CaseFormDialog options={options}
      onClose={() => setModal(null)}
      onSave={async (form) => { const request = await createHelpRequest(form); saved(request, `${request.reference} recorded.`); }} />}
    {modal?.mode === "edit" && <CaseFormDialog options={options} request={modal.request}
      onClose={() => setModal({ mode: "view", request: modal.request })}
      onSave={async (form) => { const request = await updateHelpRequest(modal.request.id, form); saved(request, `${request.reference} updated.`); }} />}
    {modal && ["assign", "start", "resolve", "close", "reopen"].includes(modal.mode) && <StatusDialog key={modal.mode} mode={modal.mode} request={modal.request} staff={options.staff}
      onClose={() => setModal({ mode: "view", request: modal.request })}
      onSave={async (form) => {
        const id = modal.request.id;
        const request = modal.mode === "assign" ? await assignHelpRequest(id, form.assignedUserId, form.note)
          : modal.mode === "start" ? await changeHelpRequestStatus(id, { status: "Working on it", note: form.note })
          : modal.mode === "resolve" ? await changeHelpRequestStatus(id, { status: "Resolved", resolution: form.resolution, resolvedAt: form.resolvedAt, note: form.note })
          : modal.mode === "close" ? await changeHelpRequestStatus(id, { status: "Closed", note: form.note })
          : await reopenHelpRequest(id, form.note);
        saved(request, `${request.reference} is now ${STATUS_INFO[request.status].label.toLowerCase()}${modal.mode === "assign" ? (request.assignedName ? `, assigned to ${request.assignedName}` : ", unassigned") : ""}.`);
      }} />}
  </section>;
}

const UPDATE_LABEL = {
  Created: "Request recorded",
  Assigned: "Assigned",
  Unassigned: "Unassigned",
  Started: "Started working",
  Resolved: "Marked fixed / resolved",
  Closed: "Case closed",
  Reopened: "Reopened",
  Note: "Note",
  Edited: "Details edited",
};

function CaseDialog({ initial, onClose, onOpen, onAction, onNoteAdded }) {
  const [request, setRequest] = useState(initial);
  const [loadError, setLoadError] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHelpRequest(initial.id)
      .then((detail) => { if (!cancelled) setRequest(detail); })
      .catch((error) => { if (!cancelled) setLoadError(error.message || "Failed to load the request."); });
    return () => { cancelled = true; };
  }, [initial.id]);

  async function submitNote(event) {
    event.preventDefault();
    if (!note.trim()) { setNoteError("Write the action taken or a follow-up note."); return; }
    setSavingNote(true);
    try {
      const updated = await addHelpRequestNote(request.id, note.trim());
      setRequest(updated);
      setNote("");
      onNoteAdded(updated);
    } catch (error) {
      setNoteError(error.message || "Could not add the note.");
    } finally {
      setSavingNote(false);
    }
  }

  const { status } = request;
  const open = status === "Pending" || status === "Working on it";

  return <ModalDialog prefix="hd" title={request.subject} subtitle={`${request.reference} · ${request.category}`} wide onClose={onClose}>
    <div className="hd-dialog-body">
      {loadError && <div className="hd-message hd-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{loadError}</span></div>}

      <div className="hd-case-head">
        <HelpStatusBadge status={status} />
        <PriorityBadge priority={request.priority} />
        <span className="hd-muted">{STATUS_INFO[status]?.description}</span>
      </div>

      <div className="hd-case-grid">
        <div>
          <div className="hd-senior">
            <span className="hd-avatar" aria-hidden="true">{initials(request.seniorName)}</span>
            <div><strong>{request.seniorName}</strong><small>{[request.seniorRecordId, request.seniorPurok].filter(Boolean).join(" · ") || "Senior record"}</small></div>
          </div>
          <dl className="hd-details">
            <div><dt>Date submitted</dt><dd>{formatDate(request.submittedAt)}</dd></div>
            <div><dt>Submitted through</dt><dd>{request.source === "App" ? "Senior app" : `Walk-in${request.channel ? ` (${request.channel.toLowerCase()})` : ""}`}</dd></div>
            <div><dt>Assigned staff</dt><dd>{request.assignedName || "Unassigned"}</dd></div>
            <div><dt>Recorded by</dt><dd>{request.createdBy || "—"}</dd></div>
            {request.resolvedAt && <div><dt>Date resolved</dt><dd>{formatDate(request.resolvedAt)}{request.daysToResolve !== null ? ` (${request.daysToResolve} ${request.daysToResolve === 1 ? "day" : "days"})` : ""}</dd></div>}
            {request.closedAt && <div><dt>Closed</dt><dd>{formatDate(request.closedAt)}</dd></div>}
          </dl>

          <h3 className="hd-section-title">Description</h3>
          <p className="hd-text-block">{request.description}</p>

          {request.resolution && <><h3 className="hd-section-title">Resolution / action taken</h3><p className="hd-text-block hd-text-block--resolved">{request.resolution}</p></>}
          {request.remarks && <><h3 className="hd-section-title">Remarks</h3><p className="hd-text-block">{request.remarks}</p></>}
        </div>

        <div>
          <h3 className="hd-section-title hd-section-title--first">Activity</h3>
          {status !== "Closed" && <form className="hd-note-form" onSubmit={submitNote} noValidate>
            <label htmlFor="hd-note" className="hd-sr-only">Add an action or follow-up note</label>
            <textarea id="hd-note" rows={2} maxLength={2000} value={note} placeholder="Add an action taken or follow-up note…"
              aria-invalid={Boolean(noteError)} onChange={(event) => { setNote(event.target.value); setNoteError(""); }} />
            {noteError && <span className="hd-error">{noteError}</span>}
            <button className="hd-button hd-button--secondary hd-button--small" type="submit" disabled={savingNote}><FiMessageSquare aria-hidden="true" />{savingNote ? "Adding…" : "Add note"}</button>
          </form>}
          {!request.updates ? <p className="hd-muted">Loading…</p>
          : <ol className="hd-timeline">
            {request.updates.map((u) => <li key={u.id} className={`hd-timeline-${(u.toStatus && STATUS_INFO[u.toStatus]?.tone) || "note"}`}>
              <div className="hd-timeline-head"><strong>{UPDATE_LABEL[u.type] || u.type}</strong>{u.toStatus && u.fromStatus && u.toStatus !== u.fromStatus && <span className="hd-muted">{STATUS_INFO[u.fromStatus]?.label} → {STATUS_INFO[u.toStatus]?.label}</span>}</div>
              <p className="hd-timeline-meta">{formatDateTime(u.createdAt)}{u.userName ? ` · ${u.userName}` : ""}</p>
              {u.note && <p className="hd-timeline-note">{u.note}</p>}
            </li>)}
          </ol>}

          <h3 className="hd-section-title">Senior's help history</h3>
          {!request.seniorHistory ? <p className="hd-muted">Loading…</p>
          : request.seniorHistory.length === 0 ? <p className="hd-muted">No other requests from this senior.</p>
          : <ul className="hd-history">
            {request.seniorHistory.map((other) => <li key={other.id}>
              <button type="button" onClick={() => onOpen(other)}>
                <span className="hd-stack"><strong>{other.subject}</strong><small>{other.reference} · {formatDate(other.submittedAt)} · {other.category}</small></span>
                <HelpStatusBadge status={other.status} />
              </button>
            </li>)}
          </ul>}
        </div>
      </div>
    </div>
    <footer className="hd-dialog-footer">
      {status !== "Closed" && <button className="hd-button hd-button--ghost" type="button" onClick={() => onAction("edit", request)}><FiEdit2 aria-hidden="true" /> Edit</button>}
      {open && <button className="hd-button hd-button--ghost" type="button" onClick={() => onAction("assign", request)}><FiUserPlus aria-hidden="true" /> {request.assignedName ? "Reassign" : "Assign"}</button>}
      <span className="hd-spacer" />
      {open && <button className="hd-button hd-button--secondary" type="button" onClick={() => onAction("close", request)}><FiLock aria-hidden="true" /> Close</button>}
      {status === "Pending" && <button className="hd-button hd-button--secondary" type="button" onClick={() => onAction("start", request)}><FiPlay aria-hidden="true" /> Start working</button>}
      {open && <button className="hd-button hd-button--primary" type="button" onClick={() => onAction("resolve", request)}><FiCheck aria-hidden="true" /> Mark resolved</button>}
      {status === "Resolved" && <>
        <button className="hd-button hd-button--secondary" type="button" onClick={() => onAction("reopen", request)}><FiRotateCcw aria-hidden="true" /> Reopen</button>
        <button className="hd-button hd-button--primary" type="button" onClick={() => onAction("close", request)}><FiLock aria-hidden="true" /> Close case</button>
      </>}
      {status === "Closed" && <button className="hd-button hd-button--secondary" type="button" onClick={() => onAction("reopen", request)}><FiRotateCcw aria-hidden="true" /> Reopen</button>}
    </footer>
  </ModalDialog>;
}

function CaseFormDialog({ options, request, onClose, onSave }) {
  const creating = !request;
  const [seniors, setSeniors] = useState(null);
  const [seniorQuery, setSeniorQuery] = useState("");
  const [form, setForm] = useState(() => ({
    seniorCitizenId: null,
    category: request?.category || "",
    subject: request?.subject || "",
    description: request?.description || "",
    priority: request?.priority || "Normal",
    channel: request?.channel || "Walk-in",
    submittedAt: todayISO(),
    assignedUserId: "",
    remarks: request?.remarks || "",
  }));
  const [errors, setErrors] = useState({});
  const { saving, saveError, submit, clearError } = useSubmit(onSave);

  useEffect(() => {
    if (!creating) return undefined;
    let cancelled = false;
    getSeniorCitizens()
      .then((rows) => { if (!cancelled) setSeniors(rows.filter((s) => s.status !== "Deceased").sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(() => { if (!cancelled) setSeniors([]); });
    return () => { cancelled = true; };
  }, [creating]);

  const matches = useMemo(() => {
    if (!seniors) return [];
    const q = seniorQuery.trim().toLowerCase();
    return seniors.filter((s) => !q || [s.name, s.senior_id, s.purok].some((v) => String(v || "").toLowerCase().includes(q))).slice(0, 50);
  }, [seniors, seniorQuery]);

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const next = {};
    if (creating && !form.seniorCitizenId) next.seniorCitizenId = "Choose the senior citizen.";
    if (!form.category) next.category = "Choose a category.";
    if (!form.subject.trim()) next.subject = "Write a short subject.";
    if (!form.description.trim()) next.description = "Describe the concern.";
    if (creating && (!form.submittedAt || form.submittedAt > todayISO())) next.submittedAt = "Choose a date that is today or earlier.";
    setErrors(next);
    if (Object.keys(next).length) return;
    submit({ ...form, subject: form.subject.trim(), description: form.description.trim(), remarks: form.remarks.trim() });
  }

  return <ModalDialog prefix="hd" title={creating ? "Record walk-in request or complaint" : "Edit request"} subtitle={creating ? "A reference number is assigned automatically." : request.reference} onClose={onClose}>
    <form className="hd-form" noValidate onSubmit={handleSubmit}>
      <div className="hd-dialog-body">
        {saveError && <div className="hd-message hd-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        {creating && <fieldset className="hd-fieldset"><legend>Senior citizen</legend>
          <div className="hd-search-box"><FiSearch aria-hidden="true" />
            <input type="search" data-initial-focus aria-label="Find senior" placeholder="Search name, record ID or purok…" value={seniorQuery} onChange={(event) => setSeniorQuery(event.target.value)} />
          </div>
          <div className="hd-senior-list" role="radiogroup" aria-label="Senior citizens">
            {seniors === null ? <p className="hd-muted">Loading seniors…</p>
            : matches.length === 0 ? <p className="hd-muted">No seniors match “{seniorQuery}”.</p>
            : matches.map((s) => <label key={s.id} className={`hd-senior-option${form.seniorCitizenId === s.id ? " selected" : ""}`}>
              <input type="radio" name="senior" checked={form.seniorCitizenId === s.id} onChange={() => set("seniorCitizenId", s.id)} />
              <span className="hd-avatar" aria-hidden="true">{initials(s.name)}</span>
              <span className="hd-stack"><strong>{s.name}</strong><small>{s.senior_id} · {s.purok}</small></span>
            </label>)}
          </div>
          {errors.seniorCitizenId && <span className="hd-error">{errors.seniorCitizenId}</span>}
        </fieldset>}

        <div className="hd-form-grid">
          <Field name="category" label="Category" required error={errors.category}>
            <select id="hd-category" data-initial-focus={creating ? undefined : true} value={form.category} aria-invalid={Boolean(errors.category)} onChange={(event) => set("category", event.target.value)}>
              <option value="" disabled>Select category</option>
              {options.categories.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field name="priority" label="Priority" required>
            <select id="hd-priority" value={form.priority} onChange={(event) => set("priority", event.target.value)}>
              {options.priorities.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field name="subject" label="Subject" required error={errors.subject} wide>
            <input id="hd-subject" maxLength={255} value={form.subject} aria-invalid={Boolean(errors.subject)} onChange={(event) => set("subject", event.target.value)} placeholder="e.g. Pension for July not received" />
          </Field>
          <Field name="description" label="Description" required error={errors.description} wide>
            <textarea id="hd-description" rows={4} maxLength={5000} value={form.description} aria-invalid={Boolean(errors.description)} onChange={(event) => set("description", event.target.value)} placeholder="What the senior reported, in their words where possible." />
          </Field>
          <Field name="channel" label="Received via">
            <select id="hd-channel" value={form.channel} onChange={(event) => set("channel", event.target.value)}>
              <option value="">Not recorded</option>
              {options.channels.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          {creating && <Field name="submittedAt" label="Date submitted" required error={errors.submittedAt}>
            <input id="hd-submittedAt" type="date" max={todayISO()} value={form.submittedAt} aria-invalid={Boolean(errors.submittedAt)} onChange={(event) => set("submittedAt", event.target.value)} />
          </Field>}
          {creating && <Field name="assignedUserId" label="Assign to" wide hint={form.assignedUserId ? "The case will start as Working on it." : "Leave empty to keep it Pending."}>
            <select id="hd-assignedUserId" value={form.assignedUserId} onChange={(event) => set("assignedUserId", event.target.value)}>
              <option value="">Nobody yet</option>
              {options.staff.map((user) => <option key={user.id} value={String(user.id)}>{user.name}</option>)}
            </select>
          </Field>}
          <Field name="remarks" label="Remarks" wide>
            <textarea id="hd-remarks" rows={2} maxLength={2000} value={form.remarks} onChange={(event) => set("remarks", event.target.value)} />
          </Field>
        </div>
      </div>
      <footer className="hd-dialog-footer">
        <span className="hd-spacer" />
        <button className="hd-button hd-button--secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="hd-button hd-button--primary" type="submit" disabled={saving}><FiCheck aria-hidden="true" />{saving ? "Saving…" : creating ? "Record request" : "Save changes"}</button>
      </footer>
    </form>
  </ModalDialog>;
}

const STATUS_DIALOG = {
  assign: { title: "Assign staff", submit: "Save assignment", lead: "Assigning a Pending case moves it to Working on it." },
  start: { title: "Start working", submit: "Start working", lead: "Mark that someone is now handling this concern." },
  resolve: { title: "Mark as fixed / resolved", submit: "Mark resolved", lead: "Record what was done. The case can then be closed." },
  close: { title: "Close case", submit: "Close case", lead: "Closed cases are kept in the senior's help history and can be reopened." },
  reopen: { title: "Reopen case", submit: "Reopen", lead: "The case goes back to Working on it. The previous resolution stays in the activity history." },
};

function StatusDialog({ mode, request, staff, onClose, onSave }) {
  const copy = STATUS_DIALOG[mode];
  const [form, setForm] = useState({
    assignedUserId: request.assignedUserId ? String(request.assignedUserId) : "",
    resolution: "",
    resolvedAt: todayISO(),
    note: "",
  });
  const [errors, setErrors] = useState({});
  const { saving, saveError, submit, clearError } = useSubmit(onSave);
  const noteRequired = mode === "reopen" || (mode === "close" && request.status !== "Resolved");

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const next = {};
    if (mode === "resolve" && !form.resolution.trim()) next.resolution = "Describe the action taken.";
    if (mode === "resolve" && (!form.resolvedAt || form.resolvedAt > todayISO() || form.resolvedAt < request.submittedAt)) {
      next.resolvedAt = "Choose a date from the date submitted through today.";
    }
    if (noteRequired && !form.note.trim()) {
      next.note = mode === "reopen" ? "Explain why the case is being reopened." : "Give a reason, for example a duplicate or withdrawn request.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    submit({ ...form, resolution: form.resolution.trim(), note: form.note.trim() });
  }

  return <ModalDialog prefix="hd" title={copy.title} subtitle={`${request.reference} · ${request.subject}`} onClose={onClose}>
    <form className="hd-form" noValidate onSubmit={handleSubmit}>
      <div className="hd-dialog-body">
        <p className="hd-lead">{copy.lead}</p>
        {saveError && <div className="hd-message hd-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        <div className="hd-form-grid">
          {mode === "assign" && <Field name="assignedUserId" label="Assign to" required wide>
            <select id="hd-assignedUserId" data-initial-focus value={form.assignedUserId} onChange={(event) => set("assignedUserId", event.target.value)}>
              <option value="">Nobody (unassign)</option>
              {staff.map((user) => <option key={user.id} value={String(user.id)}>{user.name}</option>)}
            </select>
          </Field>}
          {mode === "resolve" && <>
            <Field name="resolution" label="Resolution / action taken" required error={errors.resolution} wide>
              <textarea id="hd-resolution" data-initial-focus rows={3} maxLength={2000} value={form.resolution} aria-invalid={Boolean(errors.resolution)} onChange={(event) => set("resolution", event.target.value)} />
            </Field>
            <Field name="resolvedAt" label="Date resolved" required error={errors.resolvedAt}>
              <input id="hd-resolvedAt" type="date" min={request.submittedAt} max={todayISO()} value={form.resolvedAt} aria-invalid={Boolean(errors.resolvedAt)} onChange={(event) => set("resolvedAt", event.target.value)} />
            </Field>
          </>}
          <Field name="note" label={mode === "reopen" ? "Reason for reopening" : mode === "close" && noteRequired ? "Reason for closing" : "Note"} required={noteRequired} error={errors.note} wide>
            <textarea id="hd-note-field" data-initial-focus={mode === "start" || mode === "close" || mode === "reopen" ? true : undefined} rows={2} maxLength={2000} value={form.note} aria-invalid={Boolean(errors.note)} onChange={(event) => set("note", event.target.value)} />
          </Field>
        </div>
      </div>
      <footer className="hd-dialog-footer">
        <span className="hd-spacer" />
        <button className="hd-button hd-button--secondary" type="button" onClick={onClose}>Back</button>
        <button className="hd-button hd-button--primary" type="submit" disabled={saving}><FiCheck aria-hidden="true" />{saving ? "Saving…" : copy.submit}</button>
      </footer>
    </form>
  </ModalDialog>;
}
