import { useEffect, useRef } from "react";
import { FiX } from "react-icons/fi";

/**
 * Modal built on the native <dialog> element, which handles focus trapping
 * and the Escape key. Used by the Senior IDs, Funds, Help Desk and Activity
 * Log pages.
 *
 * Styling comes from the page: with prefix="fm" the classes are fm-dialog,
 * fm-dialog--wide, fm-dialog-frame, fm-dialog-header and fm-icon-button.
 *
 * On open, focus goes to the first element marked data-initial-focus, or to
 * the title. Focus returns to whatever was focused before when it closes.
 */
export default function ModalDialog({ prefix, title, subtitle, wide = false, onClose, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    (dialog.querySelector("[data-initial-focus]") || dialog.querySelector("h2"))?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const titleId = `${prefix}-dialog-title`;

  return <dialog ref={dialogRef} className={`${prefix}-dialog${wide ? ` ${prefix}-dialog--wide` : ""}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className={`${prefix}-dialog-frame`}>
      <header className={`${prefix}-dialog-header`}>
        <div><h2 id={titleId} tabIndex={-1}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className={`${prefix}-icon-button`} aria-label="Close dialog" onClick={onClose}><FiX aria-hidden="true" /></button>
      </header>
      {children}
    </div>
  </dialog>;
}
