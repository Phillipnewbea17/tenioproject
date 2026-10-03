import { peso } from "../utils/money";

/**
 * Amount + "Paid from fund" fields for program forms (Pension, Medical,
 * Burial). Uses the page's own field classes via `prefix` (e.g. "med").
 *
 * When the record is already paid (`locked`), shows what was paid instead:
 * the money must stay matched to its disbursement in Fund Management.
 */
export default function FundPayoutFields({ prefix, program, amount, fundId, funds, errors = {}, onChange, locked, lockedFund }) {
  const id = (name) => `${prefix}-${name}`;

  if (locked) {
    return <div className={`${prefix}-field ${prefix}-field--wide`}>
      <span className={`${prefix}-locked`}>
        {peso(amount)} paid from {lockedFund}. To change it, void the disbursement in Fund Management.
      </span>
    </div>;
  }

  return <>
    <div className={`${prefix}-field`}>
      <label htmlFor={id("amount")}>Amount paid (₱)<span className={`${prefix}-required`} aria-hidden="true"> *</span></label>
      <input id={id("amount")} name="amount" inputMode="decimal" required placeholder="0.00" value={amount}
        aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? id("amount-error") : undefined}
        onChange={(event) => onChange("amount", event.target.value)} />
      {errors.amount && <span id={id("amount-error")} className={`${prefix}-field-error`}>{errors.amount}</span>}
    </div>
    <div className={`${prefix}-field`}>
      <label htmlFor={id("fundId")}>Paid from fund<span className={`${prefix}-required`} aria-hidden="true"> *</span></label>
      <select id={id("fundId")} name="fundId" required disabled={funds === null} value={fundId}
        aria-invalid={Boolean(errors.fundId)} aria-describedby={errors.fundId ? id("fundId-error") : undefined}
        onChange={(event) => onChange("fundId", event.target.value)}>
        <option value="" disabled>{funds === null ? "Loading funds…" : funds.length ? "Select a fund" : `No fund has released ${program} money`}</option>
        {(funds || []).map((fund) => <option key={fund.id} value={String(fund.id)}>{fund.reference} · {fund.name} ({peso(fund.on_hand)} available)</option>)}
      </select>
      <span className={`${prefix}-field-hint`}>Saving records a disbursement in Fund Management.</span>
      {errors.fundId && <span id={id("fundId-error")} className={`${prefix}-field-error`}>{errors.fundId}</span>}
    </div>
  </>;
}
