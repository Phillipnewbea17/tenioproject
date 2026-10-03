import { useState, useRef, useEffect } from "react";
import { TbChevronDown, TbMenu2, TbSettings } from "react-icons/tb";
import "./Header.css";

/**
 * Top bar ("style A" mockup): welcome text on the left, account menu on the
 * right. The menu button collapses the sidebar (desktop) or opens it (phones).
 * Logout lives at the bottom of the sidebar.
 *
 * Props:
 * - adminName: shown in "Welcome, {adminName}!" and the account button
 * - onMenuClick: toggles the sidebar
 * - sidebarExpanded: whether the sidebar is currently showing its labels
 * - avatarUrl: optional image; falls back to the name's first letter
 */
export default function Header({
  adminName = "Admin",
  onMenuClick,
  sidebarExpanded = true,
  avatarUrl,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function handleKey(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const initial = (adminName.trim()[0] || "A").toUpperCase();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button
          type="button"
          className="app-header-menu-btn"
          onClick={onMenuClick}
          aria-label={sidebarExpanded ? "Collapse menu" : "Expand menu"}
          aria-expanded={sidebarExpanded}
        >
          <TbMenu2 strokeWidth={1.8} />
        </button>
        <span className="app-header-welcome">Welcome, {adminName}!</span>
      </div>

      <div className="app-header-right" ref={dropdownRef}>
        <button
          type="button"
          className="app-header-profile"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Account menu for ${adminName}`}
        >
          <span className="app-header-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
          </span>
          <span className="app-header-admin-name">{adminName}</span>
          <TbChevronDown
            className={`app-header-chevron${menuOpen ? " open" : ""}`}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </button>

        {menuOpen && (
          <div className="app-header-dropdown" role="menu">
            <button type="button" className="app-header-dropdown-item" role="menuitem">
              <TbSettings strokeWidth={1.8} aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
