import { File } from 'expo-file-system';
import type {
  Advice,
  Budget,
  BudgetKey,
  ChatMessage,
  PendingEdits,
  SavedTransaction,
  SearchResult,
  Settings,
  Summary,
  Transaction,
  TransactionDraft,
} from '../types';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? '';

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }

  /** The image is fine but isn't a receipt / payment slip (expected for ordinary screenshots). */
  get isNotAReceipt(): boolean {
    return this.status === 422 && this.message === 'not_a_receipt';
  }
}

// 45 s so the first request after a free Render server has gone to sleep (30-60 s to wake) still succeeds.
async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(API_TOKEN ? { 'X-API-Token': API_TOKEN } : {}) };
    const res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (typeof body?.detail === 'string') detail = body.detail;
        else if (Array.isArray(body?.detail)) detail = body.detail.map((d: any) => d.msg).join(', ');
      } catch {
        // non-JSON error body
      }
      throw new ApiError(detail, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new ApiError('The server took too long to respond.');
    }
    throw new ApiError(`Cannot reach the server at ${API_URL}. Is the backend running?`);
  } finally {
    clearTimeout(timer);
  }
}

export function getTransactions(limit = 50, month?: string): Promise<Transaction[]> {
  return request<Transaction[]>(`/api/transactions?limit=${limit}${month ? `&month=${month}` : ''}`);
}

/** Smart search, e.g. "food over 200 last month". `category` is an extra explicit filter (a tapped chip). */
export function searchTransactions(q: string, category?: string | null, limit = 50, month?: string | null): Promise<SearchResult> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (category) params.set('category', category);
  if (month) params.set('month', month);
  return request<SearchResult>(`/api/transactions/search?${params.toString()}`);
}

export function getSummary(month?: string): Promise<Summary> {
  return request<Summary>(`/api/summary${month ? `?month=${month}` : ''}`);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heic',
  webp: 'image/webp',
};

/** Decode a base64 string (optionally a data: URI) into bytes without touching the file system. */
function base64ToBytes(input: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,/.exec(input);
  const b64 = match ? input.slice(match[0].length) : input;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime: match?.[1] ?? 'image/png' };
}

/**
 * Expo's fetch rejects React Native's `{ uri, name, type }` FormData parts, so the multipart body is
 * built by hand from in-memory bytes. Nothing is written to disk on the device.
 */
async function postImage<T>(path: string, bytes: Uint8Array, mime: string): Promise<T> {
  const boundary = `----FinanceTracker${Math.random().toString(36).slice(2)}${Date.now()}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: body as unknown as BodyInit,
    },
    90000,
  );
}

/**
 * Send an image for zero-touch import: a file:// URI (screenshot from Photos) or a base64 / data: URI
 * (clipboard). The backend reads it with Gemini in memory and stores only the extracted fields.
 */
export async function importReceipt(source: string): Promise<Transaction> {
  let bytes: Uint8Array;
  let mime: string;
  if (source.startsWith('file://')) {
    try {
      bytes = await new File(source).bytes();
    } catch {
      throw new ApiError('Could not read the screenshot from Photos.');
    }
    mime = MIME_BY_EXTENSION[source.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
  } else {
    ({ bytes, mime } = base64ToBytes(source));
  }
  return postImage<Transaction>('/api/transactions/import', bytes, mime);
}

/**
 * Import a payment slip from text recognised on the phone. No image is uploaded and no AI is involved: the
 * backend reads the fields with rules, so it is free, instant and works even when Gemini is down.
 */
export function importSlipText(lines: string[]): Promise<Transaction> {
  return request<Transaction>('/api/transactions/import-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
}

export function getPending(): Promise<Transaction[]> {
  return request<Transaction[]>('/api/transactions/pending');
}

export function confirmTransaction(id: number, edits: PendingEdits = {}): Promise<SavedTransaction> {
  return request<SavedTransaction>(`/api/transactions/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edits),
  });
}

export function discardTransaction(id: number): Promise<void> {
  return request<void>(`/api/transactions/${id}`, { method: 'DELETE' });
}

/** Delete a saved slip (same route as discarding a pending one). */
export const deleteTransaction = discardTransaction;

/** Correct a saved slip; only the fields sent change. */
export function updateTransaction(id: number, edits: PendingEdits): Promise<SavedTransaction> {
  return request<SavedTransaction>(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edits),
  });
}

export function createTransaction(draft: TransactionDraft): Promise<SavedTransaction> {
  return request<SavedTransaction>('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
}

// ---------- budgets & assistant ----------

export function getBudgets(month?: string): Promise<Budget[]> {
  return request<Budget[]>(`/api/budgets${month ? `?month=${month}` : ''}`);
}

export function setBudget(category: BudgetKey, monthlyLimit: number): Promise<Budget> {
  return request<Budget>(`/api/budgets/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthly_limit: monthlyLimit }),
  });
}

export function deleteBudget(category: BudgetKey): Promise<void> {
  return request<void>(`/api/budgets/${category}`, { method: 'DELETE' });
}

/** ai=false never calls Gemini (cached AI advice or rule-based tips) so it is cheap enough for the dashboard. */
export function getAdvice(opts: { ai?: boolean; refresh?: boolean; month?: string } = {}): Promise<Advice> {
  const params = new URLSearchParams();
  if (opts.month) params.set('month', opts.month);
  if (opts.ai === false) params.set('ai', 'false');
  if (opts.refresh) params.set('refresh', 'true');
  const qs = params.toString();
  return request<Advice>(`/api/assistant/advice${qs ? `?${qs}` : ''}`, {}, 60000);
}

export async function askAssistant(message: string, history: ChatMessage[]): Promise<string> {
  const res = await request<{ reply: string }>(
    '/api/assistant/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-10) }),
    },
    60000,
  );
  return res.reply;
}

// ---------- settings ----------

export function getSettings(): Promise<Settings> {
  return request<Settings>('/api/settings');
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return request<Settings>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
