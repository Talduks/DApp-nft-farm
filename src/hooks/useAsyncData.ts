import { useCallback, useEffect, useRef, useState } from 'react';
import { parseError } from '../web3/errors';
import { usePolling } from './usePolling';

/**
 * Loads data for a key (usually the wallet address), polling in the background. Responses for an
 * old key are dropped, so switching wallets never shows the previous wallet's data.
 */
export function useAsyncData<T>(key: string | null, load: (key: string) => Promise<T>, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const currentKey = useRef(key);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    currentKey.current = key;
    setData(null);
    setError(null);
  }, [key]);

  const refresh = useCallback(async () => {
    const requestKey = currentKey.current;
    if (!requestKey) return;
    setLoading(true);
    try {
      const result = await loadRef.current(requestKey);
      if (currentKey.current === requestKey) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      console.error(e);
      if (currentKey.current === requestKey) setError(parseError(e));
    } finally {
      if (currentKey.current === requestKey) setLoading(false);
    }
  }, []);

  usePolling(refresh, intervalMs, Boolean(key), key);

  return { data, error, loading, refresh };
}
