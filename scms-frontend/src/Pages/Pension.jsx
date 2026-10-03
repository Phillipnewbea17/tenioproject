import { useEffect, useMemo, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClipboard,
  FiClock,
  FiEdit2,
  FiEye,
  FiPauseCircle,
  FiPlus,
  FiSearch,
  FiX,
} from "react-icons/fi";
import { TbWallet } from "react-icons/tb";
import {
  createPensionRelease,
  getPensionReleases,
  getSeniorCitizens,
  updatePensionRelease,
} from "../services/api";
import ModalDialog from "../components/ModalDialog";
import useSubmit from "../hooks/useSubmit";
import { formatDate, isISODate, todayISO } from "../utils/dates";
import FundPayoutFields from "../components/FundPayoutFields";
import ProgramFundsSummary from "../components/ProgramFundsSummary";
import useAvailableFunds from "../hooks/useAvailableFunds";
import { cleanAmount, peso, validatePayout } from "../utils/money";
import "./Pension.css";

const FUND_PROGRAM = "Pension";

const PAGE_SIZE = 8;
const RECEIVED_BY = ["Senior", "Representative", "Authorized Person"];

// Released uses the green "approved" pill from the shared program styles.
const STATUS_INFO = {
  Pending: { tone: "pending", description: "Scheduled; the pension has not been released yet." },
  Released: { tone: "approved", description: "The pension was released to the senior or their representative." },
  "On Hold": { tone: "hold", description: "Held back, e.g. waiting for documents or verification." },
};

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function emptyForm() {
  return {
    seniorId: "", name: "", period: "", status: "Pending",
    releaseDate: "", receivedBy: "Senior", reference: "", remarks: "",
    amount: "", fundId: "",
  };
}

function StatusBadge({ status }) {
  return <span className={`pen-status pen-status--${STATUS_INFO[status]?.tone || "pending"}`}><span aria-hidden="true" />{status}</span>;
}

function Field({ name, label, required = false, error, hint, wide = false, children }) {
  return <div className={`pen-field${wide ? " pen-field--wide" : ""}`}>
    <label htmlFor={`pen-${name}`}>{label}{required ? <span className="pen-required" aria-hidden="true"> *</span> : <span className="pen-optional"> (optional)</span>}</label>
    {children}
    {hint && <span className="pen-field-hint">{hint}</span>}
    {error && <span id={`pen-${name}-error`} className="pen-field-error">{error}</span>}
  </div>;
}

function Detail({ label, children }) {
  return <div className="pen-detail"><dt>{label}</dt><dd>{children || "Not recorded"}</dd></div>;
}

export default function Pension() {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [fundsKey, setFundsKey] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [period, setPeriod] = useState("All");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPensionReleases()
      .then((rows) => { if (!cancelled) { setReleases(rows); setError(""); } })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || "Failed to load pension releases."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const periods = useMemo(() => [...new Set(releases.map((r) => r.period).filter(Boolean))].sort(), [releases]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return releases.filter((r) =>
      (!query || [r.name, r.seniorId, r.reference, r.period].some((value) => value.toLowerCase().includes(query))) &&
      (status === "All" || r.status === status) &&
      (period === "All" || r.period === period)
    ).sort((a, b) => {
      const difference = (a.releaseDate || a.createdAt).localeCompare(b.releaseDate || b.createdAt);
      return sort === "oldest" ? difference : -difference;
    });
  }, [releases, search, status, period, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const hasFilters = Boolean(search.trim() || status !== "All" || period !== "All");
  const count = (value) => releases.filter((r) => r.status === value).length;
  const stats = [
    { label: "Release records", value: releases.length, icon: FiClipboard, tone: "neutral" },
    { label: "Released", value: count("Released"), icon: FiCheckCircle, tone: "approved" },
    { label: "Pending", value: count("Pending"), icon: FiClock, tone: "pending" },
    { label: "On hold", value: count("On Hold"), icon: FiPauseCircle, tone: "hold" },
  ];

  function resetFilters() {
    setSearch(""); setStatus("All"); setPeriod("All"); setPage(1);
  }

  function retry() {
    setLoading(true);
    setError("");
    setReloadKey((key) => key + 1);
  }

  // Errors are thrown back to the open form, which shows them.
  async function saveRelease(form, existing) {
    const saved = existing ? await updatePensionRelease(existing.id, form) : await createPensionRelease(form);
    setFundsKey((key) => key + 1);
    setReleases((current) => existing ? current.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...current]);
    setModal({ mode: "view", record: saved });
    setNotice(`Pension for ${saved.name} (${saved.period}) ${existing ? "updated" : "recorded"}.`);
  }

  return <section className="scms-pension" aria-labelledby="pen-page-title">
    <header className="pen-page-header">
      <div>
        <p className="pen-eyebrow">Program Management</p>
        <h1 id="pen-page-title">Pension</h1>
        <p className="pen-subtitle">Record pension releases for senior citizens and keep track of what is pending.</p>
      </div>
      <button className="pen-button pen-button--primary" type="button" disabled={loading || Boolean(error)} onClick={() => setModal({ mode: "add" })}>
        <FiPlus aria-hidden="true" /> Add release record
      </button>
    </header>

    {error && <div className="pen-message pen-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="pen-text-button" type="button" onClick={retry}>Try again</button>
    </div>}
    {notice && <div className="pen-message pen-message--success" role="status">
      <FiCheckCircle aria-hidden="true" /><span>{notice}</span>
      <button className="pen-icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><FiX aria-hidden="true" /></button>
    </div>}

    <div className="pen-stats" aria-label="Pension summary">
      {stats.map(({ label, value, icon: Icon, tone }) => <div className="pen-stat" key={label}>
        <span className={`pen-stat-icon pen-stat-icon--${tone}`}><Icon aria-hidden="true" /></span>
        <div><span className="pen-stat-label">{label}</span><strong className="pen-stat-value">{loading || error ? "—" : value}</strong></div>
      </div>)}
    </div>

    <ProgramFundsSummary program={FUND_PROGRAM} refreshKey={fundsKey} />

    <section className="pen-panel" aria-labelledby="pen-list-title">
      <div className="pen-panel-heading">
        <div><h2 id="pen-list-title">Release records</h2><p>Check each senior's pension and update it once released.</p></div>
        <div className="pen-sort">
          <label htmlFor="pen-sort">Sort by</label>
          <select id="pen-sort" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>
      <div className="pen-toolbar">
        <div className="pen-search-group">
          <label htmlFor="pen-search">Search records</label>
          <div className="pen-search-box">
            <FiSearch aria-hidden="true" />
            <input id="pen-search" type="search" placeholder="Search name, senior ID, period or reference…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="pen-filter">
          <label htmlFor="pen-status-filter">Status</label>
          <select id="pen-status-filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="All">All statuses</option>{Object.keys(STATUS_INFO).map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="pen-filter">
          <label htmlFor="pen-period-filter">Period</label>
          <select id="pen-period-filter" value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}>
            <option value="All">All periods</option>{periods.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        {hasFilters && <button className="pen-text-button pen-reset" type="button" onClick={resetFilters}>Clear filters</button>}
      </div>

      {loading ? <div className="pen-empty"><span className="pen-empty-icon"><TbWallet aria-hidden="true" /></span><h3>Loading releases…</h3></div>
      : error ? <div className="pen-empty"><FiAlertCircle aria-hidden="true" /><h3>Records are unavailable</h3><p>Use Try again above to reload the releases.</p></div>
      : filtered.length === 0 ? <div className="pen-empty">
        <span className="pen-empty-icon">{hasFilters ? <FiSearch aria-hidden="true" /> : <TbWallet aria-hidden="true" />}</span>
        <h3>{hasFilters ? "No matching records" : "No pension releases yet"}</h3>
        <p>{hasFilters ? "Try another name or adjust the filters." : "Add a release record for each senior's pension period."}</p>
        <button className="pen-button pen-button--secondary" type="button" onClick={hasFilters ? resetFilters : () => setModal({ mode: "add" })}>
          {hasFilters ? "Clear filters" : <><FiPlus aria-hidden="true" /> Add release record</>}
        </button>
      </div>
      : <div className="pen-table-wrap">
        <table className="pen-table">
          <caption className="pen-sr-only">Pension release records. Use View or Edit to open a record.</caption>
          <thead><tr><th scope="col">Senior citizen</th><th scope="col">Pension period</th><th scope="col">Release date</th><th scope="col">Status</th><th scope="col" className="pen-actions-heading">Actions</th></tr></thead>
          <tbody>{visible.map((r) => <tr key={r.id}>
            <td className="pen-person-cell"><div className="pen-person">
              <span className="pen-avatar" aria-hidden="true">{initials(r.name)}</span>
              <div><strong>{r.name}</strong><span>{r.seniorId}{r.reference ? ` · ${r.reference}` : ""}</span></div>
            </div></td>
            <td data-label="Period"><div className="pen-cell-stack"><span>{r.period}</span><small>Received by {r.receivedBy.toLowerCase()}</small></div></td>
            <td data-label="Released"><span className="pen-date">{r.releaseDate ? formatDate(r.releaseDate) : "Not yet"}</span></td>
            <td data-label="Status"><div className="pen-cell-stack"><StatusBadge status={r.status} />{r.paidFromFund && <small>{peso(r.amount)}</small>}</div></td>
            <td className="pen-actions-cell"><div className="pen-row-actions">
              <button className="pen-row-button" type="button" aria-label={`View pension of ${r.name} for ${r.period}`} onClick={() => setModal({ mode: "view", record: r })}><FiEye aria-hidden="true" /> View</button>
              <button className="pen-row-button" type="button" aria-label={`Edit pension of ${r.name} for ${r.period}`} onClick={() => setModal({ mode: "edit", record: r })}><FiEdit2 aria-hidden="true" /> Edit</button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}

      <footer className="pen-table-footer">
        <p aria-live="polite">{loading || error ? "" : filtered.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} records` : "0 records"}</p>
        {totalPages > 1 && <nav className="pen-pagination" aria-label="Pension pages">
          <button className="pen-icon-button" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><FiChevronLeft aria-hidden="true" /></button>
          <span>Page {currentPage} of {totalPages}</span>
          <button className="pen-icon-button" type="button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><FiChevronRight aria-hidden="true" /></button>
        </nav>}
      </footer>
    </section>

    {modal?.mode === "view" && <ViewDialog key={`view-${modal.record.id}`} record={modal.record}
      onClose={() => setModal(null)} onEdit={() => setModal({ mode: "edit", record: modal.record })} />}
    {(modal?.mode === "add" || modal?.mode === "edit") && <ReleaseForm key={`${modal.mode}-${modal.record?.id || "new"}`} record={modal.record}
      onClose={() => setModal(modal.record ? { mode: "view", record: modal.record } : null)}
      onSave={(form) => saveRelease(form, modal.record)} />}
  </section>;
}

function ViewDialog({ record, onClose, onEdit }) {
  return <ModalDialog prefix="pen" title="Pension release" subtitle={`${record.name} · ${record.period}`} onClose={onClose}>
    <div className="pen-dialog-body">
      <div className="pen-profile">
        <span className="pen-avatar pen-avatar--large" aria-hidden="true">{initials(record.name)}</span>
        <div><h3>{record.name}</h3><p>{record.seniorId}</p></div>
        <StatusBadge status={record.status} />
      </div>
      <dl className="pen-details">
        <Detail label="Pension period">{record.period}</Detail>
        <Detail label="Status">{record.status}</Detail>
        <Detail label="Release date">{record.releaseDate ? formatDate(record.releaseDate) : ""}</Detail>
        <Detail label="Received by">{record.receivedBy}</Detail>
        <Detail label="Reference number">{record.reference}</Detail>
        {record.paidFromFund && <>
          <Detail label="Amount paid">{peso(record.amount)}</Detail>
          <Detail label="Paid from fund">{`${record.fundReference} · ${record.fundName}`}</Detail>
        </>}
      </dl>
      <h3 className="pen-section-title">Remarks</h3>
      <p className="pen-remarks">{record.remarks || "No remarks added."}</p>
    </div>
    <footer className="pen-dialog-footer">
      <button className="pen-button pen-button--secondary" type="button" onClick={onClose}>Close</button>
      <button className="pen-button pen-button--primary" type="button" onClick={onEdit}><FiEdit2 aria-hidden="true" /> Edit record</button>
    </footer>
  </ModalDialog>;
}

function ReleaseForm({ record, onClose, onSave }) {
  const editing = Boolean(record);
  const [form, setForm] = useState(() => ({
    ...emptyForm(),
    ...record,
    amount: record?.amount || "",
    fundId: record?.fundId ? String(record.fundId) : "",
  }));
  // Already released and paid from a fund: the money fields can't change here.
  const locked = Boolean(record?.paidFromFund);
  const paying = !locked && form.status === "Released";
  const { funds, error: fundsError } = useAvailableFunds(FUND_PROGRAM, paying);
  const [errors, setErrors] = useState({});
  const [seniors, setSeniors] = useState(null);
  const { saving, saveError, submit, clearError } = useSubmit(onSave);

  // Seniors to choose from (so the senior ID and name always match a record).
  useEffect(() => {
    let cancelled = false;
    getSeniorCitizens()
      .then((rows) => { if (!cancelled) setSeniors(rows.filter((s) => s.status !== "Deceased").sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(() => { if (!cancelled) setSeniors([]); });
    return () => { cancelled = true; };
  }, []);

  // Keep the current senior selectable when editing, even if their record changed.
  const options = useMemo(() => {
    const list = (seniors || []).map((s) => ({ seniorId: s.senior_id, name: s.name }));
    if (record && !list.some((s) => s.seniorId === record.seniorId)) list.unshift({ seniorId: record.seniorId, name: record.name });
    return list;
  }, [seniors, record]);

  function set(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "status" && value === "Released" && !current.releaseDate ? { releaseDate: todayISO() } : {}),
    }));
    setErrors((current) => ({ ...current, [name]: "" }));
    clearError();
  }

  function chooseSenior(seniorId) {
    const senior = options.find((s) => s.seniorId === seniorId);
    setForm((current) => ({ ...current, seniorId, name: senior?.name || "" }));
    setErrors((current) => ({ ...current, seniorId: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const cleaned = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    const next = {};
    if (!cleaned.seniorId) next.seniorId = "Choose the senior citizen.";
    if (!cleaned.period) next.period = "Enter the pension period, e.g. Q1 2026.";
    if (cleaned.status === "Released" && (!isISODate(cleaned.releaseDate) || cleaned.releaseDate > todayISO())) {
      next.releaseDate = "Choose the release date (today or earlier).";
    }
    if (paying) {
      Object.assign(next, validatePayout(cleaned, funds));
      cleaned.amount = cleanAmount(cleaned.amount);
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    submit(cleaned.status === "Released" ? cleaned : { ...cleaned, releaseDate: "", amount: "", fundId: "" });
  }

  return <ModalDialog prefix="pen" title={editing ? "Edit pension release" : "Add pension release record"} subtitle="Fields marked with * are required." onClose={onClose}>
    <form className="pen-form" noValidate onSubmit={handleSubmit}>
      <div className="pen-dialog-body">
        {saveError && <div className="pen-message pen-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        <fieldset className="pen-fieldset"><legend>Senior citizen</legend><div className="pen-form-grid">
          <Field name="seniorId" label="Senior citizen" required error={errors.seniorId} wide hint={form.seniorId ? `Senior ID ${form.seniorId}` : "Seniors come from Records."}>
            <select id="pen-seniorId" data-initial-focus value={form.seniorId} disabled={seniors === null} aria-invalid={Boolean(errors.seniorId)} onChange={(event) => chooseSenior(event.target.value)}>
              <option value="" disabled>{seniors === null ? "Loading seniors…" : options.length ? "Select a senior" : "No seniors in Records yet"}</option>
              {options.map((s) => <option key={s.seniorId} value={s.seniorId}>{s.name} · {s.seniorId}</option>)}
            </select>
          </Field>
        </div></fieldset>
        <fieldset className="pen-fieldset"><legend>Release details</legend><div className="pen-form-grid">
          <Field name="period" label="Pension period" required error={errors.period}>
            <input id="pen-period" maxLength={100} value={form.period} aria-invalid={Boolean(errors.period)} onChange={(event) => set("period", event.target.value)} placeholder="e.g. Q1 2026 (January–March)" />
          </Field>
          <Field name="status" label="Status" required hint={STATUS_INFO[form.status].description}>
            <select id="pen-status" value={form.status} disabled={locked} onChange={(event) => set("status", event.target.value)}>
              {Object.keys(STATUS_INFO).map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          {form.status === "Released" && <>
            {fundsError && <div className="pen-field pen-field--wide"><span className="pen-field-error">{fundsError}</span></div>}
            <FundPayoutFields prefix="pen" program={FUND_PROGRAM} amount={form.amount} fundId={form.fundId} funds={funds} errors={errors}
              locked={locked} lockedFund={`${record?.fundReference} · ${record?.fundName}`} onChange={set} />
            <Field name="releaseDate" label="Release date" required error={errors.releaseDate}>
              <input id="pen-releaseDate" type="date" max={todayISO()} value={form.releaseDate} disabled={locked} aria-invalid={Boolean(errors.releaseDate)} onChange={(event) => set("releaseDate", event.target.value)} />
            </Field>
          </>}
          <Field name="receivedBy" label="Received by" required>
            <select id="pen-receivedBy" value={form.receivedBy} onChange={(event) => set("receivedBy", event.target.value)}>
              {RECEIVED_BY.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field name="reference" label="Reference number">
            <input id="pen-reference" maxLength={255} value={form.reference} onChange={(event) => set("reference", event.target.value)} placeholder="Payroll or voucher number" />
          </Field>
          <Field name="remarks" label="Remarks" wide>
            <textarea id="pen-remarks" rows={3} maxLength={1000} value={form.remarks} onChange={(event) => set("remarks", event.target.value)} />
          </Field>
        </div></fieldset>
      </div>
      <footer className="pen-dialog-footer">
        <button className="pen-button pen-button--secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="pen-button pen-button--primary" type="submit" disabled={saving}><FiCheck aria-hidden="true" />{saving ? "Saving…" : editing ? "Save changes" : "Save release record"}</button>
      </footer>
    </form>
  </ModalDialog>;
}
