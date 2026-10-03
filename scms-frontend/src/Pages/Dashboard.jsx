import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TbActivity,
  TbAlertCircle,
  TbCake,
  TbCalendar,
  TbChartBar,
  TbChevronRight,
  TbCircleCheck,
  TbCircleX,
  TbClock,
  TbCurrencyPeso,
  TbFileCheck,
  TbFlower,
  TbFolder,
  TbId,
  TbLifebuoy,
  TbList,
  TbMedicalCross,
  TbSpeakerphone,
  TbUsers,
  TbWallet,
} from "react-icons/tb";
import { getDashboardSummary } from "../services/api";
import { formatDate } from "../utils/dates";
import "./Dashboard.css";

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

function number(value) {
  return Number(value || 0).toLocaleString("en-PH");
}

// "5 min ago", measured from when the summary was loaded.
function timeAgo(value, now) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((now - date.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatDate(value);
}

const STATUS_TONE = { Pending: "pending", Verified: "good", Rejected: "bad" };

/**
 * One card per sidebar page. The title button opens that page; its ::after
 * stretches over the card so the whole card is clickable.
 */
function ModuleCard({ icon: Icon, title, to, value, caption, rows = [], children }) {
  const navigate = useNavigate();
  return <article className="db-card">
    <header className="db-card-head">
      <span className="db-card-icon"><Icon strokeWidth={1.8} aria-hidden="true" /></span>
      <h3><button type="button" className="db-card-link" onClick={() => navigate(to)}>{title}</button></h3>
      <TbChevronRight className="db-card-arrow" strokeWidth={1.8} aria-hidden="true" />
    </header>
    {value !== undefined && <p className="db-card-figure"><strong>{value}</strong><span>{caption}</span></p>}
    {rows.length > 0 && <dl className="db-card-rows">
      {rows.map(([label, rowValue, tone]) => <div key={label} className={tone ? `db-row db-row--${tone}` : "db-row"}>
        <dt>{label}</dt><dd>{rowValue}</dd>
      </div>)}
    </dl>}
    {children}
  </article>;
}

function Group({ title, children }) {
  return <section className="db-group" aria-label={title}>
    <h2 className="db-group-title">{title}</h2>
    <div className="db-grid">{children}</div>
  </section>;
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDashboardSummary()
      .then((result) => { if (!cancelled) { setSummary(result); setLoadedAt(Date.now()); setError(""); } })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || "Failed to load the dashboard."); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const s = summary;
  const today = new Date().toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return <div className="scms-dashboard">
    <header className="db-page-header">
      <div>
        <span className="db-eyebrow">Overview</span>
        <h1>Dashboard</h1>
        <p className="db-subtitle">A summary of every part of the system. Select a card to open that page.</p>
      </div>
      <span className="db-date"><TbCalendar strokeWidth={1.8} aria-hidden="true" />{today}</span>
    </header>

    {error && <div className="db-message" role="alert">
      <TbAlertCircle strokeWidth={1.8} aria-hidden="true" /><span>{error}</span>
      <button type="button" className="db-text-button" onClick={() => { setError(""); setReloadKey((key) => key + 1); }}>Try again</button>
    </div>}

    {/* Applications: the same four counts as before, without percentages. */}
    <section className="db-stats" aria-label="Applications">
      {[
        ["Total applicants", s?.applications.total, TbList],
        ["Pending", s?.applications.pending, TbClock],
        ["Verified", s?.applications.verified, TbCircleCheck, "good"],
        ["Rejected", s?.applications.rejected, TbCircleX],
      ].map(([label, value, Icon, tone]) => <div key={label} className="db-stat">
        <span className="db-stat-label"><Icon strokeWidth={1.8} aria-hidden="true" />{label}</span>
        <span className={`db-stat-value${tone ? ` db-stat-value--${tone}` : ""}`}>{s ? number(value) : "—"}</span>
      </div>)}
    </section>

    {!s ? !error && <p className="db-loading" aria-live="polite">Loading summary…</p> : <>
      <Group title="People and records">
        <ModuleCard icon={TbUsers} title="User Management" to="/user-management"
          value={number(s.users.total)} caption="user accounts"
          rows={[["Active", number(s.users.active)], ["Administrators", number(s.users.administrators)], ["Deactivated", number(s.users.inactive)]]} />
        <ModuleCard icon={TbFileCheck} title="Document Verification" to="/document-verification"
          value={number(s.applications.pending)} caption="waiting for review">
          {s.applications.recent.length === 0 ? <p className="db-empty">No applications yet.</p>
          : <ul className="db-list">
            {s.applications.recent.slice(0, 3).map((a) => <li key={a.id}>
              <span className="db-list-main">{a.name}<small>{formatDate(a.submitted_at)}</small></span>
              <span className={`db-pill db-pill--${STATUS_TONE[a.status] || "pending"}`}>{a.status}</span>
            </li>)}
          </ul>}
        </ModuleCard>
        <ModuleCard icon={TbFolder} title="Records" to="/records"
          value={number(s.seniors.total)} caption="registered seniors"
          rows={[["Active", number(s.seniors.active)], ["Needs follow-up or attention", number(s.seniors.needs_attention), s.seniors.needs_attention ? "warn" : null], ["New this month", number(s.seniors.new_this_month)]]} />
        <ModuleCard icon={TbId} title="OSCA IDs" to="/senior-ids"
          value={number(s.senior_ids.active)} caption="active OSCA IDs"
          rows={[["Pending issuance", number(s.senior_ids.pending_issuance)], ["For replacement", number(s.senior_ids.for_replacement)], ["Seniors without an OSCA ID", number(s.senior_ids.without_id), s.senior_ids.without_id ? "warn" : null]]} />
      </Group>

      <Group title="Communication">
        <ModuleCard icon={TbSpeakerphone} title="Announcements" to="/announcements"
          value={number(s.announcements.active)} caption="active announcements">
          {s.announcements.pinned && <p className="db-note"><strong>Pinned:</strong> {s.announcements.pinned}</p>}
          {s.announcements.latest.length > 0 && <ul className="db-list">
            {s.announcements.latest.map((a) => <li key={a.id}><span className="db-list-main">{a.title}<small>{formatDate(a.date)}</small></span></li>)}
          </ul>}
        </ModuleCard>
        <ModuleCard icon={TbCake} title="Birthday List" to="/birthday-list"
          value={number(s.birthdays.today)} caption={s.birthdays.today === 1 ? "birthday today" : "birthdays today"}
          rows={[["In the next 7 days", number(s.birthdays.next_7_days)]]}>
          {s.birthdays.upcoming.length > 0 && <ul className="db-list">
            {s.birthdays.upcoming.map((b) => <li key={b.id}>
              <span className="db-list-main">{b.name}<small>{b.days_until === 0 ? "Today" : formatDate(b.date)} · turning {b.turning}</small></span>
            </li>)}
          </ul>}
        </ModuleCard>
        <ModuleCard icon={TbLifebuoy} title="Help & Complaints" to="/help-desk"
          value={number(s.help.pending + s.help.working)} caption="open cases"
          rows={[["Pending", number(s.help.pending)], ["Working on it", number(s.help.working)], ["Urgent or high priority", number(s.help.urgent_open), s.help.urgent_open ? "warn" : null], ["Assigned to me", number(s.help.mine_open)], ["Fixed / resolved", number(s.help.resolved)]]} />
      </Group>

      <Group title="Program Management">
        <ModuleCard icon={TbWallet} title="Pension" to="/pension"
          value={number(s.pension.released)} caption="pensions released"
          rows={[["Pending", number(s.pension.pending)], ["On hold", number(s.pension.on_hold)], ["All releases", number(s.pension.total)]]} />
        <ModuleCard icon={TbMedicalCross} title="Medical" to="/medical"
          value={number(s.medical.total)} caption="assistance requests"
          rows={[["Pending", number(s.medical.pending)], ["Approved", number(s.medical.approved)], ["Completed", number(s.medical.completed)]]} />
        <ModuleCard icon={TbFlower} title="Burial" to="/burial"
          value={number(s.burial.total)} caption="assistance requests"
          rows={[["Pending", number(s.burial.pending)], ["Approved", number(s.burial.approved)], ["Released", number(s.burial.released)]]} />
        <ModuleCard icon={TbCurrencyPeso} title="Fund Management" to="/funds"
          value={pesoFormat.format(s.funds.remaining)} caption="remaining balance"
          rows={[["Allocated", pesoFormat.format(s.funds.allocated)], ["Disbursed", pesoFormat.format(s.funds.disbursed)], ["Active funds", number(s.funds.active)]]} />
      </Group>

      <Group title="Monitoring">
        <ModuleCard icon={TbChartBar} title="Reports" to="/reports">
          <p className="db-note">Printable summaries of registrations, document verification, programs, OSCA IDs, funds and complaints, with CSV export.</p>
        </ModuleCard>
        <ModuleCard icon={TbActivity} title="Activity Log" to="/activity-log"
          value={number(s.activity.today)} caption="actions recorded today"
          rows={[["Logins today", number(s.activity.logins_today)]]}>
          {s.activity.recent.length > 0 && <ul className="db-list">
            {s.activity.recent.slice(0, 3).map((log) => <li key={log.id}>
              <span className="db-list-main">{log.action}{log.record_label ? ` · ${log.record_label}` : ""}<small>{log.user_name || "Unknown"} · {timeAgo(log.created_at, loadedAt)}</small></span>
            </li>)}
          </ul>}
        </ModuleCard>
      </Group>
    </>}
  </div>;
}
