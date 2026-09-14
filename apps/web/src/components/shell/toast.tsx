'use client';

import {
  ActionableNotification,
  ToastNotification,
} from '@bap/design-system/react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import styles from './toast.module.scss';

type ToastKind = 'error' | 'info' | 'success' | 'warning';

export type ToastInput = Readonly<{
  actionLabel?: string;
  kind?: ToastKind;
  onAction?: () => void;
  subtitle?: string;
  timeout?: number;
  title: string;
}>;

type Toast = ToastInput & Readonly<{ id: number }>;

type ToastContextValue = Readonly<{ notify: (toast: ToastInput) => void }>;

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return value;
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((input: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { ...input, id }]);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-label="Notifications" className={styles.host!} role="region">
        {toasts.map((toast) =>
          toast.actionLabel ? (
            <ActionableNotification
              actionButtonLabel={toast.actionLabel}
              key={toast.id}
              kind={toast.kind ?? 'info'}
              lowContrast
              onActionButtonClick={toast.onAction}
              onClose={() => {
                dismiss(toast.id);
                return true;
              }}
              subtitle={toast.subtitle ?? ''}
              title={toast.title}
            />
          ) : (
            <ToastNotification
              key={toast.id}
              kind={toast.kind ?? 'info'}
              lowContrast
              onClose={() => {
                dismiss(toast.id);
                return true;
              }}
              subtitle={toast.subtitle ?? ''}
              timeout={toast.timeout ?? 6000}
              title={toast.title}
            />
          ),
        )}
      </div>
    </ToastContext.Provider>
  );
}
