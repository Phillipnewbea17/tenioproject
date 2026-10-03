import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSeniorIdsForSenior } from "../services/api";
import { formatDate } from "../utils/dates";
import "./SeniorIdStatus.css";

// Mirrors SeniorIdController: these count as the senior's current ID.
const CURRENT = ["Pending Issuance", "Active", "For Replacement"];

/**
 * OSCA ID section in the Records drawer: the senior's current OSCA ID,
 * or an "Issue ID" button. Styled with the drawer's rp-info section classes.
 */
export default function SeniorIdStatus({ seniorCitizenId }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ for: null, data: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    getSeniorIdsForSenior(seniorCitizenId)
      .then((data) => { if (!cancelled) setState({ for: seniorCitizenId, data, error: "" }); })
      .catch((error) => { if (!cancelled) setState({ for: seniorCitizenId, data: null, error: error.message || "Could not load the senior's ID." }); });
    return () => { cancelled = true; };
  }, [seniorCitizenId]);

  // Ignore results that belong to a previously opened senior.
  const ready = state.for === seniorCitizenId;
  const current = ready && state.data ? state.data.ids.find((id) => CURRENT.includes(id.status)) : null;
  const pastCount = ready && state.data ? state.data.ids.filter((id) => !CURRENT.includes(id.status)).length : 0;

  return <section className="rp-info sis">
    <h3>OSCA ID</h3>
    {!ready ? <p className="sis-note">Loading…</p>
    : state.error ? <p className="sis-note">{state.error}</p>
    : current ? <div className="sis-body">
      <div className="sis-main">
        <strong className="sis-number">{current.idNumber}</strong>
        <span className={`sis-status sis-status--${current.status === "Active" ? "active" : "pending"}`}>{current.status}</span>
      </div>
      <p className="sis-note">
        {current.dateIssued ? `Issued ${formatDate(current.dateIssued)}` : "Not yet released to the senior"}
        {pastCount > 0 && ` · ${pastCount} earlier ${pastCount === 1 ? "ID" : "IDs"}`}
      </p>
      <button type="button" className="sis-button" onClick={() => navigate(`/senior-ids?view=${current.id}`)}>View OSCA ID</button>
    </div>
    : state.data.eligible ? <div className="sis-body">
      <p className="sis-note">No OSCA ID yet{pastCount > 0 ? ` (${pastCount} earlier ${pastCount === 1 ? "ID is" : "IDs are"} inactive)` : ""}.</p>
      <button type="button" className="sis-button sis-button--primary" onClick={() => navigate(`/senior-ids?issue=${seniorCitizenId}`)}>Issue OSCA ID</button>
    </div>
    : <p className="sis-note">This record is archived, inactive or deceased, so no OSCA ID can be issued.</p>}
  </section>;
}
