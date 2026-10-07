/**
 * The API service talks to the FastAPI backend with fetch. These tests mock fetch and check that the app calls the
 * right routes with the right payloads, and turns failures into readable errors.
 */
import { File } from 'expo-file-system';
import * as api from '../services/api';
import { ApiError, API_URL } from '../services/api';

type MockInit = RequestInit & { headers?: Record<string, string> };

const fetchMock = jest.fn();
const realFetch = globalThis.fetch;

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function lastCall(): { url: string; init: MockInit } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, init: init ?? {} };
}

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

afterAll(() => {
  (globalThis as any).fetch = realFetch;
});

describe('reading data', () => {
  it('GET /api/transactions with a limit', async () => {
    respond([{ id: 1 }]);
    await expect(api.getTransactions(30)).resolves.toEqual([{ id: 1 }]);
    expect(lastCall().url).toBe(`${API_URL}/api/transactions?limit=30`);
  });

  it('GET /api/summary, optionally for a month', async () => {
    respond({ total_spent: 0 });
    await api.getSummary();
    expect(lastCall().url).toBe(`${API_URL}/api/summary`);
    respond({ total_spent: 0 });
    await api.getSummary('2026-03');
    expect(lastCall().url).toBe(`${API_URL}/api/summary?month=2026-03`);
  });

  it('GET pending, budgets and settings', async () => {
    respond([]);
    await api.getPending();
    expect(lastCall().url).toBe(`${API_URL}/api/transactions/pending`);
    respond([]);
    await api.getBudgets();
    expect(lastCall().url).toBe(`${API_URL}/api/budgets`);
    respond({ currency: 'THB' });
    await expect(api.getSettings()).resolves.toEqual({ currency: 'THB' });
    expect(lastCall().url).toBe(`${API_URL}/api/settings`);
  });

  it('smart search encodes the query and the category filter', async () => {
    respond({ results: [], interpretation: [] });
    await api.searchTransactions('food over 200 last month', 'Food', 25);
    const { url } = lastCall();
    expect(url.startsWith(`${API_URL}/api/transactions/search?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('q')).toBe('food over 200 last month');
    expect(params.get('category')).toBe('Food');
    expect(params.get('limit')).toBe('25');
  });

  it('smart search without a category leaves the param out', async () => {
    respond({ results: [], interpretation: [] });
    await api.searchTransactions('uber');
    expect(new URL(lastCall().url).searchParams.has('category')).toBe(false);
  });

  it('GET advice can skip the AI or force a refresh', async () => {
    respond({});
    await api.getAdvice({ ai: false });
    expect(lastCall().url).toBe(`${API_URL}/api/assistant/advice?ai=false`);
    respond({});
    await api.getAdvice({ refresh: true });
    expect(lastCall().url).toBe(`${API_URL}/api/assistant/advice?refresh=true`);
    respond({});
    await api.getAdvice();
    expect(lastCall().url).toBe(`${API_URL}/api/assistant/advice`);
  });
});

describe('writing data', () => {
  it('POST /api/transactions sends the draft as JSON', async () => {
    respond({ id: 5, impact: { message: 'ok' } }, 201);
    const draft = { amount: 42.5, merchant_name: 'Cafe', category: 'Food' as const, transaction_date: '2026-10-06' };
    await expect(api.createTransaction(draft)).resolves.toMatchObject({ id: 5 });
    const { url, init } = lastCall();
    expect(url).toBe(`${API_URL}/api/transactions`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(draft);
  });

  it('confirming a pending slip posts only the edits', async () => {
    respond({ id: 3, status: 'confirmed' });
    await api.confirmTransaction(3, { amount: 120, category: 'Groceries' });
    const { url, init } = lastCall();
    expect(url).toBe(`${API_URL}/api/transactions/3/confirm`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ amount: 120, category: 'Groceries' });
  });

  it('confirming with no edits sends an empty object', async () => {
    respond({ id: 3 });
    await api.confirmTransaction(3);
    expect(JSON.parse(lastCall().init.body as string)).toEqual({});
  });

  it('discarding handles the 204 No Content reply', async () => {
    respond(null, 204);
    await expect(api.discardTransaction(9)).resolves.toBeUndefined();
    const { url, init } = lastCall();
    expect(url).toBe(`${API_URL}/api/transactions/9`);
    expect(init.method).toBe('DELETE');
  });

  it('sets and deletes budgets, and updates the currency', async () => {
    respond({ category: 'Food' });
    await api.setBudget('Food', 3000);
    expect(lastCall().url).toBe(`${API_URL}/api/budgets/Food`);
    expect(lastCall().init.method).toBe('PUT');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ monthly_limit: 3000 });

    respond(null, 204);
    await api.deleteBudget('Food');
    expect(lastCall().init.method).toBe('DELETE');

    respond({ currency: 'EUR' });
    await api.updateSettings({ currency: 'EUR' });
    expect(lastCall().url).toBe(`${API_URL}/api/settings`);
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ currency: 'EUR' });
  });

  it('asks the assistant with only the last ten messages of history', async () => {
    respond({ reply: 'You spent ฿520.' });
    const history = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    await expect(api.askAssistant('How much on food?', history)).resolves.toBe('You spent ฿520.');
    const body = JSON.parse(lastCall().init.body as string);
    expect(lastCall().url).toBe(`${API_URL}/api/assistant/chat`);
    expect(body.message).toBe('How much on food?');
    expect(body.history).toHaveLength(10);
    expect(body.history[0].content).toBe('m4');
  });
});

describe('months, editing and deleting saved slips', () => {
  it('asks for one month of data everywhere it matters', async () => {
    respond([]);
    await api.getTransactions(200, '2026-08');
    expect(lastCall().url).toBe(`${API_URL}/api/transactions?limit=200&month=2026-08`);
    respond({});
    await api.getSummary('2026-08');
    expect(lastCall().url).toBe(`${API_URL}/api/summary?month=2026-08`);
    respond([]);
    await api.getBudgets('2026-08');
    expect(lastCall().url).toBe(`${API_URL}/api/budgets?month=2026-08`);
    respond({});
    await api.getAdvice({ ai: false, month: '2026-08' });
    expect(new URL(lastCall().url).searchParams.get('month')).toBe('2026-08');
    expect(new URL(lastCall().url).searchParams.get('ai')).toBe('false');
    respond({ results: [], interpretation: [] });
    await api.searchTransactions('cafe', null, 50, '2026-08');
    expect(new URL(lastCall().url).searchParams.get('month')).toBe('2026-08');
  });

  it('PATCHes only the edited fields of a saved slip', async () => {
    respond({ id: 4, impact: null });
    await api.updateTransaction(4, { amount: 99, category: 'Groceries' });
    const { url, init } = lastCall();
    expect(url).toBe(`${API_URL}/api/transactions/4`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ amount: 99, category: 'Groceries' });
  });

  it('deletes a saved slip', async () => {
    respond(null, 204);
    await expect(api.deleteTransaction(4)).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe('DELETE');
    expect(lastCall().url).toBe(`${API_URL}/api/transactions/4`);
  });

  it('reports validation errors from an edit', async () => {
    respond({ detail: [{ msg: 'Value error, category must be one of [...]' }] }, 422);
    await expect(api.updateTransaction(4, { category: 'Food' })).rejects.toThrow('category must be one of');
  });
});

describe('importing slip text read on the phone', () => {
  it('POSTs only the recognised text lines as JSON', async () => {
    respond({ id: 7, status: 'pending' });
    await api.importSlipText(['Amount', '35.00 THB']);
    const { url, init } = lastCall();
    expect(url).toBe(`${API_URL}/api/transactions/import-text`);
    expect(init.method).toBe('POST');
    expect(init.headers!['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ lines: ['Amount', '35.00 THB'] });
  });

  it('flags "not a receipt" so the caller can skip it quietly', async () => {
    respond({ detail: 'not_a_receipt' }, 422);
    const error = await api.importSlipText(['hello']).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNotAReceipt).toBe(true);
  });
});

describe('importing a slip (images never touch disk on the phone)', () => {
  const decode = (bytes: Uint8Array) => Array.from(bytes).map((b) => String.fromCharCode(b)).join('');

  it('reads a screenshot file and posts a hand-built multipart body', async () => {
    respond({ id: 1, status: 'pending' });
    await api.importReceipt('file:///Photos/IMG_0001.PNG');

    const { url, init } = lastCall();
    expect(url).toBe(`${API_URL}/api/transactions/import`);
    expect(init.method).toBe('POST');
    const contentType = init.headers!['Content-Type'];
    const boundary = contentType.split('boundary=')[1];
    expect(contentType.startsWith('multipart/form-data; boundary=')).toBe(true);

    const text = decode(init.body as unknown as Uint8Array);
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="receipt"\r\nContent-Type: image/png\r\n\r\n`);
    expect(text).toContain('\x01\x02\x03\x04'); // the file's bytes (from the mocked File.bytes) are inside
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
  });

  it.each([
    ['file:///a/b.jpg', 'image/jpeg'],
    ['file:///a/b.JPEG', 'image/jpeg'],
    ['file:///a/b.heic', 'image/heic'],
    ['file:///a/b.webp', 'image/webp'],
    ['file:///a/unknown', 'image/png'],
  ])('picks the mime type of %s from its extension', async (uri, mime) => {
    respond({ id: 1 });
    await api.importReceipt(uri);
    expect(decode(lastCall().init.body as unknown as Uint8Array)).toContain(`Content-Type: ${mime}`);
  });

  it('decodes a pasted data: URI (clipboard) without writing a file', async () => {
    respond({ id: 1 });
    await api.importReceipt('data:image/jpeg;base64,AQIDBA=='); // bytes 1,2,3,4
    const text = decode(lastCall().init.body as unknown as Uint8Array);
    expect(text).toContain('Content-Type: image/jpeg');
    expect(text).toContain('\x01\x02\x03\x04');
  });

  it('reports an unreadable screenshot clearly', async () => {
    jest.spyOn(File.prototype, 'bytes').mockRejectedValueOnce(new Error('sandbox'));
    await expect(api.importReceipt('file:///x.png')).rejects.toThrow('Could not read the screenshot from Photos.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags "not a receipt" so ordinary screenshots can be skipped quietly', async () => {
    respond({ detail: 'not_a_receipt' }, 422);
    const error = await api.importReceipt('file:///x.png').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNotAReceipt).toBe(true);
  });
});

describe('errors', () => {
  it('uses the backend detail message', async () => {
    respond({ detail: 'Unsupported image type' }, 415);
    const error = await api.getPending().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Unsupported image type');
    expect(error.status).toBe(415);
    expect(error.isNotAReceipt).toBe(false);
  });

  it('joins FastAPI validation errors', async () => {
    respond({ detail: [{ msg: 'amount must be positive' }, { msg: 'bad date' }] }, 422);
    await expect(api.getPending()).rejects.toThrow('amount must be positive, bad date');
  });

  it('falls back to the status code for non-JSON error bodies', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('html'); } });
    await expect(api.getPending()).rejects.toThrow('Request failed (500)');
  });

  it('explains when the backend is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(api.getPending()).rejects.toThrow(`Cannot reach the server at ${API_URL}. Is the backend running?`);
  });

  it('times out slow requests', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      );
      const pending = api.getPending().catch((e) => e);
      await jest.advanceTimersByTimeAsync(45_000);
      expect((await pending).message).toBe('The server took too long to respond.');
    } finally {
      jest.useRealTimers();
    }
  });
});
