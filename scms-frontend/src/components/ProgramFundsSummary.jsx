import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TbCurrencyPeso } from "react-icons/tb";
import { getProgramFundSummary } from "../services/api";
import { peso } from "../utils/money";
import "./ProgramFundsSummary.css";

/**
 * The program's money from Fund Management, shown on the Pension, Medical
 * and Burial pages. Pass a new `refreshKey` after a payout to reload it.
 */
export default function ProgramFundsSummary({ program, refreshKey = 0 }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ summary: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    getProgramFundSummary(program)
      .then((summary) => { if (!cancelled) setState({ summary, error: "" }); })
      .catch((error) => { if (!cancelled) setState({ summary: null, error: error.message || "Could not load fund balances." }); });
    return () => { cancelled = true; };
  }, [program, refreshKey]);

  const totals = state.summary?.totals;
  const fundCount = state.summary?.funds.length ?? 0;

  return <section className="pfs" aria-label={`${program} funds`}>
    <div className="pfs-head">
      <span className="pfs-icon"><TbCurrencyPeso strokeWidth={1.8} aria-hidden="true" /></span>
      <div>
        <h2>{program} funds</h2>
        <p>{state.error || (!totals ? "Loading balances…"
          : fundCount === 0 ? `No active fund has money allocated to ${program} yet.`
          : `From ${fundCount} active ${fundCount === 1 ? "fund" : "funds"} in Fund Management.`)}</p>
      </div>
      <button type="button" className="pfs-link" onClick={() => navigate("/funds")}>Open Fund Management</button>
    </div>
    {totals && <dl className="pfs-figures">
      <div className="pfs-figure pfs-figure--main"><dt>Available to pay out</dt><dd>{peso(totals.onHand)}</dd></div>
      <div className="pfs-figure"><dt>Allocated</dt><dd>{peso(totals.allocated)}</dd></div>
      <div className="pfs-figure"><dt>Released</dt><dd>{peso(totals.released)}</dd></div>
      <div className="pfs-figure"><dt>Paid out</dt><dd>{peso(totals.disbursed)}</dd></div>
      <div className="pfs-figure"><dt>Remaining balance</dt><dd>{peso(totals.remaining)}</dd></div>
    </dl>}
  </section>;
}
