import { useEffect, useMemo, useState } from "react";
import {
  FiAlertCircle,
  FiArrowDownCircle,
  FiArrowUpCircle,
  FiCheck,
  FiCheckCircle,
  FiEdit2,
  FiEye,
  FiLock,
  FiPlus,
  FiSearch,
  FiSend,
  FiUnlock,
  FiX,
  FiXCircle,
} from "react-icons/fi";
import { TbCurrencyPeso } from "react-icons/tb";
import {
  addFundTransaction,
  closeFund,
  createFund,
  getFund,
  getFunds,
  isAdministrator,
  reopenFund,
  updateFund,
  voidFundTransaction,
} from "../services/api";
import ModalDialog from "../components/ModalDialog";
import useSubmit from "../hooks/useSubmit";
import { formatDate, todayISO } from "../utils/dates";
import "./Funds.css";

const CATEGORIES = [
  "Pension",
  "Medical Assistance",
  "Burial Assistance",
  "Food/Relief Assistance",
  "Other Senior Citizen Programs",
];

const TYPE_INFO = {
  Allocation: { verb: "Allocate funds", tone: "allocation", icon: FiArrowDownCircle, recipientLabel: "", hint: "Assign budget from this fund to a program." },
  Release: { verb: "Record release", tone: "release", icon: FiSend, recipientLabel: "Released to", hint: "Money released for use. Cannot exceed what is allocated and not yet released." },
  Disbursement: { verb: "Record disbursement", tone: "disbursement", icon: FiArrowUpCircle, recipientLabel: "Paid to", hint: "Money actually paid out. Cannot exceed what is released and not yet disbursed." },
};

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

function peso(value) {
  return pesoFormat.format(Number(value) || 0);
}

// "1,500.5" → "1500.5"; returns "" when the amount is not a valid peso value.
function cleanAmount(value) {
  const text = String(value).replace(/[,\s₱]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0 ? text : "";
}

function percent(part, whole) {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;
}

/** How much of the allocation has been used. Track is a lighter step of the fill. */
function UsageMeter({ used, total }) {
  const value = percent(used, total);
  return <div className="fm-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label="Share of allocation disbursed">
    <span className="fm-meter-fill" style={{ width: `${value}%` }} />
    <span className="fm-meter-text">{Math.round(value)}% used</span>
  </div>;
}

function StatusBadge({ status }) {
  return <span className={`fm-status fm-status--${status === "Active" ? "active" : "closed"}`}>
    {status === "Active" ? <FiUnlock aria-hidden="true" /> : <FiLock aria-hidden="true" />}{status}
  </span>;
}

function TypeBadge({ type, voided }) {
  return <span className={`fm-type fm-type--${TYPE_INFO[type]?.tone || "allocation"}${voided ? " fm-type--voided" : ""}`}>{type}{voided ? " · voided" : ""}</span>;
}

function Field({ name, label, required = false, error, hint, wide = false, children }) {
  return <div className={`fm-field${wide ? " fm-field--wide" : ""}`}>
    <label htmlFor={`fm-${name}`}>{label}{required ? <span className="fm-required" aria-hidden="true"> *</span> : <span className="fm-optional"> (optional)</span>}</label>
    {children}
    {hint && <span className="fm-hint">{hint}</span>}
    {error && <span id={`fm-${name}-error`} className="fm-error">{error}</span>}
  </div>;
}

export default function Funds() {
  const admin = isAdministrator() !== false;
  const [filters, setFilters] = useState({ fiscal_year: "", status: "", category: "", search: "" });
  const [searchInput, setSearchInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");

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
    getFunds(filters)
      .then((result) => { if (!cancelled) { setData(result); setError(""); } })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || "Failed to load funds."); })
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

  // After any change: show the updated fund and refresh the list and dashboard.
  function saved(fund, message) {
    setNotice(message);
    setModal({ mode: "view", fund });
    reload();
  }

  const hasFilters = Boolean(filters.fiscal_year || filters.status || filters.category || searchInput);
  const totals = data?.dashboard.totals;

  return <section className="scms-fm" aria-labelledby="fm-page-title">
    <header className="fm-page-header">
      <div>
        <p className="fm-eyebrow">Fund Management</p>
        <h1 id="fm-page-title">Funds</h1>
        <p className="fm-subtitle">Track money for senior citizen programs from allocation to release to disbursement.</p>
      </div>
      {admin && <button className="fm-button fm-button--primary" type="button" onClick={() => setModal({ mode: "create" })}>
        <FiPlus aria-hidden="true" /> New fund
      </button>}
    </header>

    {error && <div className="fm-message fm-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="fm-text-button" type="button" onClick={reload}>Try again</button>
    </div>}
    {notice && <div className="fm-message fm-message--success" role="status">
      <FiCheckCircle aria-hidden="true" /><span>{notice}</span>
      <button className="fm-icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><FiX aria-hidden="true" /></button>
    </div>}

    <section className="fm-filters" aria-label="Fund filters">
      <div className="fm-filter fm-filter--search">
        <label htmlFor="fm-search">Search</label>
        <div className="fm-search-box"><FiSearch aria-hidden="true" />
          <input id="fm-search" type="search" placeholder="Fund name, reference or source…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </div>
      </div>
      <div className="fm-filter">
        <label htmlFor="fm-year">Fiscal year</label>
        <select id="fm-year" value={filters.fiscal_year} onChange={(event) => updateFilter("fiscal_year", event.target.value)}>
          <option value="">All years</option>
          {(data?.years || []).map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>
      <div className="fm-filter">
        <label htmlFor="fm-category">Category</label>
        <select id="fm-category" value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="fm-filter">
        <label htmlFor="fm-status">Status</label>
        <select id="fm-status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
          <option value="">All statuses</option><option>Active</option><option>Closed</option>
        </select>
      </div>
      {hasFilters && <button className="fm-text-button" type="button" onClick={() => { setSearchInput(""); setLoading(true); setFilters({ fiscal_year: "", status: "", category: "", search: "" }); }}>Clear filters</button>}
    </section>

    <div className={`fm-body${loading && data ? " is-refreshing" : ""}`} aria-busy={loading}>
      {!data ? <div className="fm-empty"><TbCurrencyPeso aria-hidden="true" /><p>{error ? "Funds are unavailable." : "Loading funds…"}</p></div>
      : <>
        <div className="fm-stats" aria-label="Fund totals">
          {[
            ["Total allocated", totals.allocated, "Budget assigned to programs"],
            ["Total released", totals.released, `${peso(totals.unreleased)} not yet released`],
            ["Used / disbursed", totals.disbursed, `${peso(totals.onHand)} released, not yet paid out`],
            ["Remaining balance", totals.remaining, "Allocated minus disbursed"],
          ].map(([label, value, hint]) => <div className="fm-stat" key={label}>
            <span className="fm-stat-label">{label}</span>
            <strong className="fm-stat-value">{peso(value)}</strong>
            <span className="fm-stat-hint">{hint}</span>
          </div>)}
        </div>

        <div className="fm-grid">
          <section className="fm-panel" aria-labelledby="fm-by-program">
            <h2 id="fm-by-program" className="fm-panel-title">Funds by program</h2>
            {data.dashboard.byProgram.length === 0 ? <p className="fm-muted fm-pad">No allocations yet.</p>
            : <div className="fm-table-wrap"><table className="fm-table">
              <thead><tr><th scope="col">Program</th><th scope="col" className="num">Allocated</th><th scope="col" className="num">Disbursed</th><th scope="col" className="num">Remaining</th><th scope="col">Used</th></tr></thead>
              <tbody>{data.dashboard.byProgram.map((row) => <tr key={row.program}>
                <th scope="row">{row.program}</th>
                <td className="num">{peso(row.allocated)}</td>
                <td className="num">{peso(row.disbursed)}</td>
                <td className="num">{peso(row.remaining)}</td>
                <td><UsageMeter used={row.disbursed} total={row.allocated} /></td>
              </tr>)}</tbody>
            </table></div>}
          </section>

          <section className="fm-panel" aria-labelledby="fm-by-year">
            <h2 id="fm-by-year" className="fm-panel-title">Funds by year</h2>
            {data.dashboard.byYear.length === 0 ? <p className="fm-muted fm-pad">No funds yet.</p>
            : <div className="fm-table-wrap"><table className="fm-table">
              <thead><tr><th scope="col">Fiscal year</th><th scope="col" className="num">Funds</th><th scope="col" className="num">Allocated</th><th scope="col" className="num">Remaining</th></tr></thead>
              <tbody>{data.dashboard.byYear.map((row) => <tr key={row.fiscalYear}>
                <th scope="row">{row.fiscalYear}</th>
                <td className="num">{row.funds}</td>
                <td className="num">{peso(row.allocated)}</td>
                <td className="num">{peso(row.remaining)}</td>
              </tr>)}</tbody>
            </table></div>}
          </section>
        </div>

        <section className="fm-panel" aria-labelledby="fm-list-title">
          <h2 id="fm-list-title" className="fm-panel-title">Funds <span className="fm-count">{data.funds.length}</span></h2>
          {data.funds.length === 0 ? <div className="fm-empty fm-empty--inline">
            <TbCurrencyPeso aria-hidden="true" />
            <h3>{hasFilters ? "No matching funds" : "No funds yet"}</h3>
            <p>{hasFilters ? "Try other filters." : admin ? "Create the first fund to start tracking allocations and disbursements." : "An administrator needs to create the first fund."}</p>
            {!hasFilters && admin && <button className="fm-button fm-button--secondary" type="button" onClick={() => setModal({ mode: "create" })}><FiPlus aria-hidden="true" /> New fund</button>}
          </div>
          : <div className="fm-table-wrap"><table className="fm-table fm-table--funds">
            <thead><tr>
              <th scope="col">Fund</th><th scope="col">Category</th><th scope="col">FY</th>
              <th scope="col" className="num">Allocated</th><th scope="col" className="num">Disbursed</th><th scope="col" className="num">Remaining</th>
              <th scope="col">Used</th><th scope="col">Status</th><th scope="col"><span className="fm-sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{data.funds.map((fund) => <tr key={fund.id}>
              <td data-label="Fund"><div className="fm-stack"><strong>{fund.name}</strong><small>{fund.reference} · {fund.source}</small></div></td>
              <td data-label="Category">{fund.category}</td>
              <td data-label="FY">{fund.fiscalYear}</td>
              <td data-label="Allocated" className="num">{peso(fund.totals.allocated)}</td>
              <td data-label="Disbursed" className="num">{peso(fund.totals.disbursed)}</td>
              <td data-label="Remaining" className="num"><strong>{peso(fund.totals.remaining)}</strong></td>
              <td data-label="Used"><UsageMeter used={fund.totals.disbursed} total={fund.totals.allocated} /></td>
              <td data-label="Status"><StatusBadge status={fund.status} /></td>
              <td className="fm-actions-cell"><button className="fm-row-button" type="button" aria-label={`View ${fund.name}`} onClick={() => setModal({ mode: "view", fund })}><FiEye aria-hidden="true" /> View</button></td>
            </tr>)}</tbody>
          </table></div>}
        </section>

        <section className="fm-panel" aria-labelledby="fm-recent-title">
          <h2 id="fm-recent-title" className="fm-panel-title">Recent fund transactions</h2>
          {data.dashboard.recent.length === 0 ? <p className="fm-muted fm-pad">No transactions yet.</p>
          : <TransactionTable transactions={data.dashboard.recent} showFund />}
        </section>
      </>}
    </div>

    {modal?.mode === "view" && <FundDialog key={`view-${modal.fund.id}`} initial={modal.fund} admin={admin}
      onClose={() => setModal(null)} onAction={(mode, fund, extra) => setModal({ mode, fund, ...extra })} />}
    {(modal?.mode === "create" || modal?.mode === "edit") && <FundFormDialog mode={modal.mode} fund={modal.fund}
      onClose={() => setModal(modal.fund ? { mode: "view", fund: modal.fund } : null)}
      onSave={async (form) => {
        const fund = modal.mode === "create" ? await createFund(form) : await updateFund(modal.fund.id, form);
        saved(fund, modal.mode === "create" ? `${fund.reference} created.` : `${fund.reference} updated.`);
      }} />}
    {modal?.mode === "transaction" && <TransactionDialog fund={modal.fund} type={modal.type}
      onClose={() => setModal({ mode: "view", fund: modal.fund })}
      onSave={async (form) => {
        const fund = await addFundTransaction(modal.fund.id, { ...form, type: modal.type });
        saved(fund, `${modal.type} of ${peso(form.amount)} recorded for ${form.program}.`);
      }} />}
    {modal?.mode === "void" && <ReasonDialog title="Void transaction" required
      subtitle={`${modal.transaction.type} of ${peso(modal.transaction.amount)} · ${modal.transaction.program}`}
      lead="The transaction stays in the history, marked as voided, and no longer counts toward balances."
      label="Reason for voiding" submitLabel="Void transaction" danger
      onClose={() => setModal({ mode: "view", fund: modal.fund })}
      onSave={async (reason) => saved(await voidFundTransaction(modal.fund.id, modal.transaction.id, reason), "Transaction voided.")} />}
    {modal?.mode === "close" && <ReasonDialog title="Close fund" subtitle={`${modal.fund.reference} · ${modal.fund.name}`}
      lead={`No more transactions can be recorded until it is reopened. Remaining balance: ${peso(modal.fund.totals.remaining)}.`}
      label="Remarks" submitLabel="Close fund"
      onClose={() => setModal({ mode: "view", fund: modal.fund })}
      onSave={async (remarks) => saved(await closeFund(modal.fund.id, remarks), `${modal.fund.reference} closed.`)} />}
    {modal?.mode === "reopen" && <ReasonDialog title="Reopen fund" required subtitle={`${modal.fund.reference} · ${modal.fund.name}`}
      lead="Explain why this fund needs to accept transactions again." label="Reason for reopening" submitLabel="Reopen fund"
      onClose={() => setModal({ mode: "view", fund: modal.fund })}
      onSave={async (remarks) => saved(await reopenFund(modal.fund.id, remarks), `${modal.fund.reference} reopened.`)} />}
  </section>;
}

function TransactionTable({ transactions, showFund = false, onVoid }) {
  return <div className="fm-table-wrap"><table className="fm-table fm-table--tx">
    <thead><tr>
      <th scope="col">Date</th>{showFund && <th scope="col">Fund</th>}<th scope="col">Type</th><th scope="col">Program</th>
      <th scope="col">Details</th><th scope="col" className="num">Amount</th><th scope="col">Recorded by</th>
      {onVoid && <th scope="col"><span className="fm-sr-only">Actions</span></th>}
    </tr></thead>
    <tbody>{transactions.map((t) => <tr key={t.id} className={t.voidedAt ? "is-voided" : undefined}>
      <td data-label="Date" className="fm-nowrap">{formatDate(t.date)}</td>
      {showFund && <td data-label="Fund"><div className="fm-stack"><span>{t.fundReference}</span><small>{t.fundName}</small></div></td>}
      <td data-label="Type"><TypeBadge type={t.type} voided={Boolean(t.voidedAt)} /></td>
      <td data-label="Program">{t.program}</td>
      <td data-label="Details"><div className="fm-stack">
        {t.recipient && <span>{TYPE_INFO[t.type]?.recipientLabel || "To"}: {t.recipient}</span>}
        {t.linkedRecord && <small className="fm-linked">Paid for {t.linkedRecord}</small>}
        {t.referenceNo && <small>Ref. {t.referenceNo}</small>}
        {t.description && <small>{t.description}</small>}
        {t.voidedAt && <small className="fm-void-note">Voided by {t.voidedBy || "unknown"} on {formatDate(t.voidedAt)}: {t.voidReason}</small>}
        {!t.recipient && !t.referenceNo && !t.description && !t.voidedAt && <span className="fm-muted">—</span>}
      </div></td>
      <td data-label="Amount" className="num fm-amount">{peso(t.amount)}</td>
      <td data-label="Recorded by">{t.recordedBy || "—"}</td>
      {onVoid && <td className="fm-actions-cell">{!t.voidedAt && <button className="fm-row-button fm-row-button--danger" type="button" aria-label={`Void ${t.type} of ${peso(t.amount)}`} onClick={() => onVoid(t)}><FiXCircle aria-hidden="true" /> Void</button>}</td>}
    </tr>)}</tbody>
  </table></div>;
}

function FundDialog({ initial, admin, onClose, onAction }) {
  const [fund, setFund] = useState(initial);
  const [loadError, setLoadError] = useState("");

  // List rows don't include transactions; load the full fund.
  useEffect(() => {
    let cancelled = false;
    getFund(initial.id)
      .then((detail) => { if (!cancelled) setFund(detail); })
      .catch((error) => { if (!cancelled) setLoadError(error.message || "Failed to load fund details."); });
    return () => { cancelled = true; };
  }, [initial.id]);

  const { totals } = fund;
  const active = fund.status === "Active";
  const segments = [
    { key: "disbursed", label: "Disbursed", value: totals.disbursed },
    { key: "onhand", label: "Released, not yet disbursed", value: totals.onHand },
    { key: "unreleased", label: "Allocated, not yet released", value: totals.unreleased },
  ];

  return <ModalDialog prefix="fm" title={fund.name} subtitle={`${fund.reference} · ${fund.category} · FY ${fund.fiscalYear}`} wide onClose={onClose}>
    <div className="fm-dialog-body">
      {loadError && <div className="fm-message fm-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{loadError}</span></div>}

      <div className="fm-detail-head">
        <StatusBadge status={fund.status} />
        <span className="fm-muted">Source: {fund.source} · Created {formatDate(fund.createdAt)}{fund.createdBy ? ` by ${fund.createdBy}` : ""}{fund.closedAt ? ` · Closed ${formatDate(fund.closedAt)}` : ""}</span>
      </div>

      <div className="fm-balance">
        <div className="fm-balance-figures">
          <div><span>Allocated</span><strong>{peso(totals.allocated)}</strong></div>
          <div><span>Released</span><strong>{peso(totals.released)}</strong></div>
          <div><span>Disbursed</span><strong>{peso(totals.disbursed)}</strong></div>
          <div className="fm-balance-remaining"><span>Remaining</span><strong>{peso(totals.remaining)}</strong></div>
        </div>
        {totals.allocated > 0 && <>
          <div className="fm-stack-bar" role="img" aria-label={segments.map((s) => `${s.label}: ${peso(s.value)}`).join(", ")}>
            {segments.filter((s) => s.value > 0).map((s) => <span key={s.key} className={`fm-seg fm-seg--${s.key}`} style={{ width: `${percent(s.value, totals.allocated)}%` }} title={`${s.label}: ${peso(s.value)}`} />)}
          </div>
          <ul className="fm-legend">
            {segments.map((s) => <li key={s.key}><span className={`fm-swatch fm-seg--${s.key}`} aria-hidden="true" />{s.label}<strong>{peso(s.value)}</strong></li>)}
          </ul>
        </>}
      </div>

      {fund.remarks && <><h3 className="fm-section-title">Remarks</h3><p className="fm-remarks">{fund.remarks}</p></>}

      <h3 className="fm-section-title">By program</h3>
      {!fund.byProgram ? <p className="fm-muted">Loading…</p>
      : fund.byProgram.length === 0 ? <p className="fm-muted">Nothing allocated yet.{admin && active ? " Use Allocate funds to assign budget to a program." : ""}</p>
      : <div className="fm-table-wrap"><table className="fm-table">
        <thead><tr><th scope="col">Program</th><th scope="col" className="num">Allocated</th><th scope="col" className="num">Can release</th><th scope="col" className="num">Can disburse</th><th scope="col" className="num">Disbursed</th><th scope="col" className="num">Remaining</th></tr></thead>
        <tbody>{fund.byProgram.map((row) => <tr key={row.program}>
          <th scope="row">{row.program}</th>
          <td className="num">{peso(row.allocated)}</td>
          <td className="num">{peso(row.unreleased)}</td>
          <td className="num">{peso(row.onHand)}</td>
          <td className="num">{peso(row.disbursed)}</td>
          <td className="num"><strong>{peso(row.remaining)}</strong></td>
        </tr>)}</tbody>
      </table></div>}

      <h3 className="fm-section-title">Fund history</h3>
      {!fund.transactions ? <p className="fm-muted">Loading…</p>
      : fund.transactions.length === 0 ? <p className="fm-muted">No transactions yet.</p>
      : <TransactionTable transactions={fund.transactions} onVoid={admin && active ? (transaction) => onAction("void", fund, { transaction }) : undefined} />}
    </div>
    <footer className="fm-dialog-footer">
      {admin && (active
        ? <button className="fm-button fm-button--ghost" type="button" onClick={() => onAction("close", fund)}><FiLock aria-hidden="true" /> Close fund</button>
        : <button className="fm-button fm-button--ghost" type="button" onClick={() => onAction("reopen", fund)}><FiUnlock aria-hidden="true" /> Reopen</button>)}
      {admin && active && <button className="fm-button fm-button--ghost" type="button" onClick={() => onAction("edit", fund)}><FiEdit2 aria-hidden="true" /> Edit</button>}
      <span className="fm-spacer" />
      {active && fund.byProgram && <>
        {admin && <button className="fm-button fm-button--secondary" type="button" onClick={() => onAction("transaction", fund, { type: "Allocation" })}><FiArrowDownCircle aria-hidden="true" /> Allocate</button>}
        <button className="fm-button fm-button--secondary" type="button" disabled={totals.unreleased <= 0} title={totals.unreleased <= 0 ? "Nothing allocated is waiting to be released." : undefined} onClick={() => onAction("transaction", fund, { type: "Release" })}><FiSend aria-hidden="true" /> Release</button>
        <button className="fm-button fm-button--primary" type="button" disabled={totals.onHand <= 0} title={totals.onHand <= 0 ? "Release funds before recording a disbursement." : undefined} onClick={() => onAction("transaction", fund, { type: "Disbursement" })}><FiArrowUpCircle aria-hidden="true" /> Disburse</button>
      </>}
      {!active && <button className="fm-button fm-button--secondary" type="button" onClick={onClose}>Close</button>}
    </footer>
  </ModalDialog>;
}

function FundFormDialog({ mode, fund, onClose, onSave }) {
  const creating = mode === "create";
  const [form, setForm] = useState(() => ({
    name: fund?.name || "",
    source: fund?.source || "",
    category: fund?.category || "Pension",
    fiscalYear: String(fund?.fiscalYear || new Date().getFullYear()),
    remarks: fund?.remarks || "",
    initialAllocation: "",
    allocationDate: todayISO(),
  }));
  const [errors, setErrors] = useState({});
  const { saving, saveError, submit, clearError } = useSubmit(onSave);

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = "Enter the fund name.";
    if (!form.source.trim()) next.source = "Enter where the fund comes from.";
    if (!/^\d{4}$/.test(form.fiscalYear) || form.fiscalYear < 2000 || form.fiscalYear > 2100) next.fiscalYear = "Enter a year from 2000 to 2100.";
    const amount = form.initialAllocation.trim() ? cleanAmount(form.initialAllocation) : "";
    if (creating && form.initialAllocation.trim() && !amount) next.initialAllocation = "Enter a peso amount greater than 0 with up to 2 decimals.";
    if (creating && amount && (!form.allocationDate || form.allocationDate > todayISO())) next.allocationDate = "Choose a date that is today or earlier.";
    setErrors(next);
    if (Object.keys(next).length) return;
    submit({ ...form, name: form.name.trim(), source: form.source.trim(), remarks: form.remarks.trim(), initialAllocation: amount });
  }

  return <ModalDialog prefix="fm" title={creating ? "New fund" : "Edit fund"} subtitle={creating ? "A reference number is assigned automatically." : `${fund.reference} · changes are recorded in the Activity Log`} onClose={onClose}>
    <form className="fm-form" noValidate onSubmit={handleSubmit}>
      <div className="fm-dialog-body">
        {saveError && <div className="fm-message fm-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        <div className="fm-form-grid">
          <Field name="name" label="Fund name" required error={errors.name} wide>
            <input id="fm-name" data-initial-focus maxLength={255} value={form.name} aria-invalid={Boolean(errors.name)} onChange={(event) => set("name", event.target.value)} placeholder="e.g. Social Pension 2026" />
          </Field>
          <Field name="source" label="Fund source" required error={errors.source}>
            <input id="fm-source" maxLength={255} value={form.source} aria-invalid={Boolean(errors.source)} onChange={(event) => set("source", event.target.value)} placeholder="e.g. DSWD, Municipal LGU, Barangay" />
          </Field>
          <Field name="fiscalYear" label="Fiscal year" required error={errors.fiscalYear}>
            <input id="fm-fiscalYear" inputMode="numeric" maxLength={4} value={form.fiscalYear} aria-invalid={Boolean(errors.fiscalYear)} onChange={(event) => set("fiscalYear", event.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field name="category" label="Category" required wide>
            <select id="fm-category" value={form.category} onChange={(event) => set("category", event.target.value)}>
              {CATEGORIES.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          {creating && <>
            <Field name="initialAllocation" label="Initial allocation (₱)" error={errors.initialAllocation} hint={`Allocated to ${form.category}. You can allocate more later.`}>
              <input id="fm-initialAllocation" inputMode="decimal" value={form.initialAllocation} aria-invalid={Boolean(errors.initialAllocation)} onChange={(event) => set("initialAllocation", event.target.value)} placeholder="0.00" />
            </Field>
            <Field name="allocationDate" label="Allocation date" required={Boolean(form.initialAllocation.trim())} error={errors.allocationDate}>
              <input id="fm-allocationDate" type="date" max={todayISO()} value={form.allocationDate} aria-invalid={Boolean(errors.allocationDate)} onChange={(event) => set("allocationDate", event.target.value)} />
            </Field>
          </>}
          <Field name="remarks" label="Remarks" wide>
            <textarea id="fm-remarks" rows={3} maxLength={1000} value={form.remarks} onChange={(event) => set("remarks", event.target.value)} />
          </Field>
        </div>
      </div>
      <footer className="fm-dialog-footer">
        <span className="fm-spacer" />
        <button className="fm-button fm-button--secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="fm-button fm-button--primary" type="submit" disabled={saving}><FiCheck aria-hidden="true" />{saving ? "Saving…" : creating ? "Create fund" : "Save changes"}</button>
      </footer>
    </form>
  </ModalDialog>;
}

function TransactionDialog({ fund, type, onClose, onSave }) {
  const info = TYPE_INFO[type];
  const programs = useMemo(() => fund.byProgram || [], [fund.byProgram]);

  // Release/disburse only from programs that have money at that stage.
  const choices = type === "Allocation"
    ? CATEGORIES
    : programs.filter((row) => (type === "Release" ? row.unreleased : row.onHand) > 0).map((row) => row.program);

  const [form, setForm] = useState(() => ({
    program: type === "Allocation" ? fund.category : choices[0] || "",
    amount: "",
    date: todayISO(),
    referenceNo: "",
    recipient: "",
    description: "",
  }));
  const [errors, setErrors] = useState({});
  const { saving, saveError, submit, clearError } = useSubmit(onSave);

  const row = programs.find((item) => item.program === form.program);
  const available = type === "Release" ? row?.unreleased ?? 0 : type === "Disbursement" ? row?.onHand ?? 0 : null;

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const next = {};
    const amount = cleanAmount(form.amount);
    if (!form.program) next.program = "Choose a program.";
    if (!amount) next.amount = "Enter a peso amount greater than 0 with up to 2 decimals.";
    else if (available !== null && Number(amount) > available) next.amount = `Only ${peso(available)} is available for ${form.program}.`;
    if (!form.date || form.date > todayISO()) next.date = "Choose a date that is today or earlier.";
    setErrors(next);
    if (Object.keys(next).length) return;
    submit({ ...form, amount, referenceNo: form.referenceNo.trim(), recipient: form.recipient.trim(), description: form.description.trim() });
  }

  return <ModalDialog prefix="fm" title={info.verb} subtitle={`${fund.reference} · ${fund.name}`} onClose={onClose}>
    <form className="fm-form" noValidate onSubmit={handleSubmit}>
      <div className="fm-dialog-body">
        <p className="fm-lead">{info.hint}</p>
        {saveError && <div className="fm-message fm-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        {choices.length === 0 ? <p className="fm-muted">No program has money at this stage. {type === "Release" ? "Allocate funds first." : "Release funds first."}</p>
        : <div className="fm-form-grid">
          <Field name="program" label="Program" required error={errors.program}>
            <select id="fm-program" data-initial-focus value={form.program} onChange={(event) => set("program", event.target.value)}>
              {choices.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field name="amount" label="Amount (₱)" required error={errors.amount} hint={available !== null ? `Available: ${peso(available)}` : undefined}>
            <input id="fm-amount" inputMode="decimal" value={form.amount} aria-invalid={Boolean(errors.amount)} onChange={(event) => set("amount", event.target.value)} placeholder="0.00" />
          </Field>
          <Field name="date" label="Date" required error={errors.date}>
            <input id="fm-date" type="date" max={todayISO()} value={form.date} aria-invalid={Boolean(errors.date)} onChange={(event) => set("date", event.target.value)} />
          </Field>
          <Field name="referenceNo" label="Reference no." hint="Voucher, check, OR or document number">
            <input id="fm-referenceNo" maxLength={255} value={form.referenceNo} onChange={(event) => set("referenceNo", event.target.value)} />
          </Field>
          {info.recipientLabel && <Field name="recipient" label={info.recipientLabel} wide>
            <input id="fm-recipient" maxLength={255} value={form.recipient} onChange={(event) => set("recipient", event.target.value)} placeholder={type === "Disbursement" ? "Senior, claimant or supplier" : "Office or person receiving the funds"} />
          </Field>}
          <Field name="description" label="Description" wide>
            <textarea id="fm-description" rows={2} maxLength={1000} value={form.description} onChange={(event) => set("description", event.target.value)} />
          </Field>
        </div>}
      </div>
      <footer className="fm-dialog-footer">
        <span className="fm-spacer" />
        <button className="fm-button fm-button--secondary" type="button" onClick={onClose}>Back</button>
        <button className="fm-button fm-button--primary" type="submit" disabled={saving || choices.length === 0}><FiCheck aria-hidden="true" />{saving ? "Saving…" : info.verb}</button>
      </footer>
    </form>
  </ModalDialog>;
}

function ReasonDialog({ title, subtitle, lead, label, submitLabel, required = false, danger = false, onClose, onSave }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const { saving, saveError, submit, clearError } = useSubmit(onSave);

  function handleSubmit(event) {
    event.preventDefault();
    if (required && !text.trim()) { setError("This field is required."); return; }
    submit(text.trim());
  }

  return <ModalDialog prefix="fm" title={title} subtitle={subtitle} onClose={onClose}>
    <form className="fm-form" noValidate onSubmit={handleSubmit}>
      <div className="fm-dialog-body">
        <p className="fm-lead">{lead}</p>
        {saveError && <div className="fm-message fm-message--error" role="alert"><FiAlertCircle aria-hidden="true" /><span>{saveError}</span></div>}
        <Field name="reason" label={label} required={required} error={error} wide>
          <textarea id="fm-reason" data-initial-focus rows={3} maxLength={1000} value={text} aria-invalid={Boolean(error)} onChange={(event) => { setText(event.target.value); setError(""); clearError(); }} />
        </Field>
      </div>
      <footer className="fm-dialog-footer">
        <span className="fm-spacer" />
        <button className="fm-button fm-button--secondary" type="button" onClick={onClose}>Back</button>
        <button className={`fm-button ${danger ? "fm-button--danger" : "fm-button--primary"}`} type="submit" disabled={saving}><FiCheck aria-hidden="true" />{saving ? "Saving…" : submitLabel}</button>
      </footer>
    </form>
  </ModalDialog>;
}
