import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import "./AdminLayout.css";

const PATH_TO_KEY = {
  "/dashboard": "dashboard",
  "/document-verification": "verification",
  "/records": "records",
  "/announcements": "announcements",
  "/birthday-list": "birthday",
  "/pension": "pension",
  "/user-management": "user-management",
  "/medical": "medical",
  "/burial": "burial",
  "/senior-ids": "senior-ids",
  "/funds": "funds",
  "/help-desk": "help-desk",
  "/reports": "reports",
  "/activity-log": "activity-log"
};

const COLLAPSED_KEY = "scms_sidebar_collapsed";

// The collapsed/expanded choice is a per-browser convenience; storage can be
// unavailable (private windows), so failures are ignored.
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    /* ignore */
  }
}

const isPhone = () => window.matchMedia("(max-width: 768px)").matches;

const KEY_TO_PATH = Object.fromEntries(
  Object.entries(PATH_TO_KEY).map(([path, key]) => [key, path])
);

export default function AdminLayout({ onLogout, adminName }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Desktop: the menu button collapses the sidebar to an icon rail.
  // Phones: the sidebar is a drawer that the menu button opens.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleMenuClick = () => {
    if (isPhone()) {
      setSidebarOpen((open) => !open);
    } else {
      const next = !sidebarCollapsed;
      saveCollapsed(next);
      setSidebarCollapsed(next);
    }
  };

  const activeKey = PATH_TO_KEY[location.pathname] || "dashboard";

  const handleNavigate = (key) => {
    navigate(KEY_TO_PATH[key] || "/dashboard");
  };

  return (
    <div className={`admin-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar
        activeKey={activeKey}
        onNavigate={handleNavigate}
        onLogout={onLogout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="admin-layout-content">
        <Header
          adminName={adminName}
          onMenuClick={handleMenuClick}
          sidebarExpanded={!sidebarCollapsed}
        />

        <main className="admin-layout-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}