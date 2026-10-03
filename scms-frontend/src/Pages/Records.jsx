import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getSeniorCitizens,
  createSeniorCitizen,
  deleteSeniorCitizen,
  updateSeniorCitizen,
} from "../services/api";
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiArchive,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiDownload,
  FiEdit2,
  FiEye,
  FiInbox,
  FiMoreVertical,
  FiPlus,
  FiRefreshCw,
  FiRotateCcw,
  FiSearch,
  FiTrash2,
  FiUserCheck,
  FiUsers,
  FiX,
} from "react-icons/fi";
import "./Records.css";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PUROKS = Array.from({ length: 7 }, (_, index) => `Purok ${index + 1}`);
const GENDERS = ["Male", "Female"];
const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const CIVIL_STATUSES = ["Single", "Married", "Widowed", "Separated", "Divorced"];

// Statuses that mean "no longer in the active list".
const ARCHIVED_STATUSES = ["Archived", "Inactive", "Deceased"];

// Old records may still carry these manual statuses. They are shown as
// "Active" with a follow-up mark that staff can clear.
const LEGACY_FLAG_STATUSES = ["Needs follow-up", "Needs attention"];

const MIN_SENIOR_AGE = 60;
const STALE_DAYS = 365;
const PENDING_DAYS = 7;
const PAGE_SIZE = 8;
const SKELETON_ROWS = [0, 1, 2, 3, 4];
const TOAST_DURATION = 4500;
const DAY = 24 * 60 * 60 * 1000;

const TABS = ["All", "Active", "Pending", "Needs attention", "Archived"];

const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name (A to Z)" },
  { value: "age", label: "Age (oldest first)" },
];

const STATUS_CLASS = {
  Active: "active",
  Pending: "pending",
  Inactive: "inactive",
  Deceased: "deceased",
  Archived: "deceased",
};

const EMPTY_FORM = {
  name: "",
  birthDate: "",
  gender: "Male",
  purok: PUROKS[0],
  contact: "",
  bloodType: "",
  condition: "",
  maintenance: "",
  lastCheckup: "",
  civilStatus: "",
  oscaId: "Active",
  emergencyContact: "",
  relationship: "",
};

// Laravel field names mapped back to this form's field names.
const SERVER_FIELD_MAP = {
  name: "name",
  birth_date: "birthDate",
  age: "birthDate",
  gender: "gender",
  purok: "purok",
  contact: "contact",
  blood_type: "bloodType",
  condition: "condition",
  maintenance: "maintenance",
  last_checkup: "lastCheckup",
  civil_status: "civilStatus",
  osca_id: "oscaId",
  emergency_contact: "emergencyContact",
  relationship: "relationship",
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

function formatDateTime(date) {
  if (!date) return { date: "-", time: "" };

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

function formatLongDate(value) {
  if (!value) return "-";

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Age from a YYYY-MM-DD birth date. Returns "" when the date is missing.
function computeAge(birthDate) {
  if (!birthDate) return "";

  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year || !month || !day) return "";

  const today = new Date();
  let age = today.getFullYear() - year;

  if (
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)
  ) {
    age -= 1;
  }

  return age;
}

// Types digits only and shows them as 09XX XXX XXXX.
function formatContactInput(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 11);

  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

function isValidContact(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("09");
}

// Converts a Laravel senior citizen row into the shape this page uses.
function buildRecord(row) {
  const rawStatus = row.status || "Active";
  const legacyFlag = LEGACY_FLAG_STATUSES.includes(rawStatus);
  const status = legacyFlag ? "Active" : rawStatus;

  const updated = row.updated_at ? new Date(row.updated_at) : null;
  const birthDate = row.birth_date ? String(row.birth_date).slice(0, 10) : "";
  const storedAge =
    row.age === null || row.age === undefined || row.age === ""
      ? ""
      : Number(row.age);

  return {
    id: row.id,
    seniorId: row.senior_id || "",
    name: row.name || "Unnamed senior",
    birthDate,
    // Age is worked out from the birth date so it never goes out of date.
    age: birthDate ? computeAge(birthDate) : storedAge,
    gender: row.gender || "",
    purok: row.purok || "",
    contact: row.contact || "",
    status,
    legacyFlag,
    isArchived: ARCHIVED_STATUSES.includes(status),
    lastUpdated: updated && !Number.isNaN(updated.getTime()) ? updated : null,
    bloodType: row.blood_type || "",
    condition: row.condition || "",
    maintenance: row.maintenance || "",
    lastCheckup: row.last_checkup ? String(row.last_checkup).slice(0, 10) : "",
    civilStatus: row.civil_status || "",
    emergencyContact: row.emergency_contact || "",
    relationship: row.relationship || "",
    oscaId: row.osca_id || "Active",
  };
}

function recordToForm(record) {
  return {
    name: record.name,
    birthDate: record.birthDate,
    gender: record.gender || "Male",
    purok: record.purok || PUROKS[0],
    contact: record.contact,
    bloodType: record.bloodType,
    condition: record.condition,
    maintenance: record.maintenance,
    lastCheckup: record.lastCheckup,
    civilStatus: record.civilStatus,
    oscaId: record.oscaId || "Active",
    emergencyContact: record.emergencyContact,
    relationship: record.relationship,
  };
}

function formToPayload(form) {
  return {
    name: form.name.trim(),
    age: Number(computeAge(form.birthDate)),
    birth_date: form.birthDate || null,
    gender: form.gender,
    purok: form.purok,
    contact: form.contact.trim() || null,

    blood_type: form.bloodType || null,
    condition: form.condition.trim() || null,
    maintenance: form.maintenance.trim() || null,
    last_checkup: form.lastCheckup || null,

    civil_status: form.civilStatus || null,
    emergency_contact: form.emergencyContact.trim() || null,
    relationship: form.relationship.trim() || null,
    osca_id: form.oscaId || "Active",
  };
}

// Laravel returns validation problems as { errors: { field: ["message"] } }.
function extractFieldErrors(error) {
  const source = error?.errors || error?.data?.errors;
  if (!source || typeof source !== "object") return {};

  const result = {};

  Object.entries(source).forEach(([field, messages]) => {
    const target = SERVER_FIELD_MAP[field];
    if (!target || result[target]) return;
    result[target] = Array.isArray(messages) ? messages[0] : String(messages);
  });

  return result;
}

function duplicateKey(name, birthDate) {
  if (!birthDate) return "";
  return `${String(name).trim().toLowerCase()}|${birthDate}`;
}

// The reasons a senior needs attention. They are worked out from the data,
// so nobody has to remember to mark a record by hand.
function getFlags(record, duplicateGroups) {
  if (record.isArchived) return [];

  const flags = [];

  if (!record.contact) {
    flags.push({
      key: "contact",
      label: "No contact number",
      detail: "Announcements and calls cannot reach this senior.",
    });
  }

  if (!record.birthDate) {
    flags.push({
      key: "birthdate",
      label: "No birth date",
      detail: "Age and the birthday list depend on the birth date.",
    });
  } else if (record.age !== "" && record.age < MIN_SENIOR_AGE) {
    flags.push({
      key: "age",
      label: `Under ${MIN_SENIOR_AGE} years old`,
      detail: `Senior citizen eligibility starts at ${MIN_SENIOR_AGE}. Check the birth date.`,
    });
  }

  if (!record.emergencyContact) {
    flags.push({
      key: "emergency",
      label: "No emergency contact",
      detail: "Nobody is listed to call in an emergency.",
    });
  }

  if (record.status === "Pending" && record.lastUpdated) {
    const days = Math.floor((Date.now() - record.lastUpdated.getTime()) / DAY);
    if (days >= PENDING_DAYS) {
      flags.push({
        key: "pending",
        label: `Pending for ${days} days`,
        detail: "This registration is still waiting for verification.",
      });
    }
  }

  if (record.lastUpdated) {
    const days = Math.floor((Date.now() - record.lastUpdated.getTime()) / DAY);
    if (days >= STALE_DAYS) {
      flags.push({
        key: "stale",
        label: "Not updated in 12 months",
        detail: "Confirm this senior still lives in the area and details are current.",
      });
    }
  }

  const key = duplicateKey(record.name, record.birthDate);
  const twins = key
    ? (duplicateGroups.get(key) || []).filter((other) => other.id !== record.id)
    : [];

  if (twins.length > 0) {
    flags.push({
      key: "duplicate",
      label: "Possible duplicate",
      detail: `Same name and birth date as ${twins
        .map((other) => other.seniorId || other.name)
        .join(", ")}.`,
    });
  }

  if (record.legacyFlag) {
    flags.push({
      key: "legacy",
      label: "Marked for follow-up",
      detail: "Staff marked this record earlier. Clear the mark once it is handled.",
    });
  }

  return flags;
}

function csvCell(value) {
  let text = String(value ?? "");

  // Stop spreadsheet programs from running text that looks like a formula.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;

  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCSV(filename, rows, flagsById) {
  const header = [
    "Senior ID",
    "Name",
    "Age",
    "Birth date",
    "Gender",
    "Purok",
    "Contact",
    "Status",
    "Needs attention",
    "Last updated",
  ];

  const body = rows.map((record) => [
    record.seniorId,
    record.name,
    record.age,
    record.birthDate,
    record.gender,
    record.purok,
    record.contact,
    record.status,
    (flagsById.get(record.id) || []).map((flag) => flag.label).join("; "),
    record.lastUpdated ? formatDateTime(record.lastUpdated).date : "",
  ]);

  const csv = [header, ...body]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

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

function validateForm(form, { records, editingId }) {
  const errors = {};
  const name = form.name.trim();

  if (!name) {
    errors.name = "Enter the senior's full name.";
  } else if (name.length < 2) {
    errors.name = "Enter at least 2 characters.";
  }

  if (!form.birthDate) {
    errors.birthDate = "Select the birth date.";
  } else if (form.birthDate > todayISO()) {
    errors.birthDate = "The birth date cannot be in the future.";
  } else {
    const age = computeAge(form.birthDate);
    if (age === "" || age < MIN_SENIOR_AGE) {
      errors.birthDate = `Senior citizens must be at least ${MIN_SENIOR_AGE} years old. This person is ${age}.`;
    }
  }

  if (form.contact.trim() && !isValidContact(form.contact)) {
    errors.contact = "Enter an 11-digit mobile number that starts with 09.";
  }

  if (!errors.name && form.birthDate) {
    const key = duplicateKey(name, form.birthDate);
    const match = records.find(
      (record) =>
        record.id !== editingId &&
        duplicateKey(record.name, record.birthDate) === key
    );

    if (match) {
      errors.name = `A record for this person already exists (${match.seniorId}).`;
    }
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

// Renders children into document.body so modals, drawers and menus are never
// clipped by the app layout. The wrapper keeps the page's styles applied.
function Layer({ children }) {
  return createPortal(
    <div className="records-page rp-layer">{children}</div>,
    document.body
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`rp-badge ${STATUS_CLASS[status] || "active"}`}>
      <span className="rp-badge-dot" />
      {status}
    </span>
  );
}

function AttentionCell({ flags }) {
  if (flags.length === 0) return <span className="rp-faint">-</span>;

  const [first, ...rest] = flags;

  return (
    <div
      className="rp-flags"
      title={flags.map((flag) => flag.label).join(", ")}
    >
      <span className="rp-flag">{first.label}</span>
      {rest.length > 0 && <span className="rp-flag more">+{rest.length}</span>}
    </div>
  );
}

// A "more actions" menu, positioned with fixed coordinates.
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
        className="rp-icon-btn rp-more-btn"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        <FiMoreVertical />
      </button>

      {open && (
        <Layer>
          <div
            ref={menuRef}
            className="rp-menu"
            role="menu"
            style={position}
            onKeyDown={handleMenuKey}
          >
            {items.map((item) =>
              item.divider ? (
                <div key={item.key} className="rp-menu-divider" role="separator" />
              ) : (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className={`rp-menu-item${item.tone ? ` ${item.tone}` : ""}`}
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
        </Layer>
      )}
    </>
  );
}

function ModalShell({ title, titleId, onClose, busy, size, children }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onClose]);

  return (
    <Layer>
      <div
        className="rp-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose();
        }}
      >
        <div
          className={`rp-modal${size === "lg" ? " lg" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="rp-modal-header">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="rp-icon-btn"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              <FiX />
            </button>
          </div>
          {children}
        </div>
      </div>
    </Layer>
  );
}

function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div className={`rp-field${error ? " has-error" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="rp-field-error" id={`${htmlFor}-error`}>
          <FiAlertCircle aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p className="rp-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add / edit form                                                            */
/* -------------------------------------------------------------------------- */

function SeniorFormModal({ record, records, onClose, onSave }) {
  const isEdit = Boolean(record);
  const [form, setForm] = useState(() =>
    record ? recordToForm(record) : EMPTY_FORM
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const age = computeAge(form.birthDate);

  const setField = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFormError("");
  };

  const update = (field) => (event) => setField(field, event.target.value);

  const submit = async (event) => {
    event.preventDefault();

    const found = validateForm(form, {
      records,
      editingId: isEdit ? record.id : null,
    });

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      await onSave(form);
    } catch (error) {
      console.error("Failed to save senior:", error);
      const fieldErrors = extractFieldErrors(error);

      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      } else {
        setFormError(error.message || "Unable to save this record.");
      }
      setSaving(false);
    }
  };

  const ariaFor = (field) => ({
    "aria-invalid": Boolean(errors[field]),
    "aria-describedby": errors[field] ? `rp-${field}-error` : undefined,
  });

  return (
    <ModalShell
      title={isEdit ? "Edit senior record" : "Add senior record"}
      titleId="rp-form-title"
      onClose={onClose}
      busy={saving}
      size="lg"
    >
      <form className="rp-form" onSubmit={submit} noValidate>
        <div className="rp-modal-body">
          {formError && (
            <div className="rp-banner" role="alert">
              <FiAlertCircle aria-hidden="true" />
              {formError}
            </div>
          )}

          <section className="rp-form-section">
            <h3>Personal information</h3>

            <Field label="Full name" htmlFor="rp-name" error={errors.name}>
              <input
                id="rp-name"
                type="text"
                value={form.name}
                onChange={update("name")}
                autoFocus
                {...ariaFor("name")}
              />
            </Field>

            <div className="rp-field-row">
              <Field
                label="Birth date"
                htmlFor="rp-birthDate"
                error={errors.birthDate}
              >
                <input
                  id="rp-birthDate"
                  type="date"
                  max={todayISO()}
                  value={form.birthDate}
                  onChange={update("birthDate")}
                  {...ariaFor("birthDate")}
                />
              </Field>

              <Field
                label="Age"
                htmlFor="rp-age"
                hint="Calculated from the birth date."
              >
                <input
                  id="rp-age"
                  type="text"
                  value={age === "" ? "" : `${age} years old`}
                  placeholder="-"
                  readOnly
                />
              </Field>
            </div>

            <div className="rp-field-row">
              <Field label="Gender" htmlFor="rp-gender">
                <select
                  id="rp-gender"
                  value={form.gender}
                  onChange={update("gender")}
                >
                  {GENDERS.map((gender) => (
                    <option key={gender} value={gender}>
                      {gender}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Purok" htmlFor="rp-purok">
                <select
                  id="rp-purok"
                  value={form.purok}
                  onChange={update("purok")}
                >
                  {PUROKS.map((purok) => (
                    <option key={purok} value={purok}>
                      {purok}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label="Contact number"
              htmlFor="rp-contact"
              error={errors.contact}
              hint="Optional. Example: 0917 123 4567"
            >
              <input
                id="rp-contact"
                type="text"
                inputMode="numeric"
                placeholder="09XX XXX XXXX"
                value={form.contact}
                onChange={(event) =>
                  setField("contact", formatContactInput(event.target.value))
                }
                {...ariaFor("contact")}
              />
            </Field>
          </section>

          <section className="rp-form-section">
            <h3>Medical information</h3>

            <div className="rp-field-row">
              <Field label="Blood type" htmlFor="rp-bloodType">
                <select
                  id="rp-bloodType"
                  value={form.bloodType}
                  onChange={update("bloodType")}
                >
                  <option value="">Unknown</option>
                  {BLOOD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Last checkup" htmlFor="rp-lastCheckup">
                <input
                  id="rp-lastCheckup"
                  type="date"
                  max={todayISO()}
                  value={form.lastCheckup}
                  onChange={update("lastCheckup")}
                />
              </Field>
            </div>

            <div className="rp-field-row">
              <Field label="Condition" htmlFor="rp-condition">
                <input
                  id="rp-condition"
                  type="text"
                  placeholder="Example: Hypertension"
                  value={form.condition}
                  onChange={update("condition")}
                />
              </Field>

              <Field label="Maintenance medicine" htmlFor="rp-maintenance">
                <input
                  id="rp-maintenance"
                  type="text"
                  placeholder="Example: Amlodipine"
                  value={form.maintenance}
                  onChange={update("maintenance")}
                />
              </Field>
            </div>
          </section>

          <section className="rp-form-section">
            <h3>Other information</h3>

            <div className="rp-field-row">
              <Field label="Civil status" htmlFor="rp-civilStatus">
                <select
                  id="rp-civilStatus"
                  value={form.civilStatus}
                  onChange={update("civilStatus")}
                >
                  <option value="">Select civil status</option>
                  {CIVIL_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="OSCA ID status" htmlFor="rp-oscaId">
                <select
                  id="rp-oscaId"
                  value={form.oscaId}
                  onChange={update("oscaId")}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </Field>
            </div>

            <div className="rp-field-row">
              <Field label="Emergency contact" htmlFor="rp-emergencyContact">
                <input
                  id="rp-emergencyContact"
                  type="text"
                  placeholder="Full name"
                  value={form.emergencyContact}
                  onChange={update("emergencyContact")}
                />
              </Field>

              <Field
                label="Relationship to senior"
                htmlFor="rp-relationship"
              >
                <input
                  id="rp-relationship"
                  type="text"
                  placeholder="Example: Daughter"
                  value={form.relationship}
                  onChange={update("relationship")}
                />
              </Field>
            </div>
          </section>
        </div>

        <div className="rp-modal-actions">
          <button
            type="button"
            className="rp-btn rp-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="rp-btn rp-btn-primary" disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save changes" : "Add senior"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Archive + delete dialogs                                                   */
/* -------------------------------------------------------------------------- */

const ARCHIVE_REASONS = [
  {
    value: "Inactive",
    title: "Inactive",
    description: "No longer living in the area.",
  },
  {
    value: "Deceased",
    title: "Deceased",
    description: "Has passed away.",
  },
];

function ArchiveDialog({ record, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState("Inactive");

  return (
    <ModalShell
      title="Archive record"
      titleId="rp-archive-title"
      onClose={onClose}
      busy={busy}
    >
      <div className="rp-modal-body">
        <p className="rp-modal-note">
          Why are you archiving <strong>{record.name}</strong>? Archived seniors
          are hidden from the active list and can be restored later.
        </p>

        <div className="rp-reasons" role="radiogroup" aria-label="Archive reason">
          {ARCHIVE_REASONS.map((option) => (
            <label
              key={option.value}
              className={`rp-reason${reason === option.value ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="rp-archive-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
              />
              <span className="rp-reason-text">
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="rp-modal-actions">
        <button
          type="button"
          className="rp-btn rp-btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rp-btn rp-btn-primary"
          onClick={() => onConfirm(reason)}
          disabled={busy}
        >
          {busy ? "Archiving..." : "Archive record"}
        </button>
      </div>
    </ModalShell>
  );
}

function DeleteDialog({ record, busy, onConfirm, onClose }) {
  return (
    <ModalShell
      title="Delete this record?"
      titleId="rp-delete-title"
      onClose={onClose}
      busy={busy}
    >
      <div className="rp-modal-body">
        <p className="rp-modal-note">
          <strong>{record.name}</strong> ({record.seniorId}) will be removed
          permanently. This cannot be undone. If the senior has moved away or
          passed away, archive the record instead so the history is kept.
        </p>
      </div>

      <div className="rp-modal-actions">
        <button
          type="button"
          className="rp-btn rp-btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rp-btn rp-btn-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Deleting..." : "Delete record"}
        </button>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Record drawer                                                              */
/* -------------------------------------------------------------------------- */

function InfoRow({ label, children }) {
  return (
    <div className="rp-info-row">
      <span>{label}</span>
      <strong>{children || "-"}</strong>
    </div>
  );
}

function RecordDrawer({ record, flags, onClose, onEdit, onArchive, onRestore }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const updated = formatDateTime(record.lastUpdated);

  return (
    <Layer>
      <div className="rp-backdrop" onClick={onClose} />
      <aside
        className="rp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-drawer-title"
      >
        <header className="rp-drawer-header">
          <div className="rp-drawer-profile">
            <span className={`rp-avatar rp-avatar-lg ${avatarTone(record.id)}`}>
              {initials(record.name)}
            </span>
            <div className="rp-drawer-heading">
              <h2 id="rp-drawer-title">{record.name}</h2>
              <span className="rp-muted">{record.seniorId}</span>
              <span className="rp-muted">
                Updated {updated.date}
                {updated.time && ` at ${updated.time}`}
              </span>
            </div>
          </div>

          <div className="rp-drawer-top">
            <StatusBadge status={record.status} />
            <button
              type="button"
              className="rp-icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <FiX />
            </button>
          </div>
        </header>

        <div className="rp-drawer-body">
          {flags.length > 0 && (
            <div className="rp-attention" role="alert">
              <h3>
                <FiAlertTriangle aria-hidden="true" />
                Needs attention
              </h3>
              <ul>
                {flags.map((flag) => (
                  <li key={flag.key}>
                    <strong>{flag.label}</strong>
                    <span>{flag.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section className="rp-info">
            <h3>Personal information</h3>
            <InfoRow label="Age">{record.age}</InfoRow>
            <InfoRow label="Birth date">{formatLongDate(record.birthDate)}</InfoRow>
            <InfoRow label="Gender">{record.gender}</InfoRow>
            <InfoRow label="Purok">{record.purok}</InfoRow>
            <InfoRow label="Contact">{record.contact}</InfoRow>
          </section>

          <section className="rp-info">
            <h3>Medical information</h3>
            <InfoRow label="Blood type">{record.bloodType}</InfoRow>
            <InfoRow label="Condition">{record.condition}</InfoRow>
            <InfoRow label="Maintenance">{record.maintenance}</InfoRow>
            <InfoRow label="Last checkup">
              {record.lastCheckup ? formatLongDate(record.lastCheckup) : ""}
            </InfoRow>
          </section>

          <section className="rp-info">
            <h3>Other information</h3>
            <InfoRow label="Civil status">{record.civilStatus}</InfoRow>
            <InfoRow label="Emergency contact">{record.emergencyContact}</InfoRow>
            <InfoRow label="Relationship">{record.relationship}</InfoRow>
            <div className="rp-info-row">
              <span>OSCA ID</span>
              <span
                className={`rp-pill ${record.oscaId === "Active" ? "green" : "gray"}`}
              >
                {record.oscaId}
              </span>
            </div>
          </section>
        </div>

        <footer className="rp-drawer-footer">
          {record.isArchived ? (
            <button
              type="button"
              className="rp-btn rp-btn-secondary"
              onClick={onRestore}
            >
              <FiRotateCcw />
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="rp-btn rp-btn-secondary"
              onClick={onArchive}
            >
              <FiArchive />
              Archive
            </button>
          )}
          <button type="button" className="rp-btn rp-btn-primary" onClick={onEdit}>
            <FiEdit2 />
            Edit record
          </button>
        </footer>
      </aside>
    </Layer>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Records() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [purokFilter, setPurokFilter] = useState("All");
  const [sortBy, setSortBy] = useState("updated");
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedId, setSelectedId] = useState(null);
  const [formModal, setFormModal] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

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

    setLoading(true);
    setLoadError("");

    getSeniorCitizens()
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : data?.data || [];
        setRecords(rows.map(buildRecord));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load senior citizens:", error);
        setLoadError(error.message || "Failed to load records.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab, purokFilter, sortBy]);

  /* ------------------------------ Derived data ----------------------------- */

  const duplicateGroups = useMemo(() => {
    const groups = new Map();

    records.forEach((record) => {
      const key = duplicateKey(record.name, record.birthDate);
      if (!key) return;
      groups.set(key, [...(groups.get(key) || []), record]);
    });

    return groups;
  }, [records]);

  const flagsById = useMemo(() => {
    const map = new Map();
    records.forEach((record) => map.set(record.id, getFlags(record, duplicateGroups)));
    return map;
  }, [records, duplicateGroups]);

  const counts = useMemo(
    () => ({
      All: records.length,
      Active: records.filter((r) => r.status === "Active").length,
      Pending: records.filter((r) => r.status === "Pending").length,
      "Needs attention": records.filter(
        (r) => (flagsById.get(r.id) || []).length > 0
      ).length,
      Archived: records.filter((r) => r.isArchived).length,
    }),
    [records, flagsById]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\D/g, "");

    const rows = records.filter((record) => {
      if (activeTab === "Active" && record.status !== "Active") return false;
      if (activeTab === "Pending" && record.status !== "Pending") return false;
      if (activeTab === "Archived" && !record.isArchived) return false;
      if (
        activeTab === "Needs attention" &&
        (flagsById.get(record.id) || []).length === 0
      ) {
        return false;
      }

      if (purokFilter !== "All" && record.purok !== purokFilter) return false;

      if (!query) return true;

      return (
        record.name.toLowerCase().includes(query) ||
        record.seniorId.toLowerCase().includes(query) ||
        (queryDigits.length >= 3 &&
          record.contact.replace(/\D/g, "").includes(queryDigits))
      );
    });

    return [...rows].sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }

      if (sortBy === "age") {
        return (Number(b.age) || 0) - (Number(a.age) || 0);
      }

      return (b.lastUpdated?.getTime() || 0) - (a.lastUpdated?.getTime() || 0);
    });
  }, [records, flagsById, activeTab, purokFilter, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const selectedRecord =
    records.find((record) => record.id === selectedId) || null;

  const hasFilters =
    Boolean(search.trim()) || activeTab !== "All" || purokFilter !== "All";

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
    setPurokFilter("All");
  };

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  // Throws on failure so the form can show the error next to its fields.
  const saveSenior = async (form) => {
    const payload = formToPayload(form);

    if (formModal?.record) {
      const updated = await updateSeniorCitizen(formModal.record.id, payload);
      const next = buildRecord(updated);

      setRecords((previous) =>
        previous.map((record) => (record.id === next.id ? next : record))
      );
      pushToast(`${next.name}'s record was saved.`);
    } else {
      const created = await createSeniorCitizen(payload);
      const next = buildRecord(created);

      setRecords((previous) => [next, ...previous]);
      // Make sure the new record is visible at the top of the list.
      setSearch("");
      setActiveTab("All");
      setPurokFilter("All");
      setSortBy("updated");
      setCurrentPage(1);
      pushToast(`${next.name} was added.`);
    }

    setFormModal(null);
  };

  const changeStatus = async (record, status, message) => {
    setBusy(true);

    try {
      const updated = await updateSeniorCitizen(record.id, { status });
      const next = buildRecord(updated);

      setRecords((previous) =>
        previous.map((item) => (item.id === next.id ? next : item))
      );
      pushToast(message);
      return true;
    } catch (error) {
      console.error("Failed to change status:", error);
      pushToast(
        error.message || "Unable to update this record. Please try again.",
        "error"
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmArchive = async (status) => {
    if (!archiveTarget) return;

    const saved = await changeStatus(
      archiveTarget,
      status,
      `${archiveTarget.name} was archived as ${status.toLowerCase()}.`
    );

    if (saved) setArchiveTarget(null);
  };

  const restoreRecord = (record) =>
    changeStatus(record, "Active", `${record.name} was restored.`);

  const clearFollowUp = (record) =>
    changeStatus(record, "Active", `Follow-up mark cleared for ${record.name}.`);

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setBusy(true);

    try {
      await deleteSeniorCitizen(deleteTarget.id);

      setRecords((previous) =>
        previous.filter((record) => record.id !== deleteTarget.id)
      );
      if (selectedId === deleteTarget.id) setSelectedId(null);
      pushToast(`${deleteTarget.name}'s record was deleted.`);
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete senior:", error);
      pushToast(
        error.message || "Unable to delete this record. Please try again.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const menuItemsFor = (record) => {
    const items = [
      {
        key: "view",
        label: "View details",
        icon: <FiEye />,
        onClick: () => setSelectedId(record.id),
      },
      {
        key: "edit",
        label: "Edit record",
        icon: <FiEdit2 />,
        onClick: () => setFormModal({ record }),
      },
    ];

    if (record.legacyFlag) {
      items.push({
        key: "resolve",
        label: "Clear follow-up mark",
        icon: <FiCheckCircle />,
        onClick: () => clearFollowUp(record),
      });
    }

    items.push(
      record.isArchived
        ? {
            key: "restore",
            label: "Restore",
            icon: <FiRotateCcw />,
            onClick: () => restoreRecord(record),
          }
        : {
            key: "archive",
            label: "Archive",
            icon: <FiArchive />,
            onClick: () => setArchiveTarget(record),
          },
      { key: "divider", divider: true },
      {
        key: "delete",
        label: "Delete record",
        icon: <FiTrash2 />,
        tone: "danger",
        onClick: () => setDeleteTarget(record),
      }
    );

    return items;
  };

  /* -------------------------------- Render --------------------------------- */

  const statCards = [
    {
      key: "All",
      label: "Total seniors",
      note: "All registered",
      value: counts.All,
      tone: "green",
      icon: <FiUsers />,
    },
    {
      key: "Active",
      label: "Active",
      note: "Receiving services",
      value: counts.Active,
      tone: "blue",
      icon: <FiUserCheck />,
    },
    {
      key: "Needs attention",
      label: "Needs attention",
      note: "Details to fix or confirm",
      value: counts["Needs attention"],
      tone: "amber",
      icon: <FiAlertCircle />,
    },
    {
      key: "Archived",
      label: "Archived",
      note: "Inactive or deceased",
      value: counts.Archived,
      tone: "gray",
      icon: <FiArchive />,
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
    <div className="records-page">
      {/* Heading */}
      <header className="rp-heading">
        <div className="rp-title-row">
          <span className="rp-title-icon">
            <FiUsers />
          </span>
          <div>
            <h1>Records</h1>
            <p>View, manage and organize all senior citizen records.</p>
          </div>
        </div>

        <div className="rp-heading-actions">
          <button
            type="button"
            className="rp-btn rp-btn-secondary"
            onClick={() =>
              downloadCSV(
                `senior-records-${todayISO()}.csv`,
                filtered,
                flagsById
              )
            }
            disabled={filtered.length === 0}
          >
            <FiDownload />
            Export
          </button>
          <button
            type="button"
            className="rp-btn rp-btn-primary"
            onClick={() => setFormModal({ record: null })}
          >
            <FiPlus />
            Add senior
          </button>
        </div>
      </header>

      {/* Summary cards double as quick filters */}
      <div className="rp-stats">
        {statCards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`rp-stat${activeTab === card.key ? " active" : ""}`}
            onClick={() => setActiveTab(card.key)}
            aria-pressed={activeTab === card.key}
            title={`Show ${card.label.toLowerCase()}`}
          >
            <span className={`rp-stat-icon ${card.tone}`}>{card.icon}</span>
            <span className="rp-stat-text">
              <strong>{loading ? "–" : card.value}</strong>
              <span>{card.label}</span>
              <small>{card.note}</small>
            </span>
          </button>
        ))}
      </div>

      {/* Table panel */}
      <section className="rp-panel">
        <div className="rp-tabs" role="tablist" aria-label="Filter by status">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={activeTab === name}
              className={`rp-tab${activeTab === name ? " active" : ""}`}
              onClick={() => setActiveTab(name)}
            >
              {name}
              <span className="rp-tab-count">{loading ? "–" : counts[name]}</span>
            </button>
          ))}
        </div>

        <div className="rp-toolbar">
          <div className="rp-search">
            <FiSearch aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by name, ID or contact number"
              aria-label="Search records"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                className="rp-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <FiX />
              </button>
            )}
          </div>

          <select
            aria-label="Filter by purok"
            value={purokFilter}
            onChange={(event) => setPurokFilter(event.target.value)}
          >
            <option value="All">All puroks</option>
            {PUROKS.map((purok) => (
              <option key={purok} value={purok}>
                {purok}
              </option>
            ))}
          </select>

          <select
            aria-label="Sort records"
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
              className="rp-btn rp-btn-ghost rp-btn-sm"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Error state */}
        {!loading && loadError && (
          <div className="rp-state" role="alert">
            <span className="rp-state-icon error">
              <FiAlertCircle />
            </span>
            <h3>Records could not be loaded</h3>
            <p>{loadError}</p>
            <button
              type="button"
              className="rp-btn rp-btn-secondary"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <FiRefreshCw />
              Try again
            </button>
          </div>
        )}

        {/* Empty states */}
        {!loading && !loadError && filtered.length === 0 && (
          <div className="rp-state">
            <span className="rp-state-icon">
              <FiInbox />
            </span>
            {records.length === 0 ? (
              <>
                <h3>No records yet</h3>
                <p>Add the first senior to start building the registry.</p>
                <button
                  type="button"
                  className="rp-btn rp-btn-primary"
                  onClick={() => setFormModal({ record: null })}
                >
                  <FiPlus />
                  Add senior
                </button>
              </>
            ) : activeTab === "Needs attention" && !hasFilters ? (
              <>
                <h3>Nothing needs attention</h3>
                <p>Every active record has complete, up-to-date details.</p>
              </>
            ) : (
              <>
                <h3>No matching records</h3>
                <p>Try a different search or clear the filters.</p>
                <button
                  type="button"
                  className="rp-btn rp-btn-secondary"
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
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Senior</th>
                  <th>Age</th>
                  <th>Purok</th>
                  <th>Status</th>
                  <th className="rp-col-hide-md">Needs attention</th>
                  <th className="rp-col-hide-sm">Last updated</th>
                  <th className="rp-actions-head">Action</th>
                </tr>
              </thead>

              <tbody>
                {loading &&
                  SKELETON_ROWS.map((row) => (
                    <tr key={row} aria-hidden="true">
                      <td>
                        <div className="rp-senior">
                          <span className="rp-skeleton rp-skeleton-avatar" />
                          <span className="rp-skeleton rp-skeleton-line" />
                        </div>
                      </td>
                      <td>
                        <span className="rp-skeleton rp-skeleton-line short" />
                      </td>
                      <td>
                        <span className="rp-skeleton rp-skeleton-line short" />
                      </td>
                      <td>
                        <span className="rp-skeleton rp-skeleton-pill" />
                      </td>
                      <td className="rp-col-hide-md">
                        <span className="rp-skeleton rp-skeleton-line" />
                      </td>
                      <td className="rp-col-hide-sm">
                        <span className="rp-skeleton rp-skeleton-line" />
                      </td>
                      <td />
                    </tr>
                  ))}

                {!loading &&
                  pageRows.map((record) => {
                    const updated = formatDateTime(record.lastUpdated);

                    return (
                      <tr
                        key={record.id}
                        className={`${record.isArchived ? "is-archived" : ""}${
                          selectedId === record.id ? " selected" : ""
                        }`}
                      >
                        <td>
                          <button
                            type="button"
                            className="rp-senior rp-senior-link"
                            onClick={() => setSelectedId(record.id)}
                            title="View details"
                          >
                            <span className={`rp-avatar ${avatarTone(record.id)}`}>
                              {initials(record.name)}
                            </span>
                            <span className="rp-senior-text">
                              <strong>{record.name}</strong>
                              <small>{record.seniorId}</small>
                            </span>
                          </button>
                        </td>
                        <td>{record.age === "" ? "-" : record.age}</td>
                        <td>{record.purok || "-"}</td>
                        <td>
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="rp-col-hide-md">
                          <AttentionCell flags={flagsById.get(record.id) || []} />
                        </td>
                        <td className="rp-col-hide-sm">
                          <span className="rp-date">{updated.date}</span>
                          <span className="rp-time">{updated.time}</span>
                        </td>
                        <td>
                          <div className="rp-actions">
                            <button
                              type="button"
                              className="rp-btn rp-btn-secondary rp-btn-sm"
                              onClick={() => setSelectedId(record.id)}
                            >
                              View
                            </button>

                            <RowMenu
                              label={`More actions for ${record.name}`}
                              items={menuItemsFor(record)}
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
          <div className="rp-footer">
            <span className="rp-muted">
              Showing {pageStart + 1} to{" "}
              {Math.min(pageStart + PAGE_SIZE, filtered.length)} of{" "}
              {filtered.length} {filtered.length === 1 ? "record" : "records"}
            </span>

            {totalPages > 1 && (
              <div className="rp-pagination">
                <button
                  type="button"
                  className="rp-page-btn"
                  onClick={() => setCurrentPage(page - 1)}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  <FiChevronLeft />
                </button>

                {pageNumbers.map((number, index) =>
                  number === "..." ? (
                    <span key={`dots-${index}`} className="rp-page-dots">
                      ...
                    </span>
                  ) : (
                    <button
                      key={number}
                      type="button"
                      className={`rp-page-btn${number === page ? " active" : ""}`}
                      onClick={() => setCurrentPage(number)}
                      aria-current={number === page ? "page" : undefined}
                    >
                      {number}
                    </button>
                  )
                )}

                <button
                  type="button"
                  className="rp-page-btn"
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

      {/* Record drawer */}
      {selectedRecord && (
        <RecordDrawer
          record={selectedRecord}
          flags={flagsById.get(selectedRecord.id) || []}
          onClose={closeDrawer}
          onEdit={() => {
            setFormModal({ record: selectedRecord });
            setSelectedId(null);
          }}
          onArchive={() => {
            setArchiveTarget(selectedRecord);
            setSelectedId(null);
          }}
          onRestore={async () => {
            const saved = await restoreRecord(selectedRecord);
            if (saved) setSelectedId(null);
          }}
        />
      )}

      {/* Add / edit */}
      {formModal && (
        <SeniorFormModal
          record={formModal.record}
          records={records}
          onClose={() => setFormModal(null)}
          onSave={saveSenior}
        />
      )}

      {/* Archive */}
      {archiveTarget && (
        <ArchiveDialog
          record={archiveTarget}
          busy={busy}
          onConfirm={confirmArchive}
          onClose={() => setArchiveTarget(null)}
        />
      )}

      {/* Delete */}
      {deleteTarget && (
        <DeleteDialog
          record={deleteTarget}
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Toasts */}
      <Layer>
        <div className="rp-toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`rp-toast ${toast.type}`}>
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
      </Layer>
    </div>
  );
}