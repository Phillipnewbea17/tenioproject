import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiAlertCircle,
  FiArrowDown,
  FiArrowUp,
  FiCheck,
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiCopy,
  FiEdit2,
  FiEye,
  FiEyeOff,
  FiKey,
  FiMoreHorizontal,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiSmartphone,
  FiUser,
  FiUserCheck,
  FiUserPlus,
  FiUserX,
  FiUsers,
  FiX,
} from "react-icons/fi";
import {
  getUsers,
  createUser,
  updateUser,
  resetUserPassword,
  setAppUserStatus,
  getRecentLogins,
} from "../services/api";
import AppUserAvatar from "../components/AppUserAvatar";
import "./UserManagement.css";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

// The system has two staff roles. Edit the descriptions to match your permissions.
const ROLES = [
  {
    value: "Administrator",
    description: "Full access, including managing users and passwords.",
  },
  {
    value: "User",
    description: "Can use the system but cannot manage other users.",
  },
];

// App users (seniors) have their own role, kept apart from staff roles so an
// app user can never become an administrator.
const APP_ROLE_LABELS = {
  senior: "Senior",
  familyRelative: "Family relative",
};

const PAGE_SIZE = 10;
const MIN_PASSWORD_LENGTH = 8;
const MIN_USERNAME_LENGTH = 3;
const USERNAME_PATTERN = /^[a-z0-9._-]+$/i;
const SKELETON_ROWS = [0, 1, 2, 3, 4];
const TOAST_DURATION = 4500;

// Toast ids only need to be unique while the page is open.
let lastToastId = 0;

// The logged-in user is read from storage so the page can protect their own
// row. Save the user object as JSON under this key when you log in, for
// example: localStorage.setItem("scms_user", JSON.stringify(response.user)).
const CURRENT_USER_KEY = "scms_user";

const EMPTY_FORM = {
  name: "",
  username: "",
  email: "",
  role: "User",
  password: "",
};

const EMPTY_PASSWORD_FORM = {
  password: "",
  confirmation: "",
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

// Round avatar: the senior's app-profile photo when they set one, otherwise
// their initials. Staff have no photo, so they always show initials.
function Avatar({ user, large }) {
  return (
    <AppUserAvatar
      appAccountId={user.type === "app_user" ? user.id : null}
      hasPhoto={user.hasPhoto}
      className={`um-avatar${large ? " um-avatar-lg" : ""}`}
    >
      {initials(user.name)}
    </AppUserAvatar>
  );
}

function getCurrentUser() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage.getItem(CURRENT_USER_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // Ignore unreadable storage and try the next one.
    }
  }
  return null;
}

function formatFullDate(date) {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "Just now", "5 min ago", "3 hr ago", "Yesterday", "4 days ago", then a date.
function formatRelative(date) {
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} hr ago`;
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Only two staff roles exist now. Anything that isn't an administrator
// (including old "Staff" / "Encoder" values) is shown as "User".
function normalizeRole(role) {
  const value = String(role || "").toLowerCase();

  if (value === "administrator" || value === "admin") return "Administrator";

  if (value && value !== "user") {
    console.warn(`Unknown role "${role}" is being shown as "User".`);
  }

  return "User";
}

function appRoleLabel(role) {
  return APP_ROLE_LABELS[role] || "App user";
}

// Converts a merged user row (staff or app user) into the shape this page uses.
function normalizeUser(user) {
  const loginDate = user.last_login_at ? new Date(user.last_login_at) : null;
  const hasLogin = loginDate && !Number.isNaN(loginDate.getTime());
  const type = user.type === "app_user" ? "app_user" : "staff";

  return {
    id: user.id,
    uid: user.uid || `${type}-${user.id}`,
    type,
    name: user.name || user.username || user.phone || "",
    username: user.username || "",
    email: user.email || "",
    phone: user.phone || "",
    // Staff roles are normalized to Administrator / User; app roles are kept.
    role: type === "staff" ? normalizeRole(user.role) : user.role || "senior",
    status: user.status || "Active",
    hasPhoto: Boolean(user.has_photo),
    linked: user.linked ?? null,
    senior: user.senior || null,
    lastLoginRelative: hasLogin ? formatRelative(loginDate) : "",
    lastLoginFull: hasLogin ? formatFullDate(loginDate) : "",
    lastLoginTime: hasLogin ? loginDate.getTime() : 0,
  };
}

function generatePassword(length = 12) {
  const characters =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => characters[value % characters.length]).join(
    ""
  );
}

// Laravel returns validation problems as { errors: { field: ["message"] } }.
function extractFieldErrors(error) {
  const source = error?.errors || error?.data?.errors;
  if (!source || typeof source !== "object") return {};

  return Object.fromEntries(
    Object.entries(source).map(([field, messages]) => [
      field,
      Array.isArray(messages) ? messages[0] : String(messages),
    ])
  );
}

function validateUserForm(form, { isAdd, users, editingId }) {
  const errors = {};
  const name = form.name.trim();
  const username = form.username.trim();
  const email = form.email.trim();

  if (!name) errors.name = "Enter the user's full name.";

  if (!username) {
    errors.username = "Enter a username.";
  } else if (username.length < MIN_USERNAME_LENGTH) {
    errors.username = `Use at least ${MIN_USERNAME_LENGTH} characters.`;
  } else if (!USERNAME_PATTERN.test(username)) {
    errors.username =
      "Use letters, numbers, dots, underscores or hyphens only. No spaces.";
  } else if (
    users.some(
      (user) =>
        user.type === "staff" &&
        user.uid !== editingId &&
        user.username.toLowerCase() === username.toLowerCase()
    )
  ) {
    errors.username = "This username is already taken.";
  }

  if (!email) {
    errors.email = "Enter an email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address, like name@example.com.";
  } else if (
    users.some(
      (user) =>
        user.type === "staff" &&
        user.uid !== editingId &&
        user.email.toLowerCase() === email.toLowerCase()
    )
  ) {
    errors.email = "This email address is already used by another user.";
  }

  if (isAdd && form.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="um-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="um-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="um-modal-title"
      >
        <div className="um-modal-header">
          <h2 id="um-modal-title">{title}</h2>
          <button
            type="button"
            className="um-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <FiX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div className={`um-field${error ? " has-error" : ""}`}>
      {htmlFor ? (
        <label htmlFor={htmlFor}>{label}</label>
      ) : (
        <span className="um-label">{label}</span>
      )}
      {children}
      {error ? (
        <p className="um-field-error" id={`${htmlFor}-error`}>
          <FiAlertCircle aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p className="um-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

function PasswordInput({ id, value, onChange, error, autoFocus, onGenerate }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error("Unable to copy password:", error);
    }
  };

  return (
    <div className="um-password">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete="new-password"
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <button
        type="button"
        className="um-icon-btn"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <FiEyeOff /> : <FiEye />}
      </button>
      {onGenerate && (
        <>
          <button
            type="button"
            className="um-btn um-btn-secondary um-btn-sm"
            onClick={() => {
              onGenerate(generatePassword());
              setVisible(true);
              setCopied(false);
            }}
          >
            <FiRefreshCw />
            Generate
          </button>
          {value && (
            <button
              type="button"
              className="um-btn um-btn-secondary um-btn-sm"
              onClick={copyPassword}
            >
              {copied ? <FiCheck /> : <FiCopy />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function RoleSelect({ value, onChange }) {
  return (
    <div className="um-role-options" role="radiogroup" aria-label="Role">
      {ROLES.map((role) => (
        <label
          key={role.value}
          className={`um-role-option${value === role.value ? " selected" : ""}`}
        >
          <input
            type="radio"
            name="um-role"
            value={role.value}
            checked={value === role.value}
            onChange={() => onChange(role.value)}
          />
          <span className="um-role-icon">
            {role.value === "Administrator" ? <FiShield /> : <FiUser />}
          </span>
          <span className="um-role-text">
            <strong>{role.value}</strong>
            <small>{role.description}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

function SortHeader({ label, sortKey, sort, onSort, className }) {
  const active = sort.key === sortKey;
  const ariaSort = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th aria-sort={ariaSort} className={className}>
      <button type="button" className="um-sort" onClick={() => onSort(sortKey)}>
        {label}
        {active && (sort.dir === "asc" ? <FiArrowUp /> : <FiArrowDown />)}
      </button>
    </th>
  );
}

function RoleBadge({ role }) {
  return (
    <span
      className={`um-badge ${
        role === "Administrator" ? "um-badge-admin" : "um-badge-user"
      }`}
    >
      {role === "Administrator" ? <FiShield /> : <FiUser />}
      {role}
    </span>
  );
}

// Role shown in the Role column: staff roles use the coloured badge; app users
// get a neutral badge with their app role (never an administrator).
function RoleCell({ user }) {
  if (user.type === "staff") {
    return <RoleBadge role={user.role} />;
  }

  return (
    <span className="um-badge um-badge-user">
      <FiSmartphone />
      {appRoleLabel(user.role)}
    </span>
  );
}

function TypeBadge({ type }) {
  return type === "app_user" ? (
    <span className="um-badge um-badge-user">
      <FiSmartphone />
      App user
    </span>
  ) : (
    <span className="um-badge um-badge-admin">
      <FiShield />
      Staff
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`um-status ${status.toLowerCase()}`}>
      <span className="um-status-dot" />
      {status}
    </span>
  );
}

// The on/off switch used in the table. Switching a user off asks to confirm.
function StatusSwitch({ user, busy, disabledReason, onToggle }) {
  const active = user.status === "Active";
  const label = active ? "Deactivate user" : "Activate user";

  return (
    <div className="um-status-cell" title={disabledReason || label}>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${user.name} is ${user.status.toLowerCase()}. ${label}.`}
        className={`um-switch${active ? " on" : ""}`}
        onClick={onToggle}
        disabled={busy || Boolean(disabledReason)}
      >
        <span className="um-switch-thumb" />
      </button>
      <span className={`um-status-text ${active ? "active" : "inactive"}`}>
        {user.status}
      </span>
    </div>
  );
}

function LastLogin({ user }) {
  if (!user.lastLoginFull) {
    return <span className="um-faint">No login yet</span>;
  }

  return (
    <time title={user.lastLoginFull} className="um-muted">
      {user.lastLoginRelative}
    </time>
  );
}

// A "more actions" dropdown. It is positioned with fixed coordinates so the
// scrollable table never clips it.
function ActionMenu({ label, items, disabled }) {
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

    const firstItem = menuRef.current?.querySelector("button:not(:disabled)");
    firstItem?.focus();

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
        className="um-icon-btn um-more-btn"
        onClick={toggle}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        <FiMoreHorizontal />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="um-menu"
          role="menu"
          style={position}
          onKeyDown={handleMenuKey}
        >
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} className="um-menu-divider" role="separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`um-menu-item${item.tone ? ` ${item.tone}` : ""}`}
                disabled={item.disabled}
                title={item.hint}
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

// Recent logins panel. Fetches its own data and refreshes when reloadKey
// changes (the page's Refresh/reload bumps it).
function RecentLogins({ reloadKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getRecentLogins()
      .then((data) => {
        if (!alive) return;
        setRows(Array.isArray(data) ? data : []);
        setError("");
      })
      .catch((err) => alive && setError(err.message || "Failed to load recent logins."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <section className="um-panel um-recent">
      <div className="um-recent-head">
        <h2>
          <FiClock aria-hidden="true" /> Recent logins
        </h2>
        <span className="um-muted">The latest staff and app sign-ins.</span>
      </div>

      {loading && <p className="um-muted um-app-loading">Loading…</p>}

      {!loading && error && (
        <div className="um-state" role="alert">
          <span className="um-state-icon error">
            <FiAlertCircle />
          </span>
          <h3>Recent logins could not be loaded</h3>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="um-muted um-app-loading">No logins recorded yet.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="um-table-wrap">
          <table className="um-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Type</th>
                <th className="um-col-hide-sm">When</th>
                <th className="um-col-hide-sm">IP · Device</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const when = row.logged_in_at ? new Date(row.logged_in_at) : null;
                const hasWhen = when && !Number.isNaN(when.getTime());
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="um-user-cell">
                        <span className="um-avatar">{initials(row.name)}</span>
                        <span className="um-user-text">
                          <strong>{row.name}</strong>
                          {row.detail && <small>{row.detail}</small>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <TypeBadge type={row.type} />
                    </td>
                    <td className="um-col-hide-sm">
                      {hasWhen ? (
                        <time title={formatFullDate(when)} className="um-muted">
                          {formatRelative(when)}
                        </time>
                      ) : (
                        <span className="um-faint">—</span>
                      )}
                    </td>
                    <td className="um-col-hide-sm um-muted">
                      {[row.ip, row.device].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((key) => key + 1);
  };

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");

  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef(new Map());

  const currentUser = useMemo(() => getCurrentUser(), []);

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

    getUsers()
      .then(({ users: rows, counts: serverCounts }) => {
        if (cancelled) return;
        setUsers((Array.isArray(rows) ? rows : []).map(normalizeUser));
        setCounts(serverCounts);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load users:", error);
        setLoadError(error.message || "Failed to load users.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /* ------------------------------ Derived data ----------------------------- */

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\D/g, "");

    const rows = users.filter((user) => {
      const matchesType = typeFilter === "all" || user.type === typeFilter;

      const matchesSearch =
        !query ||
        user.name.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        (queryDigits &&
          user.phone.replace(/\D/g, "").includes(queryDigits));

      const matchesStatus =
        statusFilter === "All" || user.status === statusFilter;

      // App users are treated as "User" for the role filter, so picking
      // "User" shows both staff users and app users.
      const matchesRole =
        roleFilter === "All" ||
        user.role === roleFilter ||
        (roleFilter === "User" && user.type === "app_user");

      return matchesType && matchesSearch && matchesStatus && matchesRole;
    });

    if (!sort.key) return rows;

    const direction = sort.dir === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      if (sort.key === "lastLogin") {
        return (a.lastLoginTime - b.lastLoginTime) * direction;
      }

      return (
        String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, {
          sensitivity: "base",
        }) * direction
      );
    });
  }, [users, search, typeFilter, statusFilter, roleFilter, sort]);

  // Cards use the server's global counts when available, falling back to the
  // loaded rows.
  const stats = counts
    ? {
        total: counts.total,
        active: counts.active,
        inactive: counts.inactive,
        staff: counts.staff,
        appUsers: counts.app_users,
      }
    : {
        total: users.length,
        active: users.filter((user) => user.status === "Active").length,
        inactive: users.filter((user) => user.status === "Inactive").length,
        staff: users.filter((user) => user.type === "staff").length,
        appUsers: users.filter((user) => user.type === "app_user").length,
      };

  const activeAdminCount = users.filter(
    (user) =>
      user.type === "staff" &&
      user.role === "Administrator" &&
      user.status === "Active"
  ).length;

  const isLastActiveAdmin = (user) =>
    user.type === "staff" &&
    user.role === "Administrator" &&
    user.status === "Active" &&
    activeAdminCount <= 1;

  // True when the row belongs to the person who is logged in (staff only).
  const isSelf = (user) => {
    if (!currentUser || user.type !== "staff") return false;

    if (currentUser.id != null && String(currentUser.id) === String(user.id)) {
      return true;
    }

    const sameText = (a, b) =>
      Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

    return (
      sameText(currentUser.username, user.username) ||
      sameText(currentUser.email, user.email)
    );
  };

  // Why an active user cannot be deactivated (empty when they can).
  const deactivateBlockedReason = (user) => {
    if (user.status !== "Active") return "";
    if (isSelf(user)) return "You can't deactivate your own account.";
    if (isLastActiveAdmin(user)) {
      return "This is the only active administrator. Make another user an administrator first.";
    }
    return "";
  };

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredUsers.slice(pageStart, pageStart + PAGE_SIZE);

  const hasFilters =
    Boolean(search.trim()) ||
    typeFilter !== "all" ||
    statusFilter !== "All" ||
    roleFilter !== "All";

  const showTable = loading || (!loadError && filteredUsers.length > 0);

  /* -------------------------------- Toasts --------------------------------- */

  const dismissToast = (id) => {
    clearTimeout(toastTimers.current.get(id));
    toastTimers.current.delete(id);
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  };

  const pushToast = (message, type = "success") => {
    const id = ++lastToastId;
    setToasts((previous) => [...previous, { id, message, type }]);
    toastTimers.current.set(
      id,
      setTimeout(() => dismissToast(id), TOAST_DURATION)
    );
  };

  /* ------------------------------- Filtering ------------------------------- */

  const applyFilters = ({ type = "all", status = "All", role = "All" }) => {
    setTypeFilter(type);
    setStatusFilter(status);
    setRoleFilter(role);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    applyFilters({});
  };

  const handleSort = (key) => {
    setSort((previous) => {
      if (previous.key !== key) return { key, dir: "asc" };
      if (previous.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
    setPage(1);
  };

  /* -------------------------------- Modals --------------------------------- */

  const resetModal = () => {
    setModal(null);
    setForm(EMPTY_FORM);
    setPasswordForm(EMPTY_PASSWORD_FORM);
    setErrors({});
    setFormError("");
  };

  const requestClose = () => {
    if (saving || busyId !== null) return;
    resetModal();
  };

  const openAddModal = () => {
    resetModal();
    setModal({ type: "add" });
  };

  const openEditModal = (user) => {
    resetModal();
    setForm({
      ...EMPTY_FORM,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
    });
    setModal({ type: "edit", user });
  };

  const openResetModal = (user) => {
    resetModal();
    setModal({ type: "reset", user });
  };

  const openViewModal = (user) => {
    resetModal();
    setModal({ type: "view", user });
  };

  const requestToggleStatus = (user) => {
    if (user.status === "Active") {
      const reason = deactivateBlockedReason(user);

      if (reason) {
        pushToast(reason, "error");
        return;
      }

      resetModal();
      setModal({ type: "deactivate", user });
      return;
    }

    changeStatus(user, "Active");
  };

  /* -------------------------------- Forms ---------------------------------- */

  const setField = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFormError("");
  };

  const updateForm = (field) => (event) => setField(field, event.target.value);

  // Usernames are lowercase and never contain spaces.
  const updateUsername = (event) =>
    setField("username", event.target.value.toLowerCase().replace(/\s+/g, ""));

  const setPasswordField = (field, value) => {
    setPasswordForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFormError("");
  };

  const replaceUser = (updated) => {
    const next = normalizeUser(updated);
    setUsers((previous) =>
      previous.map((user) => (user.uid === next.uid ? next : user))
    );
  };

  const isDirty =
    modal?.type === "edit" &&
    (form.name.trim() !== modal.user.name ||
      form.username.trim() !== modal.user.username ||
      form.email.trim() !== modal.user.email ||
      form.role !== modal.user.role);

  const showSaveFailure = (error, fallback) => {
    console.error(fallback, error);
    const fieldErrors = extractFieldErrors(error);

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
    } else {
      setFormError(error.message || fallback);
    }
  };

  const saveUser = async (event) => {
    event.preventDefault();

    const isAdd = modal.type === "add";
    const found = validateUserForm(form, {
      isAdd,
      users,
      editingId: isAdd ? null : modal.user.uid,
    });

    if (!isAdd && form.role !== "Administrator") {
      if (isSelf(modal.user) && modal.user.role === "Administrator") {
        found.role = "You can't remove your own administrator access.";
      } else if (isLastActiveAdmin(modal.user)) {
        found.role =
          "This is the only active administrator. Make another user an administrator first.";
      }
    }

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    const payload = {
      name: form.name.trim(),
      username: form.username.trim(),
      email: form.email.trim(),
      role: form.role,
    };

    setSaving(true);
    setFormError("");

    try {
      if (isAdd) {
        const created = await createUser({
          ...payload,
          password: form.password,
        });

        setUsers((previous) => [normalizeUser(created), ...previous]);
        setCounts(null); // recompute from rows until the next refresh
        // Make sure the new user is visible at the top of the list.
        setSearch("");
        setTypeFilter("all");
        setStatusFilter("All");
        setRoleFilter("All");
        setSort({ key: null, dir: "asc" });
        setPage(1);
        pushToast(`${payload.name} was added.`);
      } else {
        const updated = await updateUser(modal.user.id, payload);
        replaceUser(updated);
        pushToast(`${payload.name}'s details were saved.`);
      }

      resetModal();
    } catch (error) {
      showSaveFailure(error, "Unable to save user.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (user, nextStatus) => {
    setBusyId(user.uid);

    try {
      const updated =
        user.type === "app_user"
          ? await setAppUserStatus(user.id, nextStatus)
          : await updateUser(user.id, { status: nextStatus });
      replaceUser(updated);
      setCounts((previous) =>
        previous
          ? {
              ...previous,
              active: previous.active + (nextStatus === "Active" ? 1 : -1),
              inactive: previous.inactive + (nextStatus === "Active" ? -1 : 1),
            }
          : previous
      );
      pushToast(
        nextStatus === "Active"
          ? `${user.name} was activated.`
          : `${user.name} was deactivated.`
      );
      resetModal();
    } catch (error) {
      console.error("Failed to change status:", error);
      pushToast(error.message || "Unable to change user status.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const resetUserPasswordSubmit = async (event) => {
    event.preventDefault();

    const found = {};

    if (passwordForm.password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (passwordForm.password !== passwordForm.confirmation) {
      found.confirmation = "The passwords do not match.";
    }

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      await resetUserPassword(
        modal.user.id,
        passwordForm.password,
        passwordForm.confirmation
      );
      pushToast(`Password reset for ${modal.user.name}.`);
      resetModal();
    } catch (error) {
      showSaveFailure(error, "Unable to reset password.");
    } finally {
      setSaving(false);
    }
  };

  /* -------------------------------- Render --------------------------------- */

  const statCards = [
    {
      key: "total",
      label: "Total",
      value: stats.total,
      tone: "green",
      icon: <FiUsers />,
      active:
        typeFilter === "all" && statusFilter === "All" && roleFilter === "All",
      onClick: () => applyFilters({}),
    },
    {
      key: "active",
      label: "Active",
      value: stats.active,
      tone: "blue",
      icon: <FiUserCheck />,
      active: statusFilter === "Active" && typeFilter === "all" && roleFilter === "All",
      onClick: () => applyFilters({ status: "Active" }),
    },
    {
      key: "inactive",
      label: "Inactive",
      value: stats.inactive,
      tone: "amber",
      icon: <FiUserX />,
      active: statusFilter === "Inactive" && typeFilter === "all" && roleFilter === "All",
      onClick: () => applyFilters({ status: "Inactive" }),
    },
    {
      key: "staff",
      label: "Staff",
      value: stats.staff,
      tone: "purple",
      icon: <FiShield />,
      active: typeFilter === "staff" && statusFilter === "All" && roleFilter === "All",
      onClick: () => applyFilters({ type: "staff" }),
    },
    {
      key: "app_users",
      label: "App users",
      value: stats.appUsers,
      tone: "blue",
      icon: <FiSmartphone />,
      active: typeFilter === "app_user" && statusFilter === "All" && roleFilter === "All",
      onClick: () => applyFilters({ type: "app_user" }),
    },
  ];

  const menuItemsFor = (user) => {
    const active = user.status === "Active";
    const blockedReason = deactivateBlockedReason(user);

    const statusItem = {
      key: "status",
      label: active ? "Deactivate user" : "Activate user",
      icon: active ? <FiUserX /> : <FiUserCheck />,
      tone: active ? "danger" : "success",
      disabled: Boolean(blockedReason),
      hint: blockedReason || undefined,
      onClick: () => requestToggleStatus(user),
    };

    // App users: only view and activate/deactivate (no role or password edits).
    if (user.type === "app_user") {
      return [
        {
          key: "view",
          label: "View details",
          icon: <FiEye />,
          onClick: () => openViewModal(user),
        },
        { key: "divider", divider: true },
        statusItem,
      ];
    }

    return [
      {
        key: "view",
        label: "View details",
        icon: <FiEye />,
        onClick: () => openViewModal(user),
      },
      {
        key: "reset",
        label: "Reset password",
        icon: <FiKey />,
        onClick: () => openResetModal(user),
      },
      { key: "divider", divider: true },
      statusItem,
    ];
  };

  return (
    <div className="user-management-page">
      {/* Heading */}
      <header className="um-heading">
        <div className="um-title-row">
          <div>
            <span className="um-eyebrow">People and records</span>
            <h1>User Management</h1>
            <p>
              Everyone who can log in — SCMS staff and seniors who use the
              mobile app — in one list.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="um-btn um-btn-primary"
          onClick={openAddModal}
        >
          <FiUserPlus />
          Add staff
        </button>
      </header>

      {/* Stats double as quick filters */}
      <div className="um-stats">
        {statCards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`um-stat${card.active ? " active" : ""}`}
            onClick={card.onClick}
            aria-pressed={card.active}
            title={`Show ${card.label.toLowerCase()}`}
          >
            <span className={`um-stat-icon ${card.tone}`}>{card.icon}</span>
            <span className="um-stat-text">
              <strong>{loading ? "–" : card.value}</strong>
              <span>{card.label}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Table panel */}
      <section className="um-panel">
        <div className="um-toolbar">
          <div className="um-search">
            <FiSearch aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by name, username, email or phone"
              aria-label="Search users"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                type="button"
                className="um-search-clear"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                aria-label="Clear search"
              >
                <FiX />
              </button>
            )}
          </div>

          <select
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All types</option>
            <option value="staff">Staff</option>
            <option value="app_user">App users</option>
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="All">All status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="All">All roles</option>
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.value}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              className="um-btn um-btn-ghost um-btn-sm"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Error state */}
        {!loading && loadError && (
          <div className="um-state" role="alert">
            <span className="um-state-icon error">
              <FiAlertCircle />
            </span>
            <h3>Users could not be loaded</h3>
            <p>{loadError}</p>
            <button
              type="button"
              className="um-btn um-btn-secondary"
              onClick={reload}
            >
              <FiRefreshCw />
              Try again
            </button>
          </div>
        )}

        {/* Empty states */}
        {!loading && !loadError && filteredUsers.length === 0 && (
          <div className="um-state">
            <span className="um-state-icon">
              <FiUsers />
            </span>
            {users.length === 0 ? (
              <>
                <h3>No users yet</h3>
                <p>Add the first staff user to give someone access to SCMS.</p>
                <button
                  type="button"
                  className="um-btn um-btn-primary"
                  onClick={openAddModal}
                >
                  <FiUserPlus />
                  Add staff
                </button>
              </>
            ) : (
              <>
                <h3>No matching users</h3>
                <p>Try a different search or clear the filters.</p>
                <button
                  type="button"
                  className="um-btn um-btn-secondary"
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
          <div className="um-table-wrap">
            <table className="um-table">
              <thead>
                <tr>
                  <SortHeader
                    label="User"
                    sortKey="name"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Type"
                    sortKey="type"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <th className="um-col-hide-xs">Email or phone</th>
                  <SortHeader
                    label="Role"
                    sortKey="role"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Status"
                    sortKey="status"
                    sort={sort}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Last login"
                    sortKey="lastLogin"
                    sort={sort}
                    onSort={handleSort}
                    className="um-col-hide-sm"
                  />
                  <th className="um-actions-head">Actions</th>
                </tr>
              </thead>

              <tbody>
                {loading &&
                  SKELETON_ROWS.map((row) => (
                    <tr key={row} aria-hidden="true">
                      <td>
                        <div className="um-user-cell">
                          <span className="um-skeleton um-skeleton-avatar" />
                          <span className="um-skeleton um-skeleton-line" />
                        </div>
                      </td>
                      <td>
                        <span className="um-skeleton um-skeleton-pill" />
                      </td>
                      <td className="um-col-hide-xs">
                        <span className="um-skeleton um-skeleton-line" />
                      </td>
                      <td>
                        <span className="um-skeleton um-skeleton-pill" />
                      </td>
                      <td>
                        <span className="um-skeleton um-skeleton-pill" />
                      </td>
                      <td className="um-col-hide-sm">
                        <span className="um-skeleton um-skeleton-line" />
                      </td>
                      <td />
                    </tr>
                  ))}

                {!loading &&
                  pageRows.map((user) => {
                    const busy = busyId === user.uid;
                    const self = isSelf(user);

                    return (
                      <tr
                        key={user.uid}
                        className={user.status === "Inactive" ? "is-inactive" : ""}
                      >
                        <td>
                          <button
                            type="button"
                            className="um-user-cell um-user-link"
                            onClick={() => openViewModal(user)}
                            title="View details"
                          >
                            <Avatar user={user} />
                            <span className="um-user-text">
                              <strong>
                                {user.name}
                                {self && <span className="um-you">You</span>}
                              </strong>
                              {user.type === "staff" ? (
                                <>
                                  {user.username && <small>@{user.username}</small>}
                                  <small className="um-email-mobile">
                                    {user.email}
                                  </small>
                                </>
                              ) : (
                                <small className="um-email-mobile">
                                  {user.phone}
                                </small>
                              )}
                            </span>
                          </button>
                        </td>
                        <td>
                          <TypeBadge type={user.type} />
                        </td>
                        <td className="um-email um-col-hide-xs">
                          {user.type === "staff" ? user.email : user.phone}
                        </td>
                        <td>
                          <RoleCell user={user} />
                        </td>
                        <td>
                          <StatusSwitch
                            user={user}
                            busy={busy}
                            disabledReason={deactivateBlockedReason(user)}
                            onToggle={() => requestToggleStatus(user)}
                          />
                        </td>
                        <td className="um-col-hide-sm">
                          <LastLogin user={user} />
                        </td>
                        <td>
                          <div className="um-actions">
                            {user.type === "staff" ? (
                              <button
                                type="button"
                                className="um-btn um-btn-secondary um-btn-sm"
                                onClick={() => openEditModal(user)}
                                disabled={busy}
                                aria-label={`Edit ${user.name}`}
                              >
                                <FiEdit2 />
                                Edit
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="um-btn um-btn-secondary um-btn-sm"
                                onClick={() => openViewModal(user)}
                                disabled={busy}
                                aria-label={`View ${user.name}`}
                              >
                                <FiEye />
                                View
                              </button>
                            )}

                            <ActionMenu
                              label={`More actions for ${user.name}`}
                              disabled={busy}
                              items={menuItemsFor(user)}
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
        {!loading && !loadError && filteredUsers.length > 0 && (
          <div className="um-footer">
            <span className="um-muted">
              {filteredUsers.length > PAGE_SIZE
                ? `Showing ${pageStart + 1}–${Math.min(
                    pageStart + PAGE_SIZE,
                    filteredUsers.length
                  )} of ${filteredUsers.length} users`
                : hasFilters
                ? `${filteredUsers.length} of ${users.length} users`
                : `${users.length} ${users.length === 1 ? "user" : "users"}`}
            </span>

            {pageCount > 1 && (
              <div className="um-pagination">
                <button
                  type="button"
                  className="um-icon-btn"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  <FiChevronLeft />
                </button>
                <span>
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  className="um-icon-btn"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  aria-label="Next page"
                >
                  <FiChevronRight />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Recent logins */}
      <RecentLogins reloadKey={reloadKey} />

      {/* View details */}
      {modal?.type === "view" && (
        <Modal title="User details" onClose={requestClose}>
          <div className="um-modal-body">
            <div className="um-profile">
              <Avatar user={modal.user} large />
              <div>
                <h3>
                  {modal.user.name}
                  {isSelf(modal.user) && <span className="um-you">You</span>}
                </h3>
                {modal.user.type === "staff" && modal.user.username ? (
                  <p>@{modal.user.username}</p>
                ) : modal.user.type === "app_user" ? (
                  <p>{modal.user.phone}</p>
                ) : null}
              </div>
            </div>

            <dl className="um-details">
              <div>
                <dt>Type</dt>
                <dd>
                  <TypeBadge type={modal.user.type} />
                </dd>
              </div>
              <div>
                <dt>{modal.user.type === "staff" ? "Email" : "Phone"}</dt>
                <dd>
                  {(modal.user.type === "staff"
                    ? modal.user.email
                    : modal.user.phone) || "-"}
                </dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>
                  <RoleCell user={modal.user} />
                </dd>
              </div>
              {modal.user.type === "app_user" && (
                <div>
                  <dt>Senior record</dt>
                  <dd>
                    {modal.user.senior
                      ? `${modal.user.senior.senior_id} · ${modal.user.senior.name}`
                      : "Not linked yet"}
                  </dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={modal.user.status} />
                </dd>
              </div>
              <div>
                <dt>Last login</dt>
                <dd>
                  {modal.user.lastLoginFull
                    ? `${modal.user.lastLoginFull} (${modal.user.lastLoginRelative})`
                    : "No login yet"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="um-modal-actions">
            {modal.user.type === "staff" ? (
              <>
                <button
                  type="button"
                  className="um-btn um-btn-secondary"
                  onClick={() => openResetModal(modal.user)}
                >
                  <FiKey />
                  Reset password
                </button>
                <button
                  type="button"
                  className="um-btn um-btn-primary"
                  onClick={() => openEditModal(modal.user)}
                >
                  <FiEdit2 />
                  Edit user
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`um-btn ${
                  modal.user.status === "Active"
                    ? "um-btn-danger"
                    : "um-btn-primary"
                }`}
                onClick={() => requestToggleStatus(modal.user)}
              >
                {modal.user.status === "Active" ? <FiUserX /> : <FiUserCheck />}
                {modal.user.status === "Active" ? "Deactivate" : "Activate"}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Add / edit (staff only) */}
      {(modal?.type === "add" || modal?.type === "edit") && (
        <Modal
          title={modal.type === "add" ? "Add staff user" : "Edit user"}
          onClose={requestClose}
        >
          <form className="um-form" onSubmit={saveUser} noValidate>
            <div className="um-modal-body">
              {formError && (
                <div className="um-banner" role="alert">
                  <FiAlertCircle aria-hidden="true" />
                  {formError}
                </div>
              )}

              <Field label="Full name" htmlFor="um-name" error={errors.name}>
                <input
                  id="um-name"
                  type="text"
                  value={form.name}
                  onChange={updateForm("name")}
                  autoFocus
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "um-name-error" : undefined}
                />
              </Field>

              <div className="um-field-row">
                <Field
                  label="Username"
                  htmlFor="um-username"
                  error={errors.username}
                  hint="Letters, numbers, dots, underscores or hyphens."
                >
                  <input
                    id="um-username"
                    type="text"
                    value={form.username}
                    onChange={updateUsername}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    aria-invalid={Boolean(errors.username)}
                    aria-describedby={
                      errors.username ? "um-username-error" : undefined
                    }
                  />
                </Field>

                <Field label="Email" htmlFor="um-email" error={errors.email}>
                  <input
                    id="um-email"
                    type="email"
                    value={form.email}
                    onChange={updateForm("email")}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "um-email-error" : undefined}
                  />
                </Field>
              </div>

              <Field label="Role" error={errors.role}>
                <RoleSelect
                  value={form.role}
                  onChange={(role) => setField("role", role)}
                />
              </Field>

              {modal.type === "add" && (
                <Field
                  label="Temporary password"
                  htmlFor="um-password"
                  error={errors.password}
                  hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it with the user securely.`}
                >
                  <PasswordInput
                    id="um-password"
                    value={form.password}
                    onChange={updateForm("password")}
                    error={errors.password}
                    onGenerate={(password) => setField("password", password)}
                  />
                </Field>
              )}
            </div>

            <div className="um-modal-actions">
              <button
                type="button"
                className="um-btn um-btn-secondary"
                onClick={requestClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="um-btn um-btn-primary"
                disabled={saving || (modal.type === "edit" && !isDirty)}
              >
                {saving
                  ? "Saving..."
                  : modal.type === "add"
                  ? "Add user"
                  : "Save changes"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reset password (staff only) */}
      {modal?.type === "reset" && (
        <Modal title="Reset password" onClose={requestClose}>
          <form className="um-form" onSubmit={resetUserPasswordSubmit} noValidate>
            <div className="um-modal-body">
              <p className="um-modal-note">
                Set a new password for <strong>{modal.user.name}</strong>. They
                will need it the next time they log in.
              </p>

              {formError && (
                <div className="um-banner" role="alert">
                  <FiAlertCircle aria-hidden="true" />
                  {formError}
                </div>
              )}

              <Field
                label="New password"
                htmlFor="um-new-password"
                error={errors.password}
                hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              >
                <PasswordInput
                  id="um-new-password"
                  value={passwordForm.password}
                  onChange={(event) =>
                    setPasswordField("password", event.target.value)
                  }
                  error={errors.password}
                  autoFocus
                  onGenerate={(password) => {
                    setPasswordForm({ password, confirmation: password });
                    setErrors({});
                  }}
                />
              </Field>

              <Field
                label="Confirm new password"
                htmlFor="um-confirm-password"
                error={errors.confirmation}
              >
                <PasswordInput
                  id="um-confirm-password"
                  value={passwordForm.confirmation}
                  onChange={(event) =>
                    setPasswordField("confirmation", event.target.value)
                  }
                  error={errors.confirmation}
                />
              </Field>
            </div>

            <div className="um-modal-actions">
              <button
                type="button"
                className="um-btn um-btn-secondary"
                onClick={requestClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="um-btn um-btn-primary"
                disabled={saving}
              >
                {saving ? "Saving..." : "Reset password"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Deactivate confirmation */}
      {modal?.type === "deactivate" && (
        <Modal title="Deactivate user?" onClose={requestClose}>
          <div className="um-modal-body">
            <p className="um-modal-note">
              <strong>{modal.user.name}</strong> will no longer be able to log
              in. You can activate them again at any time.
            </p>
          </div>

          <div className="um-modal-actions">
            <button
              type="button"
              className="um-btn um-btn-secondary"
              onClick={requestClose}
              disabled={busyId !== null}
            >
              Cancel
            </button>
            <button
              type="button"
              className="um-btn um-btn-danger"
              onClick={() => changeStatus(modal.user, "Inactive")}
              disabled={busyId !== null}
            >
              {busyId !== null ? "Deactivating..." : "Deactivate"}
            </button>
          </div>
        </Modal>
      )}

      {/* Toasts */}
      <div className="um-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`um-toast ${toast.type}`}>
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
