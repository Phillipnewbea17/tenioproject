import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginUser } from "../services/api";
import "./Login.css";
import { FaUsers, FaUser, FaEye, FaEyeSlash, FaShieldAlt } from "react-icons/fa";


/**
 * Props:
 * - onLoginSuccess(username): called once credentials are accepted, before
 *   navigating away. Use it to store the auth flag / admin name in App.
 */
export default function Login({ onLoginSuccess }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

 const handleSubmit = async (e) => {
  e.preventDefault();

  if (!username.trim() || !password.trim()) {
    setError("Please enter both username and password.");
    return;
  }

  try {
    setError("");
    setIsSubmitting(true);

    const data = await loginUser(
      username.trim(),
      password
    );

    // The role only decides which buttons are shown; the server still checks
    // every permission.
    const role = data.user?.role || "User";

    if (remember) {
  localStorage.setItem("scms_token", data.token);
  localStorage.setItem("scms_role", role);
  sessionStorage.removeItem("scms_token");
  sessionStorage.removeItem("scms_role");
} else {
  sessionStorage.setItem("scms_token", data.token);
  sessionStorage.setItem("scms_role", role);
  localStorage.removeItem("scms_token");
  localStorage.removeItem("scms_role");
}

    onLoginSuccess(data.user.name, remember);

    navigate("/dashboard", { replace: true });
  } catch (error) {
    setError(error.message || "Invalid username or password.");
  } finally {
    setIsSubmitting(false);
  }
};

  return (
    <main className="login-container">
      <section className="login-welcome" aria-label="SCMS introduction">
        <div className="login-brand-mark"><FaUsers /></div>
        <p className="login-eyebrow">SCMS ADMIN PORTAL</p>
        <h1>Care starts with organized information.</h1>
        <p>Securely manage senior citizen records, document verification, announcements, and community services in one place.</p>
        <div className="login-security-note"><FaShieldAlt aria-hidden="true" /><span>Authorized personnel only</span></div>
      </section>

      <section className="login-card" aria-labelledby="login-title">
        <div className="icon-circle" aria-hidden="true"><FaUser /></div>

        <p className="login-card-kicker">Welcome back</p>
        <h2 id="login-title">Sign in to your account</h2>
        <p className="login-card-copy">Enter your administrator credentials to continue.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="login-username">Username</label>
          <div className="input-box">
            <input
              id="login-username"
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <FaUser className="input-icon" />
          </div>

          <label htmlFor="login-password">Password</label>
          <div className="input-box">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>

          {error && <p className="login-error">{error}</p>}

          <div className="options">
            <label className="remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember Me
            </label>
            <a href="/forgot-password">Forgot Password?</a>
          </div>

          <button type="submit" className="login-btn" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
