import { useEffect, useState } from 'react';

/**
 * Wordt `true` één keer, kort ná mount, via `requestIdleCallback` (fallback `setTimeout`) met
 * een harde bovengrens (`timeoutMs`) — zodat het element nooit onbeperkt wacht. Anders dan
 * `runWhenIdleAndQuiet` reset dit niet op gebruikersinput: bedoeld voor zichtbare content die
 * met een klein prioriteitsverschil moet laden (bv. een secundair paneel dat niet gelijktijdig
 * met de hoofdgrafiek om dezelfde trage databron moet vragen), niet voor stil achtergrondwerk.
 *
 * @param {number} [timeoutMs]
 * @returns {boolean}
 */
export function useIdleReady(timeoutMs = 300) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mark = () => { if (!cancelled) setReady(true); };
    const ric = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback
      : null;
    const handle = ric ? ric(mark, { timeout: timeoutMs }) : setTimeout(mark, timeoutMs);
    return () => {
      cancelled = true;
      if (ric && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [timeoutMs]);

  return ready;
}
