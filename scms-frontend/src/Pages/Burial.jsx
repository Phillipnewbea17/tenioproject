import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiHeart,
  FiAlertCircle,
  FiCheck,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClipboard,
  FiClock,
  FiEdit2,
  FiEye,
  FiPlus,
  FiSearch,
  FiX,
} from "react-icons/fi";
import "./Burial.css";
import {
  getBurialRequests,
  createBurialRequest,
  updateBurialRequest,
} from "../services/api";
import FundPayoutFields from "../components/FundPayoutFields";
import ProgramFundsSummary from "../components/ProgramFundsSummary";
import useAvailableFunds from "../hooks/useAvailableFunds";
import { cleanAmount, peso, validatePayout } from "../utils/money";

const FUND_PROGRAM = "Burial Assistance";

const PAGE_SIZE = 8;
const RELATIONSHIPS = [
  "Spouse", "Son", "Daughter", "Sibling", "Grandchild", "Other relative", "Other",
];

const STATUS_INFO = {
  Pending: { tone: "pending", description: "Waiting for review." },
  Approved: { tone: "approved", description: "Approved; assistance has not yet been released." },
  Released: { tone: "released", description: "Assistance has been released to the recipient." },
  "On Hold": { tone: "hold", description: "Waiting for documents or follow-up." },
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) &&
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === value;
}

function formatDate(value) {
  return validDate(value)
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", {
        month: "short", day: "numeric", year: "numeric",
      })
    : "Not recorded";
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function emptyForm() {
  return {
    seniorName: "", seniorId: "", deathDate: "", purok: "",
    claimantName: "", relationship: "", contact: "",
    requestDate: today(), funeralHome: "",
    status: "Pending", releaseDate: "", receivedBy: "", remarks: "",
    amount: "", fundId: "",
  };
}

function validateRequest(form, funds = [], locked = false) {
  const errors = {};
  if (!form.seniorName) errors.seniorName = "Enter the deceased senior citizen’s full name.";
  if (!validDate(form.deathDate) || form.deathDate > today()) {
    errors.deathDate = "Choose a valid date of death that is today or earlier.";
  }
  if (!form.claimantName) errors.claimantName = "Enter the claimant’s full name.";
  if (!RELATIONSHIPS.includes(form.relationship)) errors.relationship = "Select the claimant’s relationship to the senior.";
  if (form.contact && (!/^[+\d\s()-]+$/.test(form.contact) || !/^\d{7,15}$/.test(form.contact.replace(/\D/g, "")))) {
    errors.contact = "Enter a valid contact number with 7–15 digits.";
  }
  if (!validDate(form.requestDate) || form.requestDate > today()) {
    errors.requestDate = "Choose a valid request date that is today or earlier.";
  } else if (validDate(form.deathDate) && form.requestDate < form.deathDate) {
    errors.requestDate = "The request date cannot be before the date of death.";
  }
  if (!Object.hasOwn(STATUS_INFO, form.status)) errors.status = "Choose a status.";
  if (form.status === "Released") {
    if (!validDate(form.releaseDate) || form.releaseDate > today() || form.releaseDate < form.requestDate) {
      errors.releaseDate = "Choose a release date from the request date through today.";
    }
    if (!form.receivedBy) errors.receivedBy = "Enter the name of the person who received the assistance.";
    if (!locked) Object.assign(errors, validatePayout(form, funds));
  }
  return errors;
}

/** Where the request came from: the senior app or a staff-recorded walk-in. */
function SourceTag({ source }) {
  return <span className={`bur-source bur-source--${source === "App" ? "app" : "walkin"}`}>{source === "App" ? "App" : "Walk-in"}</span>;
}

function StatusBadge({ status }) {
  return <span className={`bur-status bur-status--${STATUS_INFO[status].tone}`}>
    <span aria-hidden="true" />{status}
  </span>;
}

function Field({ name, label, required = false, error, wide = false, children }) {
  return <div className={`bur-field${wide ? " bur-field--wide" : ""}`}>
    <label htmlFor={`bur-${name}`}>
      {label}{required ? <span className="bur-required" aria-hidden="true"> *</span> : <span className="bur-optional"> (optional)</span>}
    </label>
    {children}
    {error && <span id={`bur-${name}-error`} className="bur-field-error">{error}</span>}
  </div>;
}

function Detail({ label, children }) {
  return <div className="bur-detail"><dt>{label}</dt><dd>{children || "Not recorded"}</dd></div>;
}

function Burial() {
  const [reloadKey, setReloadKey] = useState(0);
  const [fundsKey, setFundsKey] = useState(0);
const [data, setData] = useState({
  records: [],
  error: "",
});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [relationshipFilter, setRelationshipFilter] = useState("All");
  const [source, setSource] = useState("All");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const { records, error } = data;

useEffect(() => {
  let cancelled = false;

  getBurialRequests()
    .then((records) => {
      if (!cancelled) {
        setData({
          records,
          error: "",
        });
      }
    })
    .catch((error) => {
      if (!cancelled) {
        setData({
          records: [],
          error: error.message || "Failed to load Burial requests.",
        });
      }
    });

  return () => {
    cancelled = true;
  };
}, [reloadKey]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) =>
      (!query || [record.seniorName, record.claimantName, record.seniorId, record.reference, record.purok]
        .some((value) => value.toLowerCase().includes(query))) &&
      (status === "All" || record.status === status) &&
      (relationshipFilter === "All" || record.relationship === relationshipFilter) &&
      (source === "All" || record.source === source)
    ).sort((a, b) => {
      const difference = a.requestDate.localeCompare(b.requestDate) || a.createdAt.localeCompare(b.createdAt);
      return sort === "oldest" ? difference : -difference;
    });
  }, [records, search, status, relationshipFilter, source, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const hasFilters = Boolean(search.trim() || status !== "All" || relationshipFilter !== "All" || source !== "All");
  const stats = [
    { label: "Total requests", value: records.length, icon: FiClipboard, tone: "neutral" },
    { label: "Pending", value: records.filter((r) => r.status === "Pending").length, icon: FiClock, tone: "pending" },
    { label: "Approved", value: records.filter((r) => r.status === "Approved").length, icon: FiCheckCircle, tone: "approved" },
    { label: "Released", value: records.filter((r) => r.status === "Released").length, icon: FiCheck, tone: "released" },
  ];

  function resetFilters() {
    setSearch(""); setStatus("All"); setRelationshipFilter("All"); setSource("All"); setPage(1);
  }

async function saveRequest(form, existing) {
  // Errors are thrown back to the open form, which shows them.
  setFundsKey((key) => key + 1);
  const saved = existing
    ? await updateBurialRequest(existing.id, form)
    : await createBurialRequest(form);

  setData((current) => ({
    records: existing
      ? current.records.map((record) =>
          record.id === existing.id ? saved : record
        )
      : [saved, ...current.records],
    error: "",
  }));

  setModal(null);

  setNotice(
    `${saved.reference || saved.id} ${
      existing ? "updated" : "added"
    }. Saved to the database.`
  );

  if (!existing) {
    resetFilters();
    setSort("newest");
  }
}

  return <section className="scms-burial" aria-labelledby="bur-page-title">
    <header className="bur-page-header">
      <div>
        <p className="bur-eyebrow">Program Management</p>
        <h1 id="bur-page-title">Burial Assistance</h1>
        <p className="bur-subtitle">Review burial assistance requests from families and record what was released.</p>
      </div>
      <button className="bur-button bur-button--primary" onClick={() => setModal({ mode: "add" })} disabled={Boolean(error)} type="button">
        <FiPlus aria-hidden="true" /> Record walk-in
      </button>
    </header>

    {error && <div className="bur-message bur-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="bur-text-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
    </div>}
    {notice && <div className="bur-message bur-message--success" role="status">
      <FiCheckCircle aria-hidden="true" /><span>{notice}</span>
      <button className="bur-icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><FiX aria-hidden="true" /></button>
    </div>}

    <div className="bur-stats" aria-label="Burial assistance summary">
      {stats.map(({ label, value, icon: Icon, tone }) => <div className="bur-stat" key={label}>
        <span className={`bur-stat-icon bur-stat-icon--${tone}`}><Icon aria-hidden="true" /></span>
        <div><span className="bur-stat-label">{label}</span><strong className="bur-stat-value">{error ? "—" : value}</strong></div>
      </div>)}
    </div>

    <ProgramFundsSummary program={FUND_PROGRAM} refreshKey={fundsKey} />

    <section className="bur-panel" aria-labelledby="bur-list-title">
      <div className="bur-panel-heading">
        <div><h2 id="bur-list-title">Assistance requests</h2><p>Keep senior, claimant and release details together.</p></div>
        <div className="bur-sort">
          <label htmlFor="bur-sort">Request date</label>
          <select id="bur-sort" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>
      <div className="bur-toolbar">
        <div className="bur-search-group">
          <label htmlFor="bur-search">Search records</label>
          <div className="bur-search-box">
            <FiSearch aria-hidden="true" />
            <input id="bur-search" type="search" placeholder="Search senior, claimant, ID or reference…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="bur-filter">
          <label htmlFor="bur-status-filter">Status</label>
          <select id="bur-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="All">All statuses</option>{Object.keys(STATUS_INFO).map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="bur-filter">
          <label htmlFor="bur-relationship-filter">Relationship</label>
          <select id="bur-relationship-filter" value={relationshipFilter} onChange={(event) => { setRelationshipFilter(event.target.value); setPage(1); }}>
            <option value="All">All relationships</option>{RELATIONSHIPS.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="bur-filter">
          <label htmlFor="bur-source-filter">Source</label>
          <select id="bur-source-filter" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}>
            <option value="All">All sources</option><option value="App">Senior app</option><option value="Walk-in">Walk-in</option>
          </select>
        </div>
        {hasFilters && <button className="bur-text-button bur-reset" type="button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {error ? <div className="bur-empty"><FiAlertCircle aria-hidden="true" /><h3>Records are unavailable</h3><p>Use Try again above to reload the requests.</p></div>
      : filtered.length === 0 ? <div className="bur-empty">
        <span className="bur-empty-icon">{hasFilters ? <FiSearch aria-hidden="true" /> : <FiHeart aria-hidden="true" />}</span>
        <h3>{hasFilters ? "No matching requests" : "No burial requests yet"}</h3>
        <p>{hasFilters ? "Try another name or adjust the filters." : "Requests families send from the app will appear here. Record a walk-in for families who visit or call the office."}</p>
        <button className="bur-button bur-button--secondary" type="button" onClick={hasFilters ? resetFilters : () => setModal({ mode: "add" })}>
          {hasFilters ? "Clear filters" : <><FiPlus aria-hidden="true" /> Record walk-in</>}
        </button>
      </div>
      : <div className="bur-table-wrap">
        <table className="bur-table">
          <caption className="bur-sr-only">Burial assistance requests. Use View or Edit to open a record.</caption>
          <thead><tr><th scope="col">Deceased senior</th><th scope="col">Claimant</th><th scope="col">Date requested</th><th scope="col">Status</th><th scope="col" className="bur-actions-heading">Actions</th></tr></thead>
          <tbody>{visible.map((record) => <tr key={record.id}>
            <td className="bur-person-cell"><div className="bur-person">
              <span className="bur-avatar" aria-hidden="true">{initials(record.seniorName)}</span>
              <div><strong>{record.seniorName}</strong><span>{record.seniorId || "No OSCA ID"} · {record.reference}</span><SourceTag source={record.source} /></div>
            </div></td>
            <td data-label="Claimant"><div className="bur-cell-stack"><span>{record.claimantName}</span><small>{record.relationship}</small></div></td>
            <td data-label="Requested"><span className="bur-date">{formatDate(record.requestDate)}</span></td>
            <td data-label="Status"><div className="bur-cell-stack"><StatusBadge status={record.status} />{record.status === "Released" && record.amount && <small>{peso(record.amount)}</small>}</div></td>
            <td className="bur-actions-cell"><div className="bur-row-actions">
              <button className="bur-row-button" type="button" aria-label={`View request ${record.reference} for ${record.seniorName}`} onClick={() => setModal({ mode: "view", record })}><FiEye aria-hidden="true" /> View</button>
              <button className="bur-row-button" type="button" aria-label={`Edit request ${record.reference} for ${record.seniorName}`} onClick={() => setModal({ mode: "edit", record })}><FiEdit2 aria-hidden="true" /> Edit</button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}

      <footer className="bur-table-footer">
        <p aria-live="polite">{error ? "Records unavailable" : filtered.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} requests` : "0 requests"}</p>
        {totalPages > 1 && <nav className="bur-pagination" aria-label="Burial request pages">
          <button className="bur-icon-button" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft aria-hidden="true" /></button>
          <span>Page {currentPage} of {totalPages}</span>
          <button className="bur-icon-button" type="button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><FiChevronRight aria-hidden="true" /></button>
        </nav>}
      </footer>
    </section>
    

    {modal && <BurialDialog key={`${modal.mode}-${modal.record?.id || "new"}`} mode={modal.mode} record={modal.record}
      onClose={() => setModal(null)} onSave={saveRequest} onEdit={() => setModal({ mode: "edit", record: modal.record })} />}
  </section>;
}

function BurialDialog({ mode, record, onClose, onSave, onEdit }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState(() => ({
    ...emptyForm(),
    ...record,
    fundId: record?.fundId ? String(record.fundId) : "",
    amount: record?.amount || "",
  }));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const viewing = mode === "view";
  // Already released and paid from a fund: the money fields can't change here.
  const locked = Boolean(record?.paidFromFund);
  const releasing = !viewing && !locked && form.status === "Released";
  const { funds, error: fundsError } = useAvailableFunds(FUND_PROGRAM, releasing);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const containers = [document.body];
    let parent = dialog.parentElement;
    while (parent && parent !== document.body) {
      if (parent.scrollHeight > parent.clientHeight) containers.push(parent);
      parent = parent.parentElement;
    }
    const overflow = containers.map((node) => node.style.overflow);
    containers.forEach((node) => { node.style.overflow = "hidden"; });
    dialog.showModal();
    dialog.querySelector("[data-initial-focus]")?.focus();
    return () => {
      dialog.close();
      containers.forEach((node, index) => { node.style.overflow = overflow[index]; });
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function inputProps(name) {
    return {
      id: `bur-${name}`, name, value: form[name],
      "aria-invalid": Boolean(errors[name]),
      "aria-describedby": errors[name] ? `bur-${name}-error` : undefined,
      onChange: (event) => {
        const value = event.target.value;
        setForm((previous) => ({
          ...previous,
          [name]: value,
          ...(name === "status" && value === "Released" ? {
            releaseDate: previous.releaseDate || today(),
            receivedBy: previous.receivedBy || previous.claimantName,
          } : {}),
        }));
        setErrors((previous) => ({ ...previous, [name]: "" }));
        setSaveError("");
      },
    };
  }

async function submit(event) {
    event.preventDefault();
    const cleaned = Object.fromEntries(Object.keys(emptyForm()).map((key) => [key, String(form[key] ?? "").trim()]));
    const nextErrors = validateRequest(cleaned, funds || [], locked);
    if (cleaned.status !== "Released") {
      cleaned.releaseDate = "";
      cleaned.receivedBy = "";
      cleaned.amount = "";
      cleaned.fundId = "";
    } else if (!locked) {
      cleaned.amount = cleanAmount(cleaned.amount);
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      dialogRef.current.querySelector(`[name="${Object.keys(nextErrors)[0]}"]`)?.focus();
      return;
    }
    try {
      await onSave(cleaned, record);
    } catch (error) {
      setSaveError(error.message || "Could not save the request.");
    }
  }

  return <dialog ref={dialogRef} className="scms-burial-dialog" aria-labelledby="bur-dialog-title" aria-describedby="bur-dialog-subtitle" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="bur-dialog-frame">
      <header className="bur-dialog-header">
        <div><h2 id="bur-dialog-title" tabIndex={viewing ? -1 : undefined} data-initial-focus={viewing ? true : undefined}>{viewing ? "Request details" : mode === "edit" ? "Edit burial request" : "Record walk-in request"}</h2>
          <p id="bur-dialog-subtitle">{viewing ? record.reference : "Fields marked with * are required."}</p></div>
        <button type="button" className="bur-icon-button" aria-label="Close dialog" onClick={onClose}><FiX aria-hidden="true" /></button>
      </header>
      {viewing ? <>
        <div className="bur-dialog-body">
          <div className="bur-profile"><span className="bur-avatar bur-avatar--large" aria-hidden="true">{initials(record.seniorName)}</span><div><h3>{record.seniorName}</h3><p>{record.seniorId ? `OSCA ID ${record.seniorId}` : "OSCA ID not recorded"}</p></div><StatusBadge status={record.status} /></div>
          <h3 className="bur-section-title">Deceased senior citizen</h3>
          <dl className="bur-details"><Detail label="Date of death">{formatDate(record.deathDate)}</Detail><Detail label="Purok / area">{record.purok}</Detail></dl>
          <h3 className="bur-section-title">Claimant details</h3>
          <dl className="bur-details">
            <Detail label="Claimant’s full name">{record.claimantName}</Detail>
            <Detail label="Relationship to senior">{record.relationship}</Detail>
            <Detail label="Contact number">{record.contact}</Detail>
          </dl>
          <h3 className="bur-section-title">Assistance details</h3>
          <dl className="bur-details">
            <Detail label="Date requested">{formatDate(record.requestDate)}</Detail><Detail label="Status">{record.status}</Detail>
            <Detail label="Funeral home / provider">{record.funeralHome}</Detail>
            {record.status === "Released" && <><Detail label="Date released">{formatDate(record.releaseDate)}</Detail><Detail label="Received by">{record.receivedBy}</Detail>
              <Detail label="Amount released">{record.amount ? peso(record.amount) : ""}</Detail><Detail label="Paid from fund">{record.fundReference ? `${record.fundReference} · ${record.fundName}` : ""}</Detail></>}
            <Detail label="Submitted through">{record.source === "App" ? "Senior app" : "Walk-in (recorded by staff)"}</Detail>
          </dl>
          <h3 className="bur-section-title">Remarks</h3><p className="bur-remarks">{record.remarks || "No remarks added."}</p>
        </div>
        <footer className="bur-dialog-footer"><button className="bur-button bur-button--secondary" type="button" onClick={onClose}>Close</button><button className="bur-button bur-button--primary" type="button" onClick={onEdit}><FiEdit2 aria-hidden="true" /> Edit request</button></footer>
      </> : <form className="bur-form" noValidate onSubmit={submit}>
        <div className="bur-dialog-body">
          {saveError && <div className="bur-message bur-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
          <fieldset className="bur-fieldset"><legend>Deceased senior citizen</legend><div className="bur-form-grid">
            <Field name="seniorName" label="Senior’s full name" required error={errors.seniorName}><input {...inputProps("seniorName")} data-initial-focus required maxLength={100} autoComplete="off" placeholder="Enter senior’s full name" /></Field>
            <Field name="seniorId" label="OSCA ID"><input {...inputProps("seniorId")} maxLength={40} placeholder="Enter OSCA ID" /></Field>
            <Field name="deathDate" label="Date of death" required error={errors.deathDate}><input {...inputProps("deathDate")} type="date" required max={today()} /></Field>
            <Field name="purok" label="Purok / area"><input {...inputProps("purok")} maxLength={80} placeholder="Enter purok or area" /></Field>
          </div></fieldset>
          <fieldset className="bur-fieldset"><legend>Claimant details</legend><div className="bur-form-grid">
            <Field name="claimantName" label="Claimant’s full name" required error={errors.claimantName}><input {...inputProps("claimantName")} required maxLength={100} autoComplete="off" placeholder="Person applying for assistance" /></Field>
            <Field name="relationship" label="Relationship to senior" required error={errors.relationship}><select {...inputProps("relationship")} required><option value="" disabled>Select relationship</option>{RELATIONSHIPS.map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field name="contact" label="Contact number" error={errors.contact}><input {...inputProps("contact")} type="tel" maxLength={24} autoComplete="off" placeholder="09XX XXX XXXX" /></Field>
          </div></fieldset>
          <fieldset className="bur-fieldset"><legend>Assistance details</legend><div className="bur-form-grid">
            <Field name="requestDate" label="Date requested" required error={errors.requestDate}><input {...inputProps("requestDate")} type="date" required min={form.deathDate || undefined} max={today()} /></Field>
            <Field name="status" label="Status" required error={errors.status}><select {...inputProps("status")} required disabled={locked}>{Object.keys(STATUS_INFO).map((value) => <option key={value}>{value}</option>)}</select><span className="bur-field-hint">{locked ? "Released and paid from a fund. To change it, void the disbursement in Fund Management." : STATUS_INFO[form.status].description}</span></Field>
            <Field name="funeralHome" label="Funeral home / provider" wide><input {...inputProps("funeralHome")} maxLength={120} placeholder="Enter funeral home or service provider" /></Field>
            {form.status === "Released" && <>
              {fundsError && <div className="bur-field bur-field--wide"><span className="bur-field-error">{fundsError}</span></div>}
              <FundPayoutFields prefix="bur" program={FUND_PROGRAM} amount={form.amount} fundId={form.fundId} funds={funds} errors={errors}
                locked={locked} lockedFund={`${record?.fundReference} · ${record?.fundName}`}
                onChange={(name, value) => { setForm((previous) => ({ ...previous, [name]: value })); setErrors((previous) => ({ ...previous, [name]: "" })); setSaveError(""); }} />
              <Field name="releaseDate" label="Date released" required error={errors.releaseDate}><input {...inputProps("releaseDate")} type="date" required min={form.requestDate} max={today()} disabled={locked} /></Field>
              <Field name="receivedBy" label="Received by" required error={errors.receivedBy}><input {...inputProps("receivedBy")} required maxLength={100} placeholder="Enter recipient’s full name" /><span className="bur-field-hint">Defaults to the claimant. Change this if someone else received the assistance.</span></Field>
            </>}
            <Field name="remarks" label="Remarks" wide><textarea {...inputProps("remarks")} rows={3} maxLength={1000} placeholder="Add request details or a follow-up note…" /></Field>
          </div></fieldset>
        </div>
        <footer className="bur-dialog-footer"><button className="bur-button bur-button--secondary" type="button" onClick={onClose}>Cancel</button><button className="bur-button bur-button--primary" type="submit"><FiCheck aria-hidden="true" />{mode === "edit" ? "Save changes" : "Save request"}</button></footer>
      </form>}
    </div>
  </dialog>;
}

export default Burial;
