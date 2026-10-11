import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiRefreshCw, FiX } from "react-icons/fi";
import { formatDateTime } from "../utils/dates";
import {
  approveProfileCorrection,
  getProfileCorrectionAttachment,
  getProfileCorrections,
  rejectProfileCorrection,
} from "../services/api";
import "./AppVerification.css";

// Seniors asking, from the mobile app, to correct one detail of their
// record (name, birthday, address...). Approving does not change the record
// by itself: correct it in Records first, then approve. The remarks are
// shown to the senior in the app.
const FILTERS = ["Pending", "Approved", "Rejected", "All"];

function Attachment({ id }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = null;
    let alive = true;
    getProfileCorrectionAttachment(id)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (error) return <p className="scms-av-error">{error}</p>;
  if (!url) return <p className="scms-av-muted">Loading photo…</p>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="scms-av-selfie" src={url} alt="Supporting document sent from the app" />
    </a>
  );
}

function CorrectionCard({ item, onDone }) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const senior = item.senior;

  const act = async (action) => {
    if (action === "reject" && !remarks.trim()) {
      setError("Please write the reason, so the senior knows what to do.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (action === "approve") await approveProfileCorrection(item.id, remarks.trim());
      else await rejectProfileCorrection(item.id, remarks.trim());
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="scms-av-card">
      <header className="scms-av-card-head">
        <div>
          <strong>{senior ? senior.name : item.account_name || "Unknown"}</strong>
          <span className="scms-av-muted">
            {senior && ` · ${senior.senior_id}`} · app account {item.phone} · {item.reference}
          </span>
        </div>
        <span className={`scms-av-status scms-av-status-${item.status.toLowerCase()}`}>{item.status}</span>
      </header>

      <div className="scms-av-body">
        {item.has_attachment ? <Attachment id={item.id} /> : <div className="scms-av-noselfie">No photo</div>}

        <div className="scms-av-details">
          <table className="scms-av-table">
            <tbody>
              <tr>
                <th scope="row">Detail</th>
                <td>{item.field_label}</td>
              </tr>
              <tr>
                <th scope="row">Now in the app</th>
                <td>{item.current_value || "—"}</td>
              </tr>
              <tr>
                <th scope="row">Should be</th>
                <td className="scms-av-differs">{item.requested_value}</td>
              </tr>
              <tr>
                <th scope="row">Reason</th>
                <td>{item.reason}</td>
              </tr>
            </tbody>
          </table>
          <p className="scms-av-muted">
            Sent {formatDateTime(item.created_at)}
            {item.reviewed_by && ` · ${item.status} by ${item.reviewed_by} ${formatDateTime(item.reviewed_at)}`}
          </p>
          {item.remarks && <p>Remarks: {item.remarks}</p>}

          {item.status === "Pending" && (
            <div className="scms-av-actions">
              <label htmlFor={`remarks-${item.id}`}>Remarks (required to reject; the senior is told)</label>
              <textarea
                id={`remarks-${item.id}`}
                rows={2}
                maxLength={1000}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                disabled={busy}
              />
              {error && <p className="scms-av-error" role="alert">{error}</p>}
              <div className="scms-av-buttons">
                <button type="button" className="scms-av-approve" onClick={() => act("approve")} disabled={busy}>
                  <FiCheck aria-hidden="true" /> Record corrected: approve
                </button>
                <button type="button" className="scms-av-reject" onClick={() => act("reject")} disabled={busy}>
                  <FiX aria-hidden="true" /> Reject
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function AppCorrections() {
  const [filter, setFilter] = useState("Pending");
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getProfileCorrections(filter)
      .then((data) => alive && (setItems(data), setError("")))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [filter, reloadKey]);

  const load = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const choose = (f) => {
    if (f === filter) return;
    setLoading(true);
    setFilter(f);
  };

  return (
    <div className="scms-av">
      <header className="scms-av-page-head">
        <div>
          <h1>App Correction Requests</h1>
          <p className="scms-av-muted">
            Seniors asking to correct a detail of their record from the mobile app. Approving does not change the
            record: correct it in Records first, then approve.
          </p>
        </div>
        <button type="button" className="scms-av-refresh" onClick={load} disabled={loading}>
          <FiRefreshCw aria-hidden="true" /> Refresh
        </button>
      </header>

      <div className="scms-av-filters" role="tablist" aria-label="Status">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? "is-active" : ""}
            onClick={() => choose(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="scms-av-error" role="alert">{error}</p>}
      {loading && <p className="scms-av-muted">Loading…</p>}
      {!loading && !error && items.length === 0 && <p className="scms-av-muted">Nothing here.</p>}
      {!loading && items.map((item) => <CorrectionCard key={item.id} item={item} onDone={load} />)}
    </div>
  );
}
