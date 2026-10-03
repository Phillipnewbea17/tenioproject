import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { logoutUser } from "./services/api";

import Login from "./Pages/Login";
import AdminLayout from "./Pages/AdminLayout";
import Dashboard from "./Pages/Dashboard";
import DocumentVerification from "./Pages/DocumentVerification";
import Records from "./Pages/Records";
import Announcements from "./Pages/Announcements";
import BirthdayList from "./Pages/BirthdayList";
import ResetPassword from "./Pages/ResetPassword";
import ForgotPassword from "./Pages/ForgotPassword";
import Pension from "./Pages/Pension";
import UserManagement from "./Pages/UserManagement";
import Medical from "./Pages/Medical";
import Burial from "./Pages/Burial";
import SeniorIds from "./Pages/SeniorIds";
import Reports from "./Pages/Reports";
import ActivityLog from "./Pages/ActivityLog";
import Funds from "./Pages/Funds";
import HelpDesk from "./Pages/HelpDesk";

import "./index.css";

const AUTH_KEY = "scms_is_authenticated";
const NAME_KEY = "scms_admin_name";
const TOKEN_KEY = "scms_token";
const ROLE_KEY = "scms_role";

function ProtectedRoute({ isAuthenticated, children }) {
  return isAuthenticated ? (
    children
  ) : (
    <Navigate to="/login" replace />
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () =>
      Boolean(localStorage.getItem(TOKEN_KEY)) ||
      Boolean(sessionStorage.getItem(TOKEN_KEY))
  );

  const [adminName, setAdminName] = useState(
    () =>
      localStorage.getItem(NAME_KEY) ||
      sessionStorage.getItem(NAME_KEY) ||
      "Admin"
  );

  const handleLoginSuccess = (username, remember) => {
    setIsAuthenticated(true);
    setAdminName(username);

    if (remember) {
      localStorage.setItem(AUTH_KEY, "true");
      localStorage.setItem(NAME_KEY, username);
      sessionStorage.removeItem(NAME_KEY);
    } else {
      sessionStorage.setItem(NAME_KEY, username);
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(NAME_KEY);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (error) {
      console.error("Laravel logout failed:", error);
    } finally {
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(NAME_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);

      sessionStorage.removeItem(NAME_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(ROLE_KEY);

      setIsAuthenticated(false);
    }
  };

  return (
    <Routes>
      {/* Public pages */}
      <Route
        path="/reset-password"
        element={<ResetPassword />}
      />

      <Route
        path="/forgot-password"
        element={<ForgotPassword />}
      />

      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Login onLoginSuccess={handleLoginSuccess} />
          )
        }
      />

      {/* Protected pages with the shared sidebar and header */}
      <Route
        path="/"
        element={
          <ProtectedRoute isAuthenticated={isAuthenticated}>
            <AdminLayout
              onLogout={handleLogout}
              adminName={adminName}
            />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<Navigate to="/dashboard" replace />}
        />

        <Route
          path="dashboard"
          element={<Dashboard />}
        />

        <Route
          path="user-management"
          element={<UserManagement />}
        />

        <Route
          path="document-verification"
          element={<DocumentVerification />}
        />

        <Route
          path="records"
          element={<Records />}
        />

        <Route
          path="senior-ids"
          element={<SeniorIds />}
        />

        <Route
          path="reports"
          element={<Reports />}
        />

        <Route
          path="funds"
          element={<Funds />}
        />

        <Route
          path="help-desk"
          element={<HelpDesk />}
        />

        <Route
          path="activity-log"
          element={<ActivityLog />}
        />

        <Route
          path="announcements"
          element={<Announcements />}
        />

        <Route
          path="birthday-list"
          element={<BirthdayList />}
        />

        <Route
          path="pension"
          element={<Pension />}
        />

        <Route
          path="medical"
          element={<Medical />}
        />

        <Route
          path="burial"
          element={<Burial />}
        />
      </Route>

      {/* Unknown URLs */}
      <Route
        path="*"
        element={
          <Navigate
            to={isAuthenticated ? "/dashboard" : "/login"}
            replace
          />
        }
      />
    </Routes>
  );
}