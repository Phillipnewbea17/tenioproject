import { useEffect, useState } from "react";
import { getAvailableFunds } from "../services/api";

/**
 * Active funds that have released money for a program and not yet paid it
 * out. Loads only while `enabled` (e.g. once the status is set to paid).
 * Returns { funds: [...] | null while loading, error }.
 */
export default function useAvailableFunds(program, enabled) {
  const [state, setState] = useState({ funds: null, error: "" });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getAvailableFunds(program)
      .then((funds) => { if (!cancelled) setState({ funds, error: "" }); })
      .catch((error) => { if (!cancelled) setState({ funds: [], error: error.message || "Could not load funds." }); });
    return () => { cancelled = true; };
  }, [program, enabled]);

  return state;
}
