import { useEffect, useRef } from 'react';

/**
 * Calls `fn` now and every `intervalMs` while the tab is visible, and again when the tab becomes
 * visible. Changing `resetKey` restarts the cycle with an immediate call.
 */
export function usePolling(fn: () => unknown, intervalMs: number, enabled = true, resetKey?: unknown) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === 'visible') fnRef.current();
    };
    run();
    const timer = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [intervalMs, enabled, resetKey]);
}
