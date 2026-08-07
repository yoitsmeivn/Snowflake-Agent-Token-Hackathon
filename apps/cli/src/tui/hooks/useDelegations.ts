import { useEffect, useState } from "react";
import { openStore, recentDelegations, type DelegationRow } from "../../core/store.js";

const POLL_MS = 700;

/**
 * The only place that talks to the store. Everything below receives plain data
 * as props, which is what keeps the components renderable from a fixture.
 */
export function useDelegations(): { rows: DelegationRow[]; tick: number; error: string | null } {
  const [rows, setRows] = useState<DelegationRow[]>([]);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = openStore();
    const poll = () => {
      try {
        setRows(recentDelegations(db, 40));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
      setTick((t) => t + 1);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(timer);
      db.close();
    };
  }, []);

  return { rows, tick, error };
}
