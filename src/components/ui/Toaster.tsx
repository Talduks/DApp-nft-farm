import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ExternalLink, Info, Loader2, X, XCircle } from 'lucide-react';
import { txUrl } from '../../config';

type ToastType = 'loading' | 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  txHash?: string;
}

interface ToastApi {
  show: (toast: Omit<Toast, 'id'>) => number;
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS: Record<ToastType, number | null> = {
  loading: null,
  success: 5000,
  info: 6000,
  error: 9000,
};

const ICONS: Record<ToastType, ReactNode> = {
  loading: <Loader2 className="h-5 w-5 animate-spin text-purple-400" />,
  success: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
  error: <XCircle className="h-5 w-5 text-red-400" />,
  info: <Info className="h-5 w-5 text-blue-400" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const schedule = useCallback(
    (id: number, type: ToastType) => {
      clearTimeout(timers.current.get(id));
      const delay = AUTO_DISMISS_MS[type];
      if (delay) timers.current.set(id, setTimeout(() => dismiss(id), delay));
    },
    [dismiss],
  );

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-4), { ...toast, id }]);
      schedule(id, toast.type);
      return id;
    },
    [schedule],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, 'id'>>) => {
      setToasts((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.type) schedule(id, patch.type);
    },
    [schedule],
  );

  const api = useMemo(() => ({ show, update, dismiss }), [show, update, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl shadow-black/40 backdrop-blur"
              role={toast.type === 'error' ? 'alert' : 'status'}
            >
              <div className="mt-0.5 shrink-0">{ICONS[toast.type]}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-sm break-words text-slate-400">{toast.message}</p>}
                {toast.txHash && txUrl(toast.txHash) && (
                  <a
                    href={txUrl(toast.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-purple-300 hover:text-purple-200"
                  >
                    Ver no explorer <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-white"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
