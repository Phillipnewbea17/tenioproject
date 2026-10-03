import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSeniorHelpHistory } from "../services/api";
import "./SeniorHelpHistory.css";

const STATUS_LABEL = { Resolved: "Fixed / resolved" };

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Senior Help History: the requests and complaints from one senior, shown in
 * the Records drawer. Styled with the drawer's own rp-info section classes.
 */
export default function SeniorHelpHistory({ seniorCitizenId }) {
  const [state, setState] = useState({ id: null, requests: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    getSeniorHelpHistory(seniorCitizenId)
      .then((requests) => { if (!cancelled) setState({ id: seniorCitizenId, requests, error: "" }); })
      .catch((error) => { if (!cancelled) setState({ id: seniorCitizenId, requests: [], error: error.message || "Could not load help history." }); });
    return () => { cancelled = true; };
  }, [seniorCitizenId]);

  // Ignore results that belong to a previously opened senior.
  const requests = state.id === seniorCitizenId ? state.requests : null;

  return <section className="rp-info shh">
    <h3>Help history</h3>
    {state.error && state.id === seniorCitizenId ? <p className="shh-empty">{state.error}</p>
    : requests === null ? <p className="shh-empty">Loading…</p>
    : requests.length === 0 ? <p className="shh-empty">No requests or complaints recorded.</p>
    : <ul className="shh-list">
      {requests.map((r) => <li key={r.id} className="shh-item">
        <div className="shh-main">
          <strong>{r.subject}</strong>
          <span>{r.reference} · {formatDate(r.submittedAt)} · {r.category}</span>
          {r.assignedName && <span>Assigned to {r.assignedName}</span>}
          {r.resolution && <span className="shh-resolution">Resolution: {r.resolution}</span>}
        </div>
        <span className={`shh-status shh-status--${r.status.replace(/\s+/g, "-").toLowerCase()}`}>{STATUS_LABEL[r.status] || r.status}</span>
      </li>)}
    </ul>}
    <div className="shh-footer"><Link to="/help-desk">Open Help &amp; Complaint Desk</Link></div>
  </section>;
}
