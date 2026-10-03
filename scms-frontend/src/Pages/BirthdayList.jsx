import { useState, useMemo, useEffect } from "react";
import { getSeniorCitizens } from "../services/api";
import {
  FiSearch,
  FiChevronLeft,
  FiChevronRight,
  FiEye,
  FiPrinter,
  FiDownload,
  FiCalendar,
  FiGift,
  FiBell,
  FiX,
  FiCheckCircle,
} from "react-icons/fi";
import { PiCakeDuotone } from "react-icons/pi";
import { TbConfetti } from "react-icons/tb";
import "./BirthdayList.css";

/* ---------------------------------------------------------------- */
/* Reference "today" for this demo dataset. In a real app, swap      */
/* every use of TODAY for `new Date()`.                              */
/* ---------------------------------------------------------------- */
const TODAY = new Date();
const CURRENT_MONTH = TODAY.getMonth() + 1;
const CURRENT_YEAR = TODAY.getFullYear();

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ---------------------------------------------------------------- */
/* Date helpers                                                      */
/* ---------------------------------------------------------------- */

function daysUntilBirthday(month, day) {
  let next = new Date(CURRENT_YEAR, month - 1, day);
  const todayMidnight = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  if (next < todayMidnight) next = new Date(CURRENT_YEAR + 1, month - 1, day);
  return Math.round((next - todayMidnight) / 86400000);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatShortDate(month, day) {
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${day}`;
}

function formatFullBirthday(month, day, birthYear) {
  return `${MONTH_NAMES[month - 1]} ${day}, ${birthYear}`;
}

function statusLabel(daysUntil) {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil <= 7) return `In ${daysUntil} Days`;
  return null; // far away — caller falls back to a formatted date
}

function statusTone(daysUntil) {
  if (daysUntil === 0) return "tone-today";
  if (daysUntil === 1) return "tone-tomorrow";
  if (daysUntil <= 7) return "tone-soon";
  return "tone-later";
}

const CELEBRATION_TONE = {
  "Gift Distributed": "tone-green",
  "Greeting Sent": "tone-blue",
  Pending: "tone-amber",
};

function downloadCSV(filename, rows) {
  const header = [
    "Senior ID", "Full Name", "Birthday", "Age Turning", "Barangay", "Contact Number", "Celebration Status",
  ];
  const csvRows = rows.map((s) => [
   formatFullBirthday(s.birthMonth, s.birthDay, s.birthYear),
    s.age, s.barangay, s.contact, s.celebration,
  ]);
  const csv = [header, ...csvRows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- */
/* Greeting generator                                                 */
/* ---------------------------------------------------------------- */

function GreetingGenerator({ seniors }) {
  const [selectedId, setSelectedId] = useState("");
  const [greeting, setGreeting] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = () => {
    const senior = seniors.find((s) => String(s.id) === selectedId);
    if (!senior) return;
    const turningAge = ordinal(senior.age);
    setGreeting(
      `Happy ${turningAge} Birthday, ${senior.name}! 🎉 Wishing you continued good health, happiness, and many more blessings ahead. — Senior Citizen Management System`
    );
    setCopied(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(greeting);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — fail silently
    }
  };

  return (
    <div className="panel greeting-panel">
      <h3>
        <FiGift className="panel-header-icon" /> Birthday Greeting Generator
      </h3>
      <p className="greeting-sub">Select a senior and generate a birthday greeting.</p>

      <div className="greeting-controls">
        <select
          className="select-input"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setGreeting("");
          }}
        >
          <option value="">Select Senior</option>
          {seniors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary" onClick={generate} disabled={!selectedId}>
          <PiCakeDuotone /> Generate Greeting
        </button>
      </div>

      {greeting && (
        <div className="greeting-output">
          <p>{greeting}</p>
          <button type="button" className="btn-outline btn-sm" onClick={copy}>
            {copied ? <FiCheckCircle /> : <FiDownload />}
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Notification settings modal                                       */
/* ---------------------------------------------------------------- */

function NotificationModal({ settings, onSave, onClose }) {
  const [local, setLocal] = useState(settings);

  const toggle = (key) => setLocal((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Notification Settings</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            <FiX />
          </button>
        </div>

        <div className="notif-options">
          <label className="checkbox-row">
            <input type="checkbox" checked={local.sevenDays} onChange={() => toggle("sevenDays")} />
            Notify 7 days before birthday
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={local.threeDays} onChange={() => toggle("threeDays")} />
            Notify 3 days before birthday
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={local.onDay} onChange={() => toggle("onDay")} />
            Notify on the birthday
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onSave(local);
              onClose();
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Senior detail modal (row "view" action)                           */
/* ---------------------------------------------------------------- */

function SeniorDetailModal({ senior, onClose }) {
  if (!senior) return null;
  const daysUntil = daysUntilBirthday(senior.birthMonth, senior.birthDay);
  const label = statusLabel(daysUntil) || formatShortDate(senior.birthMonth, senior.birthDay);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{senior.name}</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            <FiX />
          </button>
        </div>

        <div className="details-rows">
          <div className="details-row">
            <span>Senior ID</span>
            <strong>{senior.seniorId}</strong>
          </div>
          <div className="details-row">
            <span>Birthday</span>
            <strong>{formatFullBirthday(senior.birthMonth,senior.birthDay,senior.birthYear)}</strong>
          </div>
          <div className="details-row">
            <span>Age Turning</span>
            <strong>{senior.age}</strong>
          </div>
          <div className="details-row">
            <span>Barangay</span>
            <strong>{senior.barangay}</strong>
          </div>
          <div className="details-row">
            <span>Contact Number</span>
            <strong>{senior.contact}</strong>
          </div>
          <div className="details-row">
            <span>Birthday Status</span>
            <span className={`badge ${statusTone(daysUntil)}`}>{label}</span>
          </div>
          <div className="details-row">
            <span>Celebration Status</span>
            <span className={`badge ${CELEBRATION_TONE[senior.celebration]}`}>{senior.celebration}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Main component                                                     */
/* ---------------------------------------------------------------- */

const PAGE_SIZE = 5;

export default function BirthdayList() {
  const [seniors, setSeniors] = useState([]);

useEffect(() => {
  getSeniorCitizens()
    .then((data) => {
      const formattedSeniors = data
        .filter((r) => r.birth_date)
        .map((r) => {
          const birthDate = String(r.birth_date).slice(0, 10);
          const [birthYear, birthMonth, birthDay] = birthDate
            .split("-")
            .map(Number);

          return {
            id: r.id,
            seniorId: r.senior_id,
            name: r.name,
            birthYear,
            birthMonth,
            birthDay,
            age: r.age,
            barangay: r.purok,
            contact: r.contact || "",
            celebration: "Pending",
            daysUntil: daysUntilBirthday(birthMonth, birthDay),
          };
        });

      setSeniors(formattedSeniors);
    })
    .catch((error) => {
      console.error("Failed to load birthday list:", error);
    });
}, []);

  const [searchName, setSearchName] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailSenior, setDetailSenior] = useState(null);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifSettings, setNotifSettings] = useState({ sevenDays: true, threeDays: true, onDay: true });
  const [todayFilterOnly, setTodayFilterOnly] = useState(false);

  // Go back to page 1 whenever the filters change.
  const filterKey = JSON.stringify([searchName, todayFilterOnly]);
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  if (pageFilterKey !== filterKey) {
    setPageFilterKey(filterKey);
    setCurrentPage(1);
  }

  const todaysCelebrants = useMemo(() => seniors.filter((s) => s.daysUntil === 0), [seniors]);
  const upcoming = useMemo(
    () =>
      seniors
        .filter((s) => s.daysUntil > 0)
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .slice(0, 4),
    [seniors]
  );

  const stats = useMemo(
    () => ({
      today: seniors.filter((s) => s.daysUntil === 0).length,
      thisWeek: seniors.filter((s) => s.daysUntil <= 6).length,
      thisMonth: seniors.filter((s) => s.birthMonth === CURRENT_MONTH).length,
      next7Days: seniors.filter((s) => s.daysUntil >= 1 && s.daysUntil <= 7).length,
    }),
    [seniors]
  );

  const filtered = useMemo(() => {
    let list = seniors;

    if (todayFilterOnly) list = list.filter((s) => s.daysUntil === 0);

    if (searchName.trim()) {
      const q = searchName.trim().toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }

    list = [...list].sort((a, b) => a.daysUntil - b.daysUntil);

    return list;
  }, [seniors, searchName, todayFilterOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const notifText = () => {
    const parts = [];
    if (notifSettings.sevenDays) parts.push("7 days before");
    if (notifSettings.threeDays) parts.push("3 days before");
    if (notifSettings.onDay) parts.push("on the birthday");
    if (parts.length === 0) return "Notifications are currently turned off.";
    return `You will be notified ${parts.join(", ")}.`;
  };

  return (
    <div className="birthday-list">
      {/* Heading */}
      <div className="bl-heading">
        <div className="bl-heading-left">
          <div>
            <span className="bl-eyebrow">Communication</span>
            <h1>Birthday List</h1>
            <p>View and manage birthdays of our beloved senior citizens.</p>
          </div>
        </div>

        <div className="bl-heading-controls">
          <button type="button" className="btn-outline" onClick={() => downloadCSV("birthday-list.csv", filtered)}>
            <FiDownload /> Export
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            <FiPrinter /> Print Birthday List
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="bl-stats">
        <div className="stat-card">
          <span className="stat-icon tone-green">
            <PiCakeDuotone />
          </span>
          <div className="stat-body">
            <span className="stat-label">Birthdays Today</span>
            <span className="stat-value">{stats.today}</span>
            <span className="stat-sublabel">Celebrants today</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon tone-amber">
            <TbConfetti />
          </span>
          <div className="stat-body">
            <span className="stat-label">Birthdays This Week</span>
            <span className="stat-value">{stats.thisWeek}</span>
            <span className="stat-sublabel">Within 7 days</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon tone-green">
            <FiCalendar />
          </span>
          <div className="stat-body">
            <span className="stat-label">Birthdays This Month</span>
            <span className="stat-value">{stats.thisMonth}</span>
            <span className="stat-sublabel">This month</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon tone-green">
            <FiGift />
          </span>
          <div className="stat-body">
            <span className="stat-label">Upcoming (Next 7 Days)</span>
            <span className="stat-value">{stats.next7Days}</span>
            <span className="stat-sublabel">Next 7 days</span>
          </div>
        </div>
      </div>

      <div className="bl-body">
        <div className="bl-main">
          {/* Today's celebrants */}
          <section className="panel">
            <div className="panel-header">
              <h2>🎉 Today's Celebrants</h2>
              <button type="button" className="btn-outline btn-sm" onClick={() => setTodayFilterOnly((v) => !v)}>
                {todayFilterOnly ? "Show All" : `View All (${todaysCelebrants.length})`}
              </button>
            </div>

            <div className="celebrant-grid">
              {todaysCelebrants.map((s) => (
                <div className="celebrant-card" key={s.id}>
                  <span className="celebrant-avatar">{s.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}</span>
                  <div>
                    <span className="celebrant-name">{s.name}</span>
                    <span className="celebrant-age">{s.age} years old</span>
                    <span className="celebrant-barangay">{s.barangay}</span>
                    <span className="celebrant-tag">🎉 Happy Birthday!</span>
                  </div>
                </div>
              ))}
              {todaysCelebrants.length === 0 && (
                <div className="empty-state">No birthdays today.</div>
              )}
            </div>
          </section>

    

          {/* Table */}
         <section className="panel">
  <div className="birthday-list-toolbar">
    <div>
      <h2 className="filters-title">Birthday List</h2>
      <p className="birthday-list-subtitle">
        Browse and manage senior citizen birthdays.
      </p>
    </div>

    <div className="search-box birthday-search">
      <input
        type="text"
        placeholder="Search by name..."
        value={searchName}
        onChange={(e) => setSearchName(e.target.value)}
      />
      <FiSearch />
    </div>
  </div>
            <div className="table-scroll">
              <table className="bl-table">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Senior ID</th>
                    <th>Full Name</th>
                    <th>Birthday</th>
                    <th>Age Turning</th>
                    <th>Barangay</th>
                    <th>Contact Number</th>
                    <th>Birthday Status</th>
                    <th>Celebration Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((s) => {
                    const label = statusLabel(s.daysUntil) || formatShortDate(s.birthMonth, s.birthDay);
                    return (
                      <tr key={s.id}>
                        <td>
                          <span className="row-avatar">
                            {s.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                          </span>
                        </td>
                        <td>{s.seniorId}</td>
                        <td className="row-name">{s.name}</td>
                        <td>{formatFullBirthday(s.birthMonth, s.birthDay, CURRENT_YEAR - s.age)}</td>
                        <td>{s.age}</td>
                        <td>{s.barangay}</td>
                        <td>{s.contact}</td>
                        <td>
                          <span className={`badge ${statusTone(s.daysUntil)}`}>{label}</span>
                        </td>
                        <td>
                          <span className={`badge ${CELEBRATION_TONE[s.celebration]}`}>{s.celebration}</span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="icon-square"
                              title="View"
                              onClick={() => setDetailSenior(s)}
                            >
                              <FiEye />
                            </button>
                            <button
                              type="button"
                              className="icon-square"
                              title="Export this record"
                              onClick={() => downloadCSV(`${s.seniorId}.csv`, [s])}
                            >
                              <FiPrinter />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {paginated.length === 0 && (
                    <tr>
                      <td colSpan={10} className="empty-row">
                        No records match your search or filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bl-pagination">
              <span className="pagination-summary">
                Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to{" "}
                {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} records
              </span>
              <div className="pagination-controls">
                <button
                  type="button"
                  className="page-btn"
                  disabled={page === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <FiChevronLeft />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce((acc, p, idx, arr) => {
                    if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "..." ? (
                      <span key={`dots-${idx}`} className="page-dots">
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        className={`page-btn${p === page ? " active" : ""}`}
                        onClick={() => setCurrentPage(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  type="button"
                  className="page-btn"
                  disabled={page === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  <FiChevronRight />
                </button>
              </div>
            </div>
          </section>
            <div className="bl-side">
           <section className="panel">
            <div className="panel-header">
              <h2>
                <FiGift className="panel-header-icon" /> Upcoming Birthdays
              </h2>
            </div>

            <div className="upcoming-list">
              {upcoming.map((s) => (
                <div className="upcoming-row" key={s.id}>
                  <span className="upcoming-dot" />
                  <span className="upcoming-icon">
                    <FiCalendar />
                  </span>
                  <span className="upcoming-label">
                    {s.daysUntil === 1 ? "Tomorrow" : s.daysUntil <= 7 ? `In ${s.daysUntil} Days` : "Next Week"}
                  </span>
                  <span className="upcoming-name">{s.name}</span>
                  <span className="upcoming-age">{s.age} years old</span>
                </div>
              ))}
            </div>
          </section>

       
          <GreetingGenerator seniors={seniors} />
        </div>
      </div>

      {detailSenior && <SeniorDetailModal senior={detailSenior} onClose={() => setDetailSenior(null)} />}
      {notifModalOpen && (
        <NotificationModal
          settings={notifSettings}
          onSave={setNotifSettings}
          onClose={() => setNotifModalOpen(false)}
        />
      )}
      
    </div>
       {/* Notification bar */}
          <section className="notification-bar">
            <FiBell />
            <span>{notifText()}</span>
            <button type="button" className="btn-outline btn-sm" onClick={() => setNotifModalOpen(true)}>
              Manage Notification Settings
            </button>
          </section>
        </div>
  );
}
