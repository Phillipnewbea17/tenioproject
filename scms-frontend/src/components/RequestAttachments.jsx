import { useEffect, useState } from "react";
import { getRequestAttachments, getRequestAttachmentFile } from "../services/api";
import "./RequestAttachments.css";

/** One attachment: fetched with the staff login, shown from a temporary object URL. */
function Attachment({ attachment }) {
  const [state, setState] = useState({ url: "", error: "" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    getRequestAttachmentFile(attachment.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setState({ url: objectUrl, error: "" });
      })
      .catch((error) => {
        if (!cancelled) setState({ url: "", error: error.message || "Could not load the file." });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  const kb = Math.max(1, Math.round(attachment.size / 1024));
  const isPdf = attachment.mime_type === "application/pdf";
  const name = attachment.original_name || (isPdf ? "Document" : "Photo");

  return <figure className="ra-item">
    {state.url
      ? <a href={state.url} target="_blank" rel="noopener noreferrer" title="Open full size">
          {isPdf
            ? <span className="ra-placeholder ra-placeholder--file">PDF</span>
            : <img src={state.url} alt={name} />}
        </a>
      : <div className="ra-placeholder">{state.error || "Loading…"}</div>}
    <figcaption>
      <strong title={name}>{name}</strong>
      <span>{kb.toLocaleString()} KB{state.url ? " · select to open full size" : ""}</span>
    </figcaption>
  </figure>;
}

/**
 * Photos (or PDFs) the senior sent from the app with one request, so staff
 * can see the evidence behind a complaint. Fetches its own list, so a module
 * drawer only has to say which record it is showing.
 *
 * "module" is one of medical | burial | help | senior-id.
 */
export default function RequestAttachments({ module, recordId, title = "Attached photos" }) {
  // Keyed by the record it belongs to, so switching records reads as
  // "loading" without resetting state from inside the effect.
  const [state, setState] = useState({ for: null, items: [], error: "" });

  useEffect(() => {
    if (!recordId) return undefined;

    let cancelled = false;
    getRequestAttachments(module, recordId)
      .then((items) => {
        if (!cancelled) setState({ for: recordId, items: Array.isArray(items) ? items : [], error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ for: recordId, items: [], error: error.message || "Could not load the attachments." });
        }
      });

    return () => { cancelled = true; };
  }, [module, recordId]);

  const loaded = state.for === recordId;
  const { items, error } = state;

  return <section className="ra">
    <div className="ra-head">
      <h3>{title}</h3>
      <span>From the senior app</span>
    </div>
    {!loaded ? <p className="ra-note">Loading…</p>
    : error ? <p className="ra-note ra-note--error">{error}</p>
    : items.length === 0 ? <p className="ra-note">No photos were attached.</p>
    : <div className="ra-grid">{items.map((item) => <Attachment key={item.id} attachment={item} />)}</div>}
  </section>;
}
