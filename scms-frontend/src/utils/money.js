// Peso helpers shared by the program pages (Pension, Medical, Burial).

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

/** "₱1,500.50" */
export function peso(value) {
  return pesoFormat.format(Number(value) || 0);
}

/** "1,500.50" → "1500.50"; "" when not a peso amount above zero with up to 2 decimals. */
export function cleanAmount(value) {
  const text = String(value ?? "").replace(/[,\s₱]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0 ? text : "";
}

/**
 * Checks the amount and fund for a payout against the funds that can pay.
 * Returns { amount: error, fundId: error } for the fields that are wrong.
 */
export function validatePayout({ amount, fundId }, funds) {
  const errors = {};
  const cleaned = cleanAmount(amount);
  const fund = (funds || []).find((item) => String(item.id) === String(fundId));
  if (!cleaned) errors.amount = "Enter the amount paid, greater than ₱0 with up to 2 decimals.";
  if (!fund) errors.fundId = "Choose the fund this is paid from.";
  else if (cleaned && Number(cleaned) > fund.on_hand) errors.amount = `Only ${peso(fund.on_hand)} is available in ${fund.reference}.`;
  return errors;
}
