import { useEffect, useState } from "react";
import { getApplicationDocumentFile, getApplicationDocuments } from "../services/api";
import "./ApplicationPhotos.css";

/** One photo: fetched with the staff login, shown from a temporary object URL. */
function Photo({ document }) {
  const [state, setState] = useState({ url: "", error: "" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    getApplicationDocumentFile(document.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setState({ url: objectUrl, error: "" });
      })
      .catch((error) => { if (!cancelled) setState({ url: "", error: error.message || "Could not load the photo." }); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id]);

  const kb = Math.max(1, Math.round(document.size / 1024));

  return <figure className="ap-photo">
    {state.url
      ? <a href={state.url} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img src={state.url} alt={document.label} />
        </a>
      : <div className="ap-placeholder">{state.error || "Loading…"}</div>}
    <figcaption>
      <strong>{document.label}</strong>
      <span>{kb.toLocaleString()} KB{state.url ? " · select to open full size" : ""}</span>
    </figcaption>
  </figure>;
}

/**
 * Photos a senior uploaded from the app for this application, shown in the
 * Document Verification drawer so staff can check the actual papers.
 */
export default function ApplicationPhotos({ applicationId }) {
  const [state, setState] = useState({ for: null, documents: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    getApplicationDocuments(applicationId)
      .then((documents) => { if (!cancelled) setState({ for: applicationId, documents, error: "" }); })
      .catch((error) => { if (!cancelled) setState({ for: applicationId, documents: [], error: error.message || "Could not load the photos." }); });
    return () => { cancelled = true; };
  }, [applicationId]);

  const ready = state.for === applicationId;

  return <section className="ap">
    <div className="ap-head">
      <h3>Uploaded photos</h3>
      <span>From the senior app</span>
    </div>
    {!ready ? <p className="ap-note">Loading photos…</p>
    : state.error ? <p className="ap-note ap-note--error">{state.error}</p>
    : state.documents.length === 0 ? <p className="ap-note">No photos were uploaded.</p>
    : <div className="ap-grid">{state.documents.map((document) => <Photo key={document.id} document={document} />)}</div>}
  </section>;
}
