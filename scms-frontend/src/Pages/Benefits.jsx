import { useEffect, useMemo, useState } from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiEdit2,
  FiEye,
  FiEyeOff,
  FiPlus,
  FiSearch,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import {
  createBenefit,
  deleteBenefit,
  getBenefits,
  updateBenefit,
} from "../services/api";
import ModalDialog from "../components/ModalDialog";
import useSubmit from "../hooks/useSubmit";
import "./Benefits.css";

// Mirrors BenefitCategory in the senior app; the API rejects anything else.
const CATEGORY_LABEL = {
  discount: "Discounts",
  health: "Health",
  pension: "Pension",
  assistance: "Other help",
};

const EMPTY_FORM = {
  title: "",
  category: "discount",
  summary: "",
  details: "",
  how_to_get: [""],
  status: "Active",
};

function toForm(benefit) {
  return {
    title: benefit.title || "",
    category: benefit.category || "discount",
    summary: benefit.summary || "",
    details: benefit.details || "",
    how_to_get: benefit.how_to_get?.length ? [...benefit.how_to_get] : [""],
    status: benefit.status || "Active",
  };
}

/** Add or edit one card. Steps are a short ordered list, like the app shows. */
function BenefitDialog({ benefit, onClose, onSave }) {
  const editing = Boolean(benefit);
  const [form, setForm] = useState(() => (benefit ? toForm(benefit) : EMPTY_FORM));
  const [errors, setErrors] = useState({});
  const { submit, saving, saveError } = useSubmit(async (payload) => {
    await onSave(payload);
    onClose();
  });

  const set = (name) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  function setStep(index, value) {
    setForm((current) => {
      const steps = [...current.how_to_get];
      steps[index] = value;
      return { ...current, how_to_get: steps };
    });
  }

  function addStep() {
    setForm((current) => ({ ...current, how_to_get: [...current.how_to_get, ""] }));
  }

  function removeStep(index) {
    setForm((current) => {
      const steps = current.how_to_get.filter((_, i) => i !== index);
      return { ...current, how_to_get: steps.length ? steps : [""] };
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    const next = {};
    if (!form.title.trim()) next.title = "Give the benefit a short title.";
    if (!form.summary.trim()) next.summary = "Write the one line seniors see first.";
    if (Object.keys(next).length) return setErrors(next);

    submit({
      ...form,
      title: form.title.trim(),
      summary: form.summary.trim(),
      details: form.details.trim(),
      how_to_get: form.how_to_get.map((s) => s.trim()).filter(Boolean),
    });
  }

  return <ModalDialog
    prefix="ben"
    title={editing ? "Edit benefit" : "Add a benefit"}
    subtitle="Seniors read this in &ldquo;Benefits & services&rdquo; in the app."
    onClose={onClose}
  >
    <form className="ben-form" noValidate onSubmit={handleSubmit}>
      <div className="ben-dialog-body">
        {saveError && <div className="ben-message ben-message--error" role="alert">
          <FiAlertCircle aria-hidden="true" /><span>{saveError}</span>
        </div>}

        <div className="ben-field">
          <label htmlFor="ben-title">Title <span aria-hidden="true">*</span></label>
          <input id="ben-title" data-initial-focus value={form.title} maxLength={255}
            aria-invalid={Boolean(errors.title)} onChange={set("title")}
            placeholder="e.g. 20% discount and no VAT" />
          {errors.title && <span className="ben-error">{errors.title}</span>}
        </div>

        <div className="ben-field-row">
          <div className="ben-field">
            <label htmlFor="ben-category">Category</label>
            <select id="ben-category" value={form.category} onChange={set("category")}>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) =>
                <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="ben-field">
            <label htmlFor="ben-status">Shown in the app</label>
            <select id="ben-status" value={form.status} onChange={set("status")}>
              <option value="Active">Yes, show it</option>
              <option value="Hidden">No, hide it</option>
            </select>
          </div>
        </div>

        <div className="ben-field">
          <label htmlFor="ben-summary">One-line summary <span aria-hidden="true">*</span></label>
          <input id="ben-summary" value={form.summary} maxLength={255}
            aria-invalid={Boolean(errors.summary)} onChange={set("summary")}
            placeholder="e.g. On medicines, restaurants, hotels and public transport." />
          {errors.summary && <span className="ben-error">{errors.summary}</span>}
        </div>

        <div className="ben-field">
          <label htmlFor="ben-details">Full explanation</label>
          <textarea id="ben-details" rows={4} maxLength={5000} value={form.details}
            onChange={set("details")}
            placeholder="What the benefit is, and the law it comes from (e.g. RA 9994)." />
          <span className="ben-hint">Name the law when there is one, so staff can answer questions.</span>
        </div>

        <fieldset className="ben-steps">
          <legend>How to get it</legend>
          <span className="ben-hint">One step per line, in the order a senior should follow.</span>
          {form.how_to_get.map((step, index) => (
            <div className="ben-step-row" key={index}>
              <span className="ben-step-number">{index + 1}</span>
              <input value={step} maxLength={255}
                onChange={(event) => setStep(index, event.target.value)}
                placeholder="e.g. Show your Senior Citizen ID to the cashier." />
              <button type="button" className="ben-icon-button" aria-label={`Remove step ${index + 1}`}
                onClick={() => removeStep(index)}>
                <FiX aria-hidden="true" />
              </button>
            </div>
          ))}
          {form.how_to_get.length < 10 && <button type="button" className="ben-button ben-button--ghost ben-button--small" onClick={addStep}>
            <FiPlus aria-hidden="true" /> Add a step
          </button>}
        </fieldset>
      </div>

      <footer className="ben-dialog-footer">
        <button type="button" className="ben-button ben-button--secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="ben-button ben-button--primary" disabled={saving}>
          <FiCheck aria-hidden="true" /> {saving ? "Saving…" : editing ? "Save changes" : "Add benefit"}
        </button>
      </footer>
    </form>
  </ModalDialog>;
}

export default function Benefits() {
  const [benefits, setBenefits] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [dialog, setDialog] = useState(null); // null | "create" | benefit
  const [confirmDelete, setConfirmDelete] = useState(null);

  function apply(result) {
    setBenefits(result.benefits || []);
    setLoadError("");
  }

  function fail(error) {
    setBenefits([]);
    setLoadError(error.message || "Could not load the benefits.");
  }

  /** Reload after a change; called from the handlers below. */
  async function load() {
    try {
      apply(await getBenefits());
    } catch (error) {
      fail(error);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getBenefits()
      .then((result) => { if (!cancelled) apply(result); })
      .catch((error) => { if (!cancelled) fail(error); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (benefits || []).filter((b) =>
      (category === "All" || b.category === category) &&
      (!query || [b.title, b.summary, b.details].some((v) => (v || "").toLowerCase().includes(query))));
  }, [benefits, search, category]);

  async function save(form) {
    if (dialog === "create") await createBenefit(form);
    else await updateBenefit(dialog.id, form);
    await load();
  }

  async function toggleStatus(benefit) {
    const status = benefit.status === "Active" ? "Hidden" : "Active";
    setBenefits((current) =>
      current.map((b) => (b.id === benefit.id ? { ...b, status } : b)));
    try {
      await updateBenefit(benefit.id, { status });
    } catch {
      await load(); // put the real value back
    }
  }

  async function remove() {
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteBenefit(target.id);
      await load();
    } catch (error) {
      setLoadError(error.message || "Could not delete the benefit.");
    }
  }

  const activeCount = (benefits || []).filter((b) => b.status === "Active").length;

  return <div className="benefits">
    <div className="ben-heading">
      <div>
        <span className="ben-eyebrow">Communication</span>
        <h1>Benefits</h1>
        <p>
          The cards seniors read in &ldquo;Benefits &amp; services&rdquo;. Mostly national
          law, plus any benefit the Ubay OSCA office offers.
        </p>
      </div>
      <div className="ben-heading-controls">
        <div className="ben-search">
          <FiSearch aria-hidden="true" />
          <label htmlFor="ben-search" className="ben-sr-only">Search benefits</label>
          <input id="ben-search" type="search" placeholder="Search benefits…"
            value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <button type="button" className="ben-button ben-button--primary" onClick={() => setDialog("create")}>
          <FiPlus aria-hidden="true" /> Add benefit
        </button>
      </div>
    </div>

    {loadError && <div className="ben-message ben-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{loadError}</span>
    </div>}

    <div className="ben-toolbar">
      <span className="ben-count">
        {activeCount} shown in the app
        {benefits && benefits.length !== activeCount ? ` · ${benefits.length - activeCount} hidden` : ""}
      </span>
      <div className="ben-filters">
        <label htmlFor="ben-filter-category">Category</label>
        <select id="ben-filter-category" value={category}
          onChange={(event) => setCategory(event.target.value)}>
          <option value="All">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </div>

    {benefits === null ? <p className="ben-note">Loading benefits…</p>
    : shown.length === 0 ? <div className="ben-empty">
      <h2>No benefits to show</h2>
      <p>{benefits.length === 0
        ? "Add the first benefit and it appears in the app right away."
        : "Try another search or category."}</p>
    </div>
    : <div className="ben-grid">
      {shown.map((benefit) => (
        <article className={`ben-card${benefit.status === "Hidden" ? " ben-card--hidden" : ""}`} key={benefit.id}>
          <div className="ben-card-head">
            <span className={`ben-tag ben-tag--${benefit.category}`}>{CATEGORY_LABEL[benefit.category] || benefit.category}</span>
            {benefit.status === "Hidden" && <span className="ben-tag ben-tag--hidden">Hidden</span>}
          </div>
          <h2>{benefit.title}</h2>
          <p className="ben-card-summary">{benefit.summary}</p>
          {benefit.details && <p className="ben-card-details">{benefit.details}</p>}
          {benefit.how_to_get?.length > 0 && <>
            <h3>How to get it</h3>
            <ol className="ben-card-steps">
              {benefit.how_to_get.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          </>}
          <footer className="ben-card-actions">
            <button type="button" className="ben-button ben-button--ghost ben-button--small"
              onClick={() => toggleStatus(benefit)}>
              {benefit.status === "Active"
                ? <><FiEyeOff aria-hidden="true" /> Hide</>
                : <><FiEye aria-hidden="true" /> Show</>}
            </button>
            <button type="button" className="ben-button ben-button--ghost ben-button--small"
              onClick={() => setDialog(benefit)}>
              <FiEdit2 aria-hidden="true" /> Edit
            </button>
            <button type="button" className="ben-button ben-button--ghost-danger ben-button--small"
              onClick={() => setConfirmDelete(benefit)}>
              <FiTrash2 aria-hidden="true" /> Delete
            </button>
          </footer>
        </article>
      ))}
    </div>}

    {dialog && <BenefitDialog
      benefit={dialog === "create" ? null : dialog}
      onClose={() => setDialog(null)}
      onSave={save} />}

    {confirmDelete && <ModalDialog
      prefix="ben"
      title="Delete this benefit?"
      subtitle={`“${confirmDelete.title}” disappears from the app for every senior.`}
      onClose={() => setConfirmDelete(null)}
    >
      <div className="ben-dialog-body">
        <p className="ben-note">
          Hiding it instead keeps the wording here, in case you want it back later.
        </p>
      </div>
      <footer className="ben-dialog-footer">
        <button type="button" className="ben-button ben-button--secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
        <button type="button" className="ben-button ben-button--primary" onClick={remove}>
          <FiTrash2 aria-hidden="true" /> Delete it
        </button>
      </footer>
    </ModalDialog>}
  </div>;
}
