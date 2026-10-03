import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getApplications,
  updateApplication,
  deleteApplication,
} from "../services/api";
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiEye,
  FiFileText,
  FiInbox,
  FiMoreVertical,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiUsers,
  FiX,
  FiXCircle,
} from "react-icons/fi";
import "./DocumentVerification.css";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

// Each required document, and the fields Laravel sends for it.
// If your API also returns a file link (for example valid_id_url), the
// "View" button opens it. Without a link the button stays disabled.
const DOC_TEMPLATE = [
  {
    key: "validId",
    name: "Valid ID",
    description: "Passport, driver's license or other government ID",
    uploadedField: "valid_id_uploaded",
    urlField: "valid_id_url",
  },
  {
    key: "birthCert",
    name: "Birth certificate",
    description: "Issued by PSA or the local civil registrar",
    uploadedField: "birth_certificate_uploaded",
    urlField: "birth_certificate_url",
  },
  {
    key: "proofResidence",
    name: "Proof of residence",
    description: "Barangay certificate or utility bill",
    uploadedField: "proof_residence_uploaded",
    urlField: "proof_residence_url",
  },
  {
    key: "photo",
    name: "2x2 photo",
    description: "Recent photo with a white background",
    uploadedField: "photo_uploaded",
    urlField: "photo_url",
  },
];

const PAGE_SIZE = 8;
const MIN_SENIOR_AGE = 60;
const MIN_REASON_LENGTH = 5;
const SKELETON_ROWS = [0, 1, 2, 3, 4];
const TOAST_DURATION = 4500;
const DAY = 24 * 60 * 60 * 1000;

const TABS = ["All", "Pending", "Verified", "Rejected"];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name (A to Z)" },
];

const DOC_FILTERS = [
  { value: "All", label: "Any documents" },
  { value: "Complete", label: "All uploaded" },
  { value: "Incomplete", label: "Missing documents" },
];

const STATUS_CLASS = {
  Pending: "pending",
  Verified: "verified",
  Rejected: "rejected",
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function initials(name) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const AVATAR_TONES = ["tone-1", "tone-2", "tone-3", "tone-4", "tone-5"];

function avatarTone(id) {
  const number = Number(id);
  const index = Number.isFinite(number) ? Math.abs(number) : 0;
  return AVATAR_TONES[index % AVATAR_TONES.length];
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return { date: "-", time: "" };
  }

  return {
    date: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

function formatBirthday(value) {
  if (!value) return "-";

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatPurok(value) {
  if (!value) return "-";
  return /^\d+$/.test(String(value).trim()) ? `Purok ${value}` : String(value);
}

// How long a pending application has been waiting for a decision.
function waitingInfo(applicant) {
  if (applicant.status !== "Pending") return null;

  const submitted = new Date(applicant.submittedAt).getTime();
  if (Number.isNaN(submitted)) return null;

  const days = Math.max(0, Math.floor((Date.now() - submitted) / DAY));
  const label = days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
  const tone = days >= 7 ? "late" : days >= 3 ? "slow" : "ok";

  return { label, tone };
}

function documentsTone(uploaded, total) {
  if (uploaded === total) return "complete";
  if (uploaded >= total - 1) return "partial";
  return "low";
}

function buildDocuments(row) {
  return DOC_TEMPLATE.map((doc) => ({
    key: doc.key,
    name: doc.name,
    description: doc.description,
    uploaded: Boolean(row[doc.uploadedField]),
    url: row[doc.urlField] || "",
  }));
}

// Converts a Laravel application row into the shape this page uses.
function normalizeApplication(row) {
  const age =
    row.age === null || row.age === undefined || row.age === ""
      ? null
      : Number(row.age);

  return {
    id: row.id,
    appId: row.application_id || "",
    name: row.name || "Unnamed applicant",
    submittedAt: row.submitted_at,
    status: row.status || "Pending",
    contact: row.contact || "",
    purok: row.purok || "",
    age: Number.isNaN(age) ? null : age,
    birthdayKey: row.birth_date ? String(row.birth_date).slice(0, 10) : "",
    birthday: formatBirthday(row.birth_date),
    documents: buildDocuments(row),
    notes: row.notes || "",
    history: Array.isArray(row.history) ? row.history : [],
  };
}

function duplicateKey(applicant) {
  if (!applicant.birthdayKey) return "";
  return `${applicant.name.trim().toLowerCase()}|${applicant.birthdayKey}`;
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

function StatusBadge({ status }) {
  return (
    <span className={`dv-badge ${STATUS_CLASS[status] || "pending"}`}>
      <span className="dv-badge-dot" />
      {status}
    </span>
  );
}

// A "more actions" menu. It is positioned with fixed coordinates so the
// scrollable table never clips it.
function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (open) {
      close();
      return;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    const estimatedHeight = items.length * 42 + 16;
    const openUp = window.innerHeight - rect.bottom < estimatedHeight + 12;

    setPosition(
      openUp
        ? {
            bottom: window.innerHeight - rect.top + 6,
            right: window.innerWidth - rect.right,
          }
        : {
            top: rect.bottom + 6,
            right: window.innerWidth - rect.right,
          }
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;

    menuRef.current?.querySelector("button:not(:disabled)")?.focus();

    const handlePointer = (event) => {
      if (
        menuRef.current?.contains(event.target) ||
        buttonRef.current?.contains(event.target)
      ) {
        return;
      }
      close();
    };

    const handleKey = (event) => {
      if (event.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  const handleMenuKey = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    const buttons = Array.from(
      menuRef.current.querySelectorAll("button:not(:disabled)")
    );
    if (buttons.length === 0) return;

    const index = buttons.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length].focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="dv-icon-btn dv-more-btn"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        <FiMoreVertical />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="dv-menu"
          role="menu"
          style={position}
          onKeyDown={handleMenuKey}
        >
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} className="dv-menu-divider" role="separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`dv-menu-item${item.tone ? ` ${item.tone}` : ""}`}
                onClick={() => {
                  close();
                  item.onClick();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            )
          )}
        </div>
      )}
    </>
  );
}

function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  busy,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape" && !busy) onCancel();
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onCancel]);

  return (
    <div
      className="dv-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="dv-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dv-dialog-title"
      >
        <div className="dv-dialog-body">
          <span className="dv-dialog-icon">
            <FiAlertTriangle />
          </span>
          <div>
            <h2 id="dv-dialog-title">{title}</h2>
            <p>{children}</p>
          </div>
        </div>

        <div className="dv-dialog-actions">
          <button
            type="button"
            className="dv-btn dv-btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dv-btn dv-btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Review drawer                                                              */
/* -------------------------------------------------------------------------- */

function ApplicantPanel({ applicant, duplicates, onClose, onDecision }) {
  const [tab, setTab] = useState("Documents");
  const [notes, setNotes] = useState(applicant.notes || "");
  const [noteError, setNoteError] = useState("");
  const [saving, setSaving] = useState("");
  const noteRef = useRef(null);

  // Reset the drawer only when a different applicant is opened, so saving
  // one applicant never wipes what the reviewer is typing.
  const [openedId, setOpenedId] = useState(applicant.id);
  if (openedId !== applicant.id) {
    setOpenedId(applicant.id);
    setTab("Documents");
    setNotes(applicant.notes || "");
    setNoteError("");
    setSaving("");
  }

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, saving]);

  const submitted = formatDateTime(applicant.submittedAt);
  const total = applicant.documents.length;
  const uploadedCount = applicant.documents.filter((doc) => doc.uploaded).length;
  const missing = applicant.documents.filter((doc) => !doc.uploaded);
  const complete = missing.length === 0;
  const underAge = applicant.age !== null && applicant.age < MIN_SENIOR_AGE;

  const warnings = [];

  if (underAge) {
    warnings.push(
      `Age is ${applicant.age}. Senior citizen eligibility starts at ${MIN_SENIOR_AGE}.`
    );
  }

  if (duplicates.length > 0) {
    warnings.push(
      `Possible duplicate: ${duplicates
        .map((other) => other.appId || other.name)
        .join(", ")} has the same name and birthday.`
    );
  }

  const commit = async (status) => {
    if (status === "Rejected" && notes.trim().length < MIN_REASON_LENGTH) {
      setNoteError("Add a reason so the senior knows what to fix.");
      noteRef.current?.focus();
      return;
    }

    setSaving(status);
    const saved = await onDecision(applicant.id, status, notes.trim());
    setSaving("");

    if (saved) onClose();
  };

  return (
    <aside
      className="dv-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dv-drawer-title"
    >
      <header className="dv-drawer-header">
        <div className="dv-drawer-profile">
          <span className={`dv-avatar dv-avatar-lg ${avatarTone(applicant.id)}`}>
            {initials(applicant.name)}
          </span>
          <div className="dv-drawer-heading">
            <h2 id="dv-drawer-title">{applicant.name}</h2>
            <span className="dv-muted">{applicant.appId || "No application ID"}</span>
            <span className="dv-muted">
              Submitted {submitted.date}
              {submitted.time && ` at ${submitted.time}`}
            </span>
          </div>
        </div>

        <div className="dv-drawer-top">
          <StatusBadge status={applicant.status} />
          <button
            type="button"
            className="dv-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>
      </header>

      <div className="dv-drawer-tabs" role="tablist">
        {["Documents", "Details", "History"].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`dv-drawer-tab${tab === name ? " active" : ""}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="dv-drawer-body">
        {warnings.length > 0 && (
          <div className="dv-warnings" role="alert">
            {warnings.map((warning) => (
              <p key={warning}>
                <FiAlertTriangle aria-hidden="true" />
                {warning}
              </p>
            ))}
          </div>
        )}

        {tab === "Documents" && (
          <section>
            <div className="dv-section-head">
              <h3>Required documents</h3>
              <span
                className={`dv-docs ${documentsTone(uploadedCount, total)}`}
              >
                {uploadedCount} of {total} uploaded
              </span>
            </div>

            <ul className="dv-doc-list">
              {applicant.documents.map((doc) => (
                <li className="dv-doc" key={doc.key}>
                  <span className={`dv-doc-icon${doc.uploaded ? " done" : ""}`}>
                    {doc.uploaded ? <FiCheckCircle /> : <FiClock />}
                  </span>

                  <div className="dv-doc-text">
                    <strong>{doc.name}</strong>
                    <small>{doc.description}</small>
                  </div>

                  <div className="dv-doc-side">
                    <span
                      className={`dv-doc-state${
                        doc.uploaded ? " uploaded" : " missing"
                      }`}
                    >
                      {doc.uploaded ? "Uploaded" : "Missing"}
                    </span>

                    {doc.uploaded && doc.url ? (
                      <a
                        className="dv-btn dv-btn-secondary dv-btn-sm"
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FiEye />
                        View
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="dv-btn dv-btn-secondary dv-btn-sm"
                        disabled
                        title={
                          doc.uploaded
                            ? "Preview is not available yet."
                            : "Nothing to view. This document was not uploaded."
                        }
                      >
                        <FiEye />
                        View
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "Details" && (
          <section>
            <div className="dv-section-head">
              <h3>Applicant details</h3>
            </div>

            <dl className="dv-details">
              <div>
                <dt>Contact number</dt>
                <dd>{applicant.contact || "-"}</dd>
              </div>
              <div>
                <dt>Purok</dt>
                <dd>{formatPurok(applicant.purok)}</dd>
              </div>
              <div>
                <dt>Age</dt>
                <dd>{applicant.age ?? "-"}</dd>
              </div>
              <div>
                <dt>Birthday</dt>
                <dd>{applicant.birthday}</dd>
              </div>
            </dl>
          </section>
        )}

        {tab === "History" && (
          <section>
            <div className="dv-section-head">
              <h3>Activity</h3>
            </div>

            {applicant.history.length === 0 ? (
              <p className="dv-muted">No activity recorded yet.</p>
            ) : (
              <ol className="dv-timeline">
                {[...applicant.history].reverse().map((entry, index) => (
                  <li key={`${entry.date}-${index}`}>
                    <span className="dv-timeline-dot" />
                    <div>
                      <strong>{entry.action}</strong>
                      <small>{entry.date}</small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      <footer className="dv-drawer-footer">
        <div className={`dv-field${noteError ? " has-error" : ""}`}>
          <label htmlFor="dv-note">
            Decision note{" "}
            <span className="dv-optional">(required when rejecting)</span>
          </label>
          <textarea
            id="dv-note"
            ref={noteRef}
            rows={2}
            maxLength={250}
            placeholder="Example: Valid ID is blurry. Please upload a clear photo."
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setNoteError("");
            }}
            aria-invalid={Boolean(noteError)}
            aria-describedby={noteError ? "dv-note-error" : undefined}
          />
          <div className="dv-note-meta">
            {noteError ? (
              <p className="dv-field-error" id="dv-note-error">
                <FiAlertCircle aria-hidden="true" />
                {noteError}
              </p>
            ) : (
              <span />
            )}
            <span className="dv-muted">{notes.length} / 250</span>
          </div>
        </div>

        {!complete && (
          <p className="dv-hint">
            Missing: {missing.map((doc) => doc.name).join(", ")}. Approval unlocks
            when every document is uploaded. Reject with a reason so the senior
            can resubmit.
          </p>
        )}

        <div className="dv-drawer-actions">
          <button
            type="button"
            className="dv-btn dv-btn-reject"
            onClick={() => commit("Rejected")}
            disabled={Boolean(saving) || applicant.status === "Rejected"}
          >
            <FiXCircle />
            {saving === "Rejected" ? "Rejecting..." : "Reject"}
          </button>
          <button
            type="button"
            className="dv-btn dv-btn-primary"
            onClick={() => commit("Verified")}
            disabled={
              Boolean(saving) || !complete || applicant.status === "Verified"
            }
            title={complete ? undefined : "Every document must be uploaded first."}
          >
            <FiCheckCircle />
            {saving === "Verified" ? "Approving..." : "Approve"}
          </button>
        </div>
      </footer>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DocumentVerification() {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((key) => key + 1);
  };

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [docFilter, setDocFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef(new Map());

  // Clear any pending toast timers when leaving the page.
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  /* ------------------------------ Data loading ----------------------------- */

  useEffect(() => {
    let cancelled = false;

    getApplications()
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : data?.data || [];
        setApplicants(rows.map(normalizeApplication));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load applications:", error);
        setLoadError(error.message || "Failed to load applications.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Go back to page 1 whenever the filters change.
  const filterKey = JSON.stringify([search, activeTab, docFilter, sortBy]);
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  if (pageFilterKey !== filterKey) {
    setPageFilterKey(filterKey);
    setCurrentPage(1);
  }

  /* ------------------------------ Derived data ----------------------------- */

  const counts = useMemo(
    () => ({
      All: applicants.length,
      Pending: applicants.filter((a) => a.status === "Pending").length,
      Verified: applicants.filter((a) => a.status === "Verified").length,
      Rejected: applicants.filter((a) => a.status === "Rejected").length,
    }),
    [applicants]
  );

  const duplicateGroups = useMemo(() => {
    const groups = new Map();

    applicants.forEach((applicant) => {
      const key = duplicateKey(applicant);
      if (!key) return;
      groups.set(key, [...(groups.get(key) || []), applicant]);
    });

    return groups;
  }, [applicants]);

  const duplicatesOf = (applicant) => {
    const key = duplicateKey(applicant);
    if (!key) return [];
    return (duplicateGroups.get(key) || []).filter(
      (other) => other.id !== applicant.id
    );
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    const rows = applicants.filter((applicant) => {
      if (activeTab !== "All" && applicant.status !== activeTab) return false;

      const uploaded = applicant.documents.filter((d) => d.uploaded).length;
      const isComplete = uploaded === applicant.documents.length;

      if (docFilter === "Complete" && !isComplete) return false;
      if (docFilter === "Incomplete" && isComplete) return false;

      if (!query) return true;

      return (
        applicant.name.toLowerCase().includes(query) ||
        applicant.appId.toLowerCase().includes(query) ||
        String(applicant.purok).toLowerCase().includes(query)
      );
    });

    return [...rows].sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }

      const diff = new Date(a.submittedAt) - new Date(b.submittedAt);
      return sortBy === "newest" ? -diff : diff;
    });
  }, [applicants, activeTab, docFilter, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const selectedApplicant =
    applicants.find((applicant) => applicant.id === selectedId) || null;

  const hasFilters =
    Boolean(search.trim()) || activeTab !== "All" || docFilter !== "All";

  const showTable = loading || (!loadError && filtered.length > 0);

  /* -------------------------------- Toasts --------------------------------- */

  const dismissToast = (id) => {
    clearTimeout(toastTimers.current.get(id));
    toastTimers.current.delete(id);
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  };

  const pushToast = (message, type = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((previous) => [...previous, { id, message, type }]);
    toastTimers.current.set(
      id,
      setTimeout(() => dismissToast(id), TOAST_DURATION)
    );
  };

  /* -------------------------------- Actions -------------------------------- */

  const clearFilters = () => {
    setSearch("");
    setActiveTab("All");
    setDocFilter("All");
  };

  const closePanel = useCallback(() => setSelectedId(null), []);

  // Returns true when the server saved the decision, so the drawer only
  // closes (and only reports success) when it really worked.
  const handleDecision = async (id, status, notes) => {
    const target = applicants.find((applicant) => applicant.id === id);
    if (!target) return false;

    const now = new Date();
    const stamp = `${now.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })} · ${now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;

    // Your API currently expects the browser to send the history list.
    // Later, move this to Laravel so the server records who decided and when.
    const history = [
      ...target.history,
      { date: stamp, action: `Marked as ${status}` },
    ];

    try {
      const updated = await updateApplication(id, { status, notes, history });

      setApplicants((previous) =>
        previous.map((applicant) =>
          applicant.id === id
            ? {
                ...applicant,
                status: updated?.status || status,
                notes: updated?.notes ?? notes,
                history: Array.isArray(updated?.history)
                  ? updated.history
                  : history,
              }
            : applicant
        )
      );

      pushToast(
        status === "Verified"
          ? `${target.name} was verified.`
          : `${target.name} was rejected.`
      );
      return true;
    } catch (error) {
      console.error("Failed to update application:", error);
      pushToast(
        error.message || "Unable to save the decision. Please try again.",
        "error"
      );
      return false;
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);

    try {
      await deleteApplication(deleteTarget.id);

      setApplicants((previous) =>
        previous.filter((applicant) => applicant.id !== deleteTarget.id)
      );
      if (selectedId === deleteTarget.id) setSelectedId(null);
      pushToast(`${deleteTarget.name}'s application was deleted.`);
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete application:", error);
      pushToast(
        error.message || "Unable to delete the application. Please try again.",
        "error"
      );
    } finally {
      setDeleting(false);
    }
  };

  /* -------------------------------- Render --------------------------------- */

  const statCards = [
    {
      key: "total",
      label: "Total applications",
      value: counts.All,
      note: "All submissions",
      tone: "green",
      icon: <FiUsers />,
    },
    {
      key: "pending",
      label: "Pending review",
      value: counts.Pending,
      note: "Waiting for a decision",
      tone: "amber",
      icon: <FiClock />,
    },
    {
      key: "verified",
      label: "Verified",
      value: counts.Verified,
      note: "Documents approved",
      tone: "blue",
      icon: <FiCheckCircle />,
    },
    {
      key: "rejected",
      label: "Rejected",
      value: counts.Rejected,
      note: "Needs resubmission",
      tone: "red",
      icon: <FiXCircle />,
    },
  ];

  const pageNumbers = useMemo(() => {
    if (totalPages <= 6) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const wanted = new Set([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
    const sorted = [...wanted]
      .filter((number) => number >= 1 && number <= totalPages)
      .sort((a, b) => a - b);

    const result = [];
    sorted.forEach((number, index) => {
      if (index > 0 && number - sorted[index - 1] > 1) result.push("...");
      result.push(number);
    });

    return result;
  }, [totalPages, page]);

  return (
    <div className="doc-verification">
      {/* Heading */}
      <header className="dv-heading">
        <div className="dv-title-row">
          <div>
            <span className="dv-eyebrow">People and records</span>
            <h1>Document Verification</h1>
            <p>Check the documents seniors submit, then approve or reject them.</p>
          </div>
        </div>
      </header>

      {/* Summary */}
      <div className="dv-stats">
        {statCards.map((card) => (
          <div className="dv-stat" key={card.key}>
            <span className={`dv-stat-icon ${card.tone}`}>{card.icon}</span>
            <div className="dv-stat-text">
              <span className="dv-stat-label">{card.label}</span>
              <strong>{loading ? "–" : card.value}</strong>
              <small>{card.note}</small>
            </div>
          </div>
        ))}
      </div>

      {/* Table panel */}
      <section className="dv-panel">
        <div className="dv-tabs" role="tablist" aria-label="Filter by status">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={activeTab === name}
              className={`dv-tab${activeTab === name ? " active" : ""}`}
              onClick={() => setActiveTab(name)}
            >
              {name}
              <span className="dv-tab-count">{loading ? "–" : counts[name]}</span>
            </button>
          ))}
        </div>

        <div className="dv-toolbar">
          <div className="dv-search">
            <FiSearch aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by name, ID or purok"
              aria-label="Search applications"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                className="dv-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <FiX />
              </button>
            )}
          </div>

          <select
            aria-label="Filter by documents"
            value={docFilter}
            onChange={(event) => setDocFilter(event.target.value)}
          >
            {DOC_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Sort applications"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              className="dv-btn dv-btn-ghost dv-btn-sm"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Error state */}
        {!loading && loadError && (
          <div className="dv-state" role="alert">
            <span className="dv-state-icon error">
              <FiAlertCircle />
            </span>
            <h3>Applications could not be loaded</h3>
            <p>{loadError}</p>
            <button
              type="button"
              className="dv-btn dv-btn-secondary"
              onClick={reload}
            >
              <FiRefreshCw />
              Try again
            </button>
          </div>
        )}

        {/* Empty states */}
        {!loading && !loadError && filtered.length === 0 && (
          <div className="dv-state">
            <span className="dv-state-icon">
              <FiInbox />
            </span>
            {applicants.length === 0 ? (
              <>
                <h3>No applications yet</h3>
                <p>
                  Applications that seniors submit will appear here for review.
                </p>
              </>
            ) : (
              <>
                <h3>No matching applications</h3>
                <p>Try a different search or clear the filters.</p>
                <button
                  type="button"
                  className="dv-btn dv-btn-secondary"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        )}

        {/* Table */}
        {showTable && (
          <div className="dv-table-wrap">
            <table className="dv-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th className="dv-col-hide-sm">Submitted</th>
                  <th>Documents</th>
                  <th>Status</th>
                  <th className="dv-col-hide-sm">Waiting</th>
                  <th className="dv-actions-head">Action</th>
                </tr>
              </thead>

              <tbody>
                {loading &&
                  SKELETON_ROWS.map((row) => (
                    <tr key={row} aria-hidden="true">
                      <td>
                        <div className="dv-applicant">
                          <span className="dv-skeleton dv-skeleton-avatar" />
                          <span className="dv-skeleton dv-skeleton-line" />
                        </div>
                      </td>
                      <td className="dv-col-hide-sm">
                        <span className="dv-skeleton dv-skeleton-line" />
                      </td>
                      <td>
                        <span className="dv-skeleton dv-skeleton-pill" />
                      </td>
                      <td>
                        <span className="dv-skeleton dv-skeleton-pill" />
                      </td>
                      <td className="dv-col-hide-sm">
                        <span className="dv-skeleton dv-skeleton-line short" />
                      </td>
                      <td />
                    </tr>
                  ))}

                {!loading &&
                  pageRows.map((applicant) => {
                    const submitted = formatDateTime(applicant.submittedAt);
                    const uploaded = applicant.documents.filter(
                      (doc) => doc.uploaded
                    ).length;
                    const totalDocs = applicant.documents.length;
                    const waiting = waitingInfo(applicant);
                    const pending = applicant.status === "Pending";

                    return (
                      <tr
                        key={applicant.id}
                        className={selectedId === applicant.id ? "selected" : ""}
                      >
                        <td>
                          <button
                            type="button"
                            className="dv-applicant dv-applicant-link"
                            onClick={() => setSelectedId(applicant.id)}
                            title="Open application"
                          >
                            <span
                              className={`dv-avatar ${avatarTone(applicant.id)}`}
                            >
                              {initials(applicant.name)}
                            </span>
                            <span className="dv-applicant-text">
                              <strong>{applicant.name}</strong>
                              <small>{applicant.appId || "No ID"}</small>
                            </span>
                          </button>
                        </td>

                        <td className="dv-col-hide-sm">
                          <span className="dv-date">{submitted.date}</span>
                          <span className="dv-time">{submitted.time}</span>
                        </td>

                        <td>
                          <span
                            className={`dv-docs ${documentsTone(
                              uploaded,
                              totalDocs
                            )}`}
                          >
                            <FiFileText />
                            {uploaded} of {totalDocs}
                          </span>
                        </td>

                        <td>
                          <StatusBadge status={applicant.status} />
                        </td>

                        <td className="dv-col-hide-sm">
                          {waiting ? (
                            <span className={`dv-wait ${waiting.tone}`}>
                              {waiting.label}
                            </span>
                          ) : (
                            <span className="dv-faint">-</span>
                          )}
                        </td>

                        <td>
                          <div className="dv-actions">
                            <button
                              type="button"
                              className={`dv-btn dv-btn-sm ${
                                pending ? "dv-btn-primary" : "dv-btn-secondary"
                              }`}
                              onClick={() => setSelectedId(applicant.id)}
                            >
                              {pending ? "Review" : "View"}
                            </button>

                            <RowMenu
                              label={`More actions for ${applicant.name}`}
                              items={[
                                {
                                  key: "view",
                                  label: "View details",
                                  icon: <FiEye />,
                                  onClick: () => setSelectedId(applicant.id),
                                },
                                { key: "divider", divider: true },
                                {
                                  key: "delete",
                                  label: "Delete application",
                                  icon: <FiTrash2 />,
                                  tone: "danger",
                                  onClick: () => setDeleteTarget(applicant),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer: count + pagination */}
        {!loading && !loadError && filtered.length > 0 && (
          <div className="dv-footer">
            <span className="dv-muted">
              Showing {pageStart + 1} to{" "}
              {Math.min(pageStart + PAGE_SIZE, filtered.length)} of{" "}
              {filtered.length}{" "}
              {filtered.length === 1 ? "application" : "applications"}
            </span>

            {totalPages > 1 && (
              <div className="dv-pagination">
                <button
                  type="button"
                  className="dv-page-btn"
                  onClick={() => setCurrentPage(page - 1)}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  <FiChevronLeft />
                </button>

                {pageNumbers.map((number, index) =>
                  number === "..." ? (
                    <span key={`dots-${index}`} className="dv-page-dots">
                      ...
                    </span>
                  ) : (
                    <button
                      key={number}
                      type="button"
                      className={`dv-page-btn${number === page ? " active" : ""}`}
                      onClick={() => setCurrentPage(number)}
                      aria-current={number === page ? "page" : undefined}
                    >
                      {number}
                    </button>
                  )
                )}

                <button
                  type="button"
                  className="dv-page-btn"
                  onClick={() => setCurrentPage(page + 1)}
                  disabled={page === totalPages}
                  aria-label="Next page"
                >
                  <FiChevronRight />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Review drawer */}
      {selectedApplicant && (
        <>
          <div className="dv-backdrop" onClick={closePanel} />
          <ApplicantPanel
            applicant={selectedApplicant}
            duplicates={duplicatesOf(selectedApplicant)}
            onClose={closePanel}
            onDecision={handleDecision}
          />
        </>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete this application?"
          confirmLabel="Delete application"
          busyLabel="Deleting..."
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          {deleteTarget.name}'s application and its review history will be
          removed. This cannot be undone.
        </ConfirmDialog>
      )}

      {/* Toasts */}
      <div className="dv-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`dv-toast ${toast.type}`}>
            {toast.type === "error" ? <FiAlertCircle /> : <FiCheckCircle />}
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
            >
              <FiX />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}