import {
  TbActivity,
  TbCake,
  TbChartBar,
  TbCurrencyPeso,
  TbFileCheck,
  TbFlower,
  TbFolder,
  TbHome,
  TbId,
  TbLifebuoy,
  TbLogout,
  TbMedicalCross,
  TbSpeakerphone,
  TbUsers,
  TbWallet,
  TbX,
} from "react-icons/tb";
import scmsLogo from "../assets/scms-logo.png";
import "./Sidebar.css";

// Grouped like the "style A" mockup. Keys match PATH_TO_KEY in AdminLayout.jsx.
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", icon: TbHome }],
  },
  {
    label: "People and records",
    items: [
      { key: "user-management", label: "User Management", icon: TbUsers },
      { key: "verification", label: "Document Verification", icon: TbFileCheck },
      { key: "records", label: "Records", icon: TbFolder },
      { key: "senior-ids", label: "OSCA IDs", icon: TbId },
    ],
  },
  {
    label: "Communication",
    items: [
      { key: "announcements", label: "Announcements", icon: TbSpeakerphone },
      { key: "birthday", label: "Birthday List", icon: TbCake },
      { key: "help-desk", label: "Help & Complaints", icon: TbLifebuoy },
    ],
  },
  {
    label: "Program Management",
    items: [
      { key: "pension", label: "Pension", icon: TbWallet },
      { key: "medical", label: "Medical", icon: TbMedicalCross },
      { key: "burial", label: "Burial", icon: TbFlower },
      { key: "funds", label: "Fund Management", icon: TbCurrencyPeso },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { key: "reports", label: "Reports", icon: TbChartBar },
      { key: "activity-log", label: "Activity Log", icon: TbActivity },
    ],
  },
];

/**
 * Responsive behavior (see Sidebar.css):
 * - Desktop (>768px): column beside the page. When the layout has the
 *   sidebar-collapsed class it shrinks to an icon rail (labels become tooltips).
 * - Mobile (<=768px): off-canvas drawer, opened from the header's menu button.
 */
export default function Sidebar({
  activeKey = "dashboard",
  onNavigate,
  onLogout,
  isOpen = false,
  onClose,
}) {
  const handleNavigate = (key) => {
    onNavigate && onNavigate(key);
    // Close the drawer on mobile after picking a page.
    onClose && onClose();
  };

  return (
    <>
      {/* Dark overlay behind the drawer on mobile; click to dismiss */}
      <div
        className={`sidebar-overlay${isOpen ? " visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar${isOpen ? " open" : ""}`}>
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">
            <img src={scmsLogo} alt="" />
          </span>
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-title">Senior Citizen</span>
            <span className="sidebar-logo-subtitle">Management System</span>
          </div>

          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <TbX />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="sidebar-nav-group">
              <div className="sidebar-nav-heading">{group.label}</div>
              {group.items.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`sidebar-nav-item${key === activeKey ? " active" : ""}`}
                  title={label}
                  onClick={() => handleNavigate(key)}
                  aria-current={key === activeKey ? "page" : undefined}
                >
                  <Icon className="sidebar-nav-icon" strokeWidth={1.8} aria-hidden="true" />
                  <span className="sidebar-nav-label">{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="sidebar-logout" onClick={onLogout} title="Logout">
            <TbLogout className="sidebar-nav-icon" strokeWidth={1.8} aria-hidden="true" />
            <span className="sidebar-nav-label">Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
