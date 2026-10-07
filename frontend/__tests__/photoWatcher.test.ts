import { scanForNewPhotos } from '../services/photoWatcher';

const mockKv: Record<string, string> = {};
let mockAssets: any[] = [];

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockKv[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockKv[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete mockKv[k];
    }),
  },
}));

jest.mock('expo-media-library/legacy', () => ({}));

jest.mock('expo-media-library', () => {
  const query: any = {};
  for (const m of ['eq', 'gt', 'orderBy', 'limit']) query[m] = jest.fn(() => query);
  query.exe = jest.fn(async () => mockAssets);
  return {
    AssetField: { MEDIA_TYPE: 'mediaType', CREATION_TIME: 'creationTime' },
    MediaType: { IMAGE: 'image' },
    Query: jest.fn(() => query),
  };
});

const asset = (id: string, createdAt: number) => ({
  id,
  getCreationTime: async () => createdAt,
  getUri: async () => `file:///${id}.jpg`,
});

beforeEach(() => {
  for (const k of Object.keys(mockKv)) delete mockKv[k];
  mockKv['autoImport.lastSeenMs'] = '1000';
  mockAssets = [];
});

describe('scanForNewPhotos', () => {
  it('returns every new image, not just screenshots (bank apps save slips as ordinary photos)', async () => {
    mockAssets = [asset('slip', 2000), asset('screenshot', 3000)];
    const res = await scanForNewPhotos();
    expect(res.photos.map((p) => p.id)).toEqual(['slip', 'screenshot']);
    expect(res.photos[0].uri).toBe('file:///slip.jpg');
    expect(res.scannedUpTo).toBe(3000);
    expect(res.hasMore).toBe(false);
  });

  it('reports nothing when there are no new photos', async () => {
    const res = await scanForNewPhotos();
    expect(res).toEqual({ photos: [], scannedUpTo: null, hasMore: false });
  });

  it('flags a full batch so the caller keeps scanning', async () => {
    mockAssets = Array.from({ length: 20 }, (_, i) => asset(`p${i}`, 2000 + i));
    expect((await scanForNewPhotos()).hasMore).toBe(true);
  });
});
