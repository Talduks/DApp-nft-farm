import { useCallback } from 'react';
import { useToast } from '../components/ui/Toaster';
import type { TxCallbacks } from '../web3/contracts';
import { parseError } from '../web3/errors';

/**
 * Runs a wallet action with toast feedback (confirm → sent → confirmed / error).
 * Resolves to the action's result, or `null` when it failed or was cancelled.
 */
export function useTx() {
  const toast = useToast();

  return useCallback(
    async <T>(title: string, action: (callbacks: TxCallbacks) => Promise<T>, successMessage?: string): Promise<T | null> => {
      const id = toast.show({ type: 'loading', title, message: 'Confirme na sua carteira…' });
      try {
        const result = await action({
          onSent: (hash) => toast.update(id, { message: 'Transação enviada. Aguardando confirmação…', txHash: hash }),
          onStep: (message) => toast.update(id, { message }),
        });
        toast.update(id, { type: 'success', message: successMessage ?? 'Concluído!' });
        return result;
      } catch (error) {
        console.error(error);
        toast.update(id, { type: 'error', message: parseError(error) });
        return null;
      }
    },
    [toast],
  );
}
