import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiRefreshCw, FiX } from "react-icons/fi";
import { formatDate, formatDateTime } from "../utils/dates";
import {
  approveIdentityVerification,
  getIdentityVerifications,
  getIdentityVerificationSelfie,
  rejectIdentityVerification,
} from "../services/api";
import "./AppVerification.css";

// Senior app accounts asking to be linked to their senior record. The
// backend already checked that the ID number, name and birthday match the
// record; staff compare the live selfie with the senior, then approve
// (the app account is linked) or reject (the senior can try again).
const FILTERS = ["Pending", "Approved", "Rejected", "Failed", "All"];

const FAILURES = {
  not_found: "No record with that ID number",
  info_mismatch: "Name or birthday did not match",
};

function Selfie({ id }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = null;
    let alive = true;
    getIdentityVerificationSelfie(id)
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
  if (!url) return <p className="scms-av-muted">Loading selfie…</p>;
  return <img className="scms-av-selfie" src={url} alt="Live selfie sent from the app" />;
}

function Row({ label, sent, record }) {
  const differs = record !== undefined && record !== null && String(sent || "") !== String(record || "");
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{sent || "—"}</td>
      {record !== undefined && <td className={differs ? "scms-av-differs" : ""}>{record || "—"}</td>}
    </tr>
  );
}

function VerificationCard({ item, onDone }) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sent = item.submitted || {};
  const senior = item.senior;
  const name = [sent.firstName, sent.middleName, sent.lastName, sent.suffix].filter(Boolean).join(" ");

  const act = async (action) => {
    if (action === "reject" && !remarks.trim()) {
      setError("Please write the reason, so the senior knows what to do.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (action === "approve") await approveIdentityVerification(item.id, remarks.trim());
      else await rejectIdentityVerification(item.id, remarks.trim());
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
          <strong>{senior ? senior.name : name || "Unknown"}</strong>
          <span className="scms-av-muted"> · app account {item.phone}</span>
        </div>
        <span className={`scms-av-status scms-av-status-${item.status.toLowerCase()}`}>{item.status}</span>
      </header>

      <div className="scms-av-body">
        {item.has_selfie ? <Selfie id={item.id} /> : <div className="scms-av-noselfie">No selfie</div>}

        <div className="scms-av-details">
          <table className="scms-av-table">
            <thead>
              <tr>
                <th />
                <th scope="col">Sent from the app</th>
                {senior && <th scope="col">Senior record {senior.senior_id}</th>}
              </tr>
            </thead>
            <tbody>
              <Row label="Name" sent={name} record={senior ? senior.name : undefined} />
              <Row label="Birthday" sent={formatDate(sent.birthDate)} record={senior ? formatDate(senior.birth_date) : undefined} />
              <Row label="ID number" sent={sent.seniorId} />
              {senior && <Row label="Purok" sent="" record={senior.purok} />}
            </tbody>
          </table>
          <p className="scms-av-muted">
            Sent {formatDateTime(item.created_at)}
            {item.failure && ` · ${FAILURES[item.failure] || item.failure}`}
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
                  <FiCheck aria-hidden="true" /> Same person: link account
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

export default function AppVerification() {
  const [filter, setFilter] = useState("Pending");
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getIdentityVerifications(filter)
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
          <h1>App Account Verification</h1>
          <p className="scms-av-muted">
            Seniors who signed up in the mobile app. Their ID number, name and birthday already match the record.
            Check that the selfie is the same person before linking the account.
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
      {!loading && items.map((item) => <VerificationCard key={item.id} item={item} onDone={load} />)}
    </div>
  );
}
