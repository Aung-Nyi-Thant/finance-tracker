import { AssetField, MediaSubtype, MediaType, Query } from 'expo-media-library';
import * as Permissions from 'expo-media-library/legacy';
import Storage from 'expo-sqlite/kv-store';

const LAST_SEEN_KEY = 'autoImport.lastSeenMs';
const DISABLED_KEY = 'autoImport.disabled';

export type PhotoAccess = 'all' | 'limited' | 'none' | 'undetermined';

export interface ScreenshotRef {
  id: string;
  uri: string;
  createdAt: number; // ms
}

function toAccess(res: Permissions.PermissionResponse): PhotoAccess {
  if (res.status === 'undetermined') return 'undetermined';
  if (!res.granted) return 'none';
  return res.accessPrivileges === 'limited' ? 'limited' : 'all';
}

export async function getPhotoAccess(): Promise<PhotoAccess> {
  return toAccess(await Permissions.getPermissionsAsync(false, ['photo']));
}

export async function requestPhotoAccess(): Promise<PhotoAccess> {
  return toAccess(await Permissions.requestPermissionsAsync(false, ['photo']));
}

export async function isDisabledByUser(): Promise<boolean> {
  return (await Storage.getItem(DISABLED_KEY)) === '1';
}

export async function setDisabledByUser(disabled: boolean): Promise<void> {
  if (disabled) await Storage.setItem(DISABLED_KEY, '1');
  else await Storage.removeItem(DISABLED_KEY);
}

async function getLastSeen(): Promise<number> {
  const raw = await Storage.getItem(LAST_SEEN_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  // First run: only look at screenshots taken from now on — never sweep the user's history.
  const now = Date.now();
  await Storage.setItem(LAST_SEEN_KEY, String(now));
  return now;
}

export async function markSeen(createdAt: number): Promise<void> {
  const current = await getLastSeen();
  if (createdAt > current) await Storage.setItem(LAST_SEEN_KEY, String(createdAt));
}

const BATCH = 20;

export interface ScanResult {
  screenshots: ScreenshotRef[];
  /** Creation time of the newest photo examined; pass to markSeen() once the batch is handled. */
  scannedUpTo: number | null;
  hasMore: boolean;
}

/** Screenshots added to Photos since the last check, oldest first. */
export async function scanForScreenshots(): Promise<ScanResult> {
  const since = await getLastSeen();
  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .gt(AssetField.CREATION_TIME, since)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .limit(BATCH)
    .exe();

  const screenshots: ScreenshotRef[] = [];
  let scannedUpTo: number | null = null;
  for (const asset of assets) {
    const createdAt = (await asset.getCreationTime()) ?? Date.now();
    scannedUpTo = Math.max(scannedUpTo ?? 0, createdAt);
    const subtypes = await asset.getMediaSubtypes();
    if (!subtypes.includes(MediaSubtype.SCREENSHOT)) continue;
    screenshots.push({ id: asset.id, uri: await asset.getUri(), createdAt });
  }
  return { screenshots, scannedUpTo, hasMore: assets.length === BATCH };
}
