import Storage from 'expo-sqlite/kv-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from '../services/api';
import { DEFAULT_CURRENCY, makeFormatter, type MoneyFormatter } from '../utils/currency';

const CACHE_KEY = 'settings.currency';

interface ContextValue extends MoneyFormatter {
  /** Persist a new display currency on the backend (so advice text matches) and update the UI. */
  setCurrency: (code: string) => Promise<void>;
}

const Ctx = createContext<ContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Show the last known currency instantly, then confirm with the backend (the source of truth).
      const cached = await Storage.getItem(CACHE_KEY).catch(() => null);
      if (cached && !cancelled) setCurrencyState(cached);
      try {
        const { currency: remote } = await api.getSettings();
        if (!cancelled) setCurrencyState(remote);
        await Storage.setItem(CACHE_KEY, remote);
      } catch {
        // offline: keep the cached value
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback(
    async (code: string) => {
      const previous = currency;
      setCurrencyState(code);
      try {
        await api.updateSettings({ currency: code });
        await Storage.setItem(CACHE_KEY, code);
      } catch (err) {
        setCurrencyState(previous);
        throw err;
      }
    },
    [currency],
  );

  const value = useMemo(() => ({ ...makeFormatter(currency), setCurrency }), [currency, setCurrency]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Currency-aware formatting: `const { format } = useMoney(); format(12.5) // "$12.50"` */
export function useMoney(): ContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMoney must be used inside <SettingsProvider>');
  return ctx;
}
