import * as Haptics from 'expo-haptics';
import { addListener } from 'expo-media-library';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { ApiError, importReceipt } from '../services/api';
import {
  getPhotoAccess,
  isDisabledByUser,
  markSeen,
  requestPhotoAccess,
  scanForScreenshots,
  setDisabledByUser,
  type PhotoAccess,
} from '../services/screenshotWatcher';
import { useTransactions } from './TransactionsContext';

interface ContextValue {
  /** Photo-library permission, as granted by the user. */
  access: PhotoAccess;
  /** True when permission is granted and the user hasn't switched auto-import off. */
  watching: boolean;
  /** Number of receipts currently being read by the backend. */
  importing: number;
  /** Last problem worth telling the user about (cleared on the next successful scan). */
  error: string | null;
  lastScanAt: number | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  scanNow: () => Promise<void>;
  /** Import an image from a data: URI (clipboard) or file URI. */
  importImage: (source: string) => Promise<boolean>;
}

const Ctx = createContext<ContextValue | null>(null);

export function AutoImportProvider({ children }: { children: ReactNode }) {
  const { refreshPending } = useTransactions();
  const [access, setAccess] = useState<PhotoAccess>('undetermined');
  const [disabled, setDisabled] = useState(false);
  const [importing, setImporting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  const scanning = useRef(false);
  const watching = (access === 'all' || access === 'limited') && !disabled;
  const watchingRef = useRef(watching);
  watchingRef.current = watching;

  const importImage = useCallback(
    async (source: string): Promise<boolean> => {
      setImporting((n) => n + 1);
      try {
        await importReceipt(source);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refreshPending();
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.isNotAReceipt) return false;
        setError((err as Error).message);
        return false;
      } finally {
        setImporting((n) => n - 1);
      }
    },
    [refreshPending],
  );

  const scanNow = useCallback(async () => {
    if (scanning.current || !watchingRef.current) return;
    scanning.current = true;
    try {
      for (let round = 0; round < 5; round++) {
        const { screenshots, scannedUpTo, hasMore } = await scanForScreenshots();
        let failedAt: number | null = null;
        for (const shot of screenshots) {
          setImporting((n) => n + 1);
          try {
            await importReceipt(shot.uri);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (err) {
            if (!(err instanceof ApiError && err.isNotAReceipt)) {
              // Backend unreachable / AI failure: keep this screenshot (and later ones) for the next scan.
              failedAt = shot.createdAt;
              setError((err as Error).message);
              break;
            }
          } finally {
            setImporting((n) => n - 1);
          }
        }
        if (screenshots.length) await refreshPending();
        if (scannedUpTo !== null) await markSeen(failedAt !== null ? failedAt - 1 : scannedUpTo);
        if (failedAt !== null || !hasMore) {
          if (failedAt === null) setError(null);
          break;
        }
      }
      setLastScanAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      scanning.current = false;
    }
  }, [refreshPending]);

  // Load permission + preference once.
  useEffect(() => {
    (async () => {
      setDisabled(await isDisabledByUser());
      setAccess(await getPhotoAccess());
    })().catch((e) => console.warn('[auto-import] init failed:', e?.message ?? e));
  }, []);

  // Scan when the app comes to the foreground (and once when watching starts).
  useEffect(() => {
    if (!watching) return;
    scanNow();
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      setAccess(await getPhotoAccess());
      scanNow();
    });
    return () => sub.remove();
  }, [watching, scanNow]);

  // React to the photo library changing while the app is open (screenshot taken, then app reopened quickly).
  useEffect(() => {
    if (!watching) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = addListener(() => {
      clearTimeout(timer);
      timer = setTimeout(scanNow, 1500); // the new asset takes a moment to be indexed
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [watching, scanNow]);

  const enable = useCallback(async () => {
    await setDisabledByUser(false);
    setDisabled(false);
    setAccess(await requestPhotoAccess());
  }, []);

  const disable = useCallback(async () => {
    await setDisabledByUser(true);
    setDisabled(true);
  }, []);

  const value = useMemo(
    () => ({ access, watching, importing, error, lastScanAt, enable, disable, scanNow, importImage }),
    [access, watching, importing, error, lastScanAt, enable, disable, scanNow, importImage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAutoImport(): ContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAutoImport must be used inside <AutoImportProvider>');
  return ctx;
}
