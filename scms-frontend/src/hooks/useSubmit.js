import { useState } from "react";

/**
 * Save handling for dialog forms: `saving` disables the submit button while
 * onSave runs, and an error thrown by onSave (usually the API's message) is
 * shown as `saveError`. On success the dialog is expected to close, so
 * `saving` is not reset.
 */
export default function useSubmit(onSave) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function submit(value) {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(value);
    } catch (error) {
      setSaveError(error.message || "Could not save. Please try again.");
      setSaving(false);
    }
  }

  return { saving, saveError, submit, clearError: () => setSaveError("") };
}
