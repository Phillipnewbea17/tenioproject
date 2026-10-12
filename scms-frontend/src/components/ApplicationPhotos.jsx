import { useEffect, useState } from "react";
import { getApplicationDocumentFile } from "../services/api";
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
 * The list is fetched by the drawer, which also uses it to put each photo
 * on its row in the required-documents checklist.
 */
export default function ApplicationPhotos({ loading, documents, error }) {
  return <section className="ap">
    <div className="ap-head">
      <h3>Uploaded photos</h3>
      <span>From the senior app</span>
    </div>
    {loading ? <p className="ap-note">Loading photos…</p>
    : error ? <p className="ap-note ap-note--error">{error}</p>
    : documents.length === 0 ? <p className="ap-note">No photos were uploaded.</p>
    : <div className="ap-grid">{documents.map((document) => <Photo key={document.id} document={document} />)}</div>}
  </section>;
}
