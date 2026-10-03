import { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,} from "../services/api";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  FiSearch,
  FiPlus,
  FiCalendar,
  FiStar,
  FiEdit2,
  FiTrash2,
  FiChevronDown,
  FiX,
  FiUsers,
  FiCreditCard,
  FiHeart,
  FiVolume2,
} from "react-icons/fi";
import { BsPinAngleFill, BsPinAngle } from "react-icons/bs";
import "./Announcements.css";

/* ---------------------------------------------------------------- */
/* Icons an announcement can use (icon_index points into this list)  */
/* ---------------------------------------------------------------- */

const ICONS = [FiUsers, FiCreditCard, FiCalendar, FiHeart, FiVolume2];

const PAGE_SIZE = 4;
const SORT_OPTIONS = ["Newest First", "Oldest First"];

const EMPTY_FORM = { title: "", date: "", description: "" };

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function useOutsideClose(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

/* ---------------------------------------------------------------- */
/* Create / Edit modal                                                */
/* ---------------------------------------------------------------- */

function AnnouncementModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const isEdit = Boolean(initial);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.date) return;
    onSave(form);
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isEdit ? "Edit Announcement" : "Create Announcement"}</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            <FiX />
          </button>
        </div>

        <form onSubmit={submit} className="modal-form">
          <label className="field-label" htmlFor="ann-title">
            Title
          </label>
          <input
            id="ann-title"
            type="text"
            className="field-input"
            placeholder="e.g., Free Medical Check-up"
            value={form.title}
            onChange={update("title")}
            required
          />

          <label className="field-label" htmlFor="ann-date">
            Date
          </label>
          <input
            id="ann-date"
            type="date"
            className="field-input"
            value={form.date}
            onChange={update("date")}
            required
          />

          <label className="field-label" htmlFor="ann-desc">
            Description
          </label>
          <textarea
            id="ann-desc"
            className="field-textarea"
            placeholder="Describe the announcement..."
            value={form.description}
            onChange={update("description")}
            rows={4}
          />

          <div className="modal-actions">
            <button type="button" className="btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {isEdit ? "Save Changes" : "Publish Announcement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Main component                                                     */
/* ---------------------------------------------------------------- */

export default function Announcements() {
  const [announcements, setAnnouncements] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("Newest First");
  const [sortOpen, setSortOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [modalMode, setModalMode] = useState(null); // null | "create" | announcement object being edited

  const sortRef = useOutsideClose(() => setSortOpen(false));

useEffect(() => {
  getAnnouncements()
    .then((data) => {
      const formattedAnnouncements = data.map((a) => ({
        id: a.id,
        title: a.title,
        date: a.date ? String(a.date).slice(0, 10) : "",
        description: a.description || "",
        status: a.status || "Active",
        pinned: Boolean(a.pinned),
        iconIndex: a.icon_index ?? 0,
      }));

      setAnnouncements(formattedAnnouncements);
    })
    .catch((error) => {
      console.error("Failed to load announcements:", error);
    });
}, []);

  // Go back to page 1 whenever the filters change.
  const filterKey = JSON.stringify([searchQuery, sortBy]);
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  if (pageFilterKey !== filterKey) {
    setPageFilterKey(filterKey);
    setCurrentPage(1);
  }

  const pinned = announcements.find((a) => a.pinned) || null;

  const list = useMemo(() => {
    let items = announcements.filter((a) => !a.pinned);

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (a) =>
          a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      );
    }

    items = [...items].sort((a, b) => {
      const diff = new Date(a.date) - new Date(b.date);
      return sortBy === "Newest First" ? -diff : diff;
    });

    return items;
  }, [announcements, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const paginated = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const togglePin = async (id) => {
  const selected = announcements.find((a) => a.id === id);

  if (!selected) return;

  const newPinnedValue = !selected.pinned;

  try {
    // Unpin all others first in the database
    if (newPinnedValue) {
      const othersPinned = announcements.filter(
        (a) => a.pinned && a.id !== id
      );

      for (const item of othersPinned) {
        await updateAnnouncement(item.id, {
          pinned: false,
        });
      }
    }

    const updated = await updateAnnouncement(id, {
      pinned: newPinnedValue,
    });

    setAnnouncements((prev) =>
      prev.map((a) => ({
        ...a,
        pinned:
          a.id === id
            ? Boolean(updated.pinned)
            : newPinnedValue
            ? false
            : a.pinned,
      }))
    );
  } catch (error) {
    console.error("Failed to pin announcement:", error);
    alert("Unable to update pinned announcement.");
  }
};

 const toggleStatus = async (id) => {
  const selected = announcements.find((a) => a.id === id);

  if (!selected) return;

  const newStatus =
    selected.status === "Active" ? "Archived" : "Active";

  try {
    const updated = await updateAnnouncement(id, {
      status: newStatus,
    });

    setAnnouncements((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: updated.status,
            }
          : a
      )
    );
  } catch (error) {
    console.error("Failed to update announcement status:", error);
    alert("Unable to update announcement status.");
  }
};

 const handleDeleteAnnouncement = async (id) => {
  if (!window.confirm("Delete this announcement? This cannot be undone.")) {
    return;
  }

  try {
    await deleteAnnouncement(id);

    setAnnouncements((prev) =>
      prev.filter((a) => a.id !== id)
    );
  } catch (error) {
    console.error("Failed to delete announcement:", error);
    alert("Unable to delete announcement.");
  }
};

const handleSave = async (form) => {
  if (modalMode === "create") {
    try {
      const iconIndex = Math.floor(Math.random() * ICONS.length);

      const created = await createAnnouncement({
        title: form.title,
        date: form.date,
        description: form.description,
        status: "Active",
        pinned: false,
        icon_index: iconIndex,
      });

      const newItem = {
        id: created.id,
        title: created.title,
        date: created.date ? String(created.date).slice(0, 10) : "",
        description: created.description || "",
        status: created.status || "Active",
        pinned: Boolean(created.pinned),
        iconIndex: created.icon_index ?? iconIndex,
      };

      setAnnouncements((prev) => [newItem, ...prev]);
      setModalMode(null);
    } catch (error) {
      console.error("Failed to create announcement:", error);
      alert("Unable to create announcement.");
    }

    return;
  }

  if (modalMode && modalMode.id) {
    try {
      const updated = await updateAnnouncement(modalMode.id, {
        title: form.title,
        date: form.date,
        description: form.description,
      });

      setAnnouncements((prev) =>
        prev.map((a) =>
          a.id === modalMode.id
            ? {
                ...a,
                title: updated.title,
                date: updated.date
                  ? String(updated.date).slice(0, 10)
                  : "",
                description: updated.description || "",
                status: updated.status || a.status,
                pinned: Boolean(updated.pinned),
                iconIndex: updated.icon_index ?? a.iconIndex,
              }
            : a
        )
      );

      setModalMode(null);
    } catch (error) {
      console.error("Failed to edit announcement:", error);
      alert("Unable to update announcement.");
    }
  }
};

  return (
    <div className="announcements">
      <div className="ann-heading">
        <div className="ann-heading-left">
          <div>
            <span className="ann-eyebrow">Communication</span>
            <h1>Announcements</h1>
            <p>Manage and publish announcements for senior citizens.</p>
          </div>
        </div>

        <div className="ann-heading-controls">
          <div className="search-box">
            <FiSearch />
            <input
              type="text"
              placeholder="Search announcements..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button type="button" className="btn-primary" onClick={() => setModalMode("create")}>
            <FiPlus /> Create Announcement
          </button>
        </div>
      </div>

      {pinned && (
        <div className="pinned-section">
          <h2 className="section-title">
            <BsPinAngleFill /> Pinned Announcement
          </h2>

          <div className="pinned-card">
            <div className="pinned-body">
              <span className="pinned-tag">
                <BsPinAngleFill /> PINNED
              </span>
              <h3>{pinned.title}</h3>
              <span className="pinned-date">
                <FiCalendar /> {formatDate(pinned.date)}
              </span>
              <p>{pinned.description}</p>
            </div>

            <div className="pinned-side">
              <button
                type="button"
                className={`status-badge ${pinned.status === "Active" ? "active" : "archived"}`}
                onClick={() => toggleStatus(pinned.id)}
              >
                <span className="status-dot" /> {pinned.status}
              </button>
              <button
                type="button"
                className="btn-outline btn-unpin"
                onClick={() => togglePin(pinned.id)}
              >
                <BsPinAngle /> Unpin Announcement
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="list-heading">
        <h2 className="section-title plain">All Announcements</h2>

        <div className="sort-wrap" ref={sortRef}>
          <button type="button" className="btn-outline" onClick={() => setSortOpen((o) => !o)}>
            Sort by: {sortBy}
            <FiChevronDown className={`chevron${sortOpen ? " open" : ""}`} />
          </button>
          {sortOpen && (
            <div className="dropdown-menu">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`dropdown-item${s === sortBy ? " active" : ""}`}
                  onClick={() => {
                    setSortBy(s);
                    setSortOpen(false);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="announcement-list">
        {paginated.map((a) => {
          const Icon = ICONS[a.iconIndex % ICONS.length];
          return (
            <div className="announcement-card" key={a.id}>
              <span className="announcement-icon">
                <Icon />
              </span>

              <div className="announcement-body">
                <h3>{a.title}</h3>
                <span className="announcement-date">
                  <FiCalendar /> {formatDate(a.date)}
                </span>
                <p>{a.description}</p>
              </div>

              <button
                type="button"
                className={`status-badge ${a.status === "Active" ? "active" : "archived"}`}
                onClick={() => toggleStatus(a.id)}
              >
                <span className="status-dot" /> {a.status}
              </button>

              <div className="announcement-actions">
                <button
                  type="button"
                  className="icon-square"
                  title="Pin announcement"
                  onClick={() => togglePin(a.id)}
                >
                  <FiStar />
                </button>
                <button
                  type="button"
                  className="icon-square edit"
                  title="Edit announcement"
                  onClick={() => setModalMode(a)}
                >
                  <FiEdit2 />
                </button>
                <button
                  type="button"
                  className="icon-square delete"
                  title="Delete announcement"
                 onClick={() => handleDeleteAnnouncement(a.id)}
                >
                  <FiTrash2 />
                </button>
              </div>
            </div>
          );
        })}

        {paginated.length === 0 && (
          <div className="empty-state">No announcements match your search.</div>
        )}
      </div>

      <div className="ann-pagination">
        <span className="pagination-summary">
          Showing {list.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to{" "}
          {Math.min(page * PAGE_SIZE, list.length)} of {list.length} announcements
        </span>
        <div className="pagination-controls">
          <button
            type="button"
            className="page-btn"
            disabled={page === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            &lsaquo;
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              className={`page-btn${p === page ? " active" : ""}`}
              onClick={() => setCurrentPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="page-btn"
            disabled={page === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            &rsaquo;
          </button>
        </div>
      </div>

      {modalMode && (
        <AnnouncementModal
          initial={modalMode === "create" ? null : modalMode}
          onClose={() => setModalMode(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
