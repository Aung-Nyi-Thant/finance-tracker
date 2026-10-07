/**
 * The scan loop: photos are read on the phone, only payment slips are sent (as text), and a backend failure
 * keeps the photo for the next scan.
 */
import { render, screen, act } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { ApiError } from '../services/api';
import { AutoImportProvider, useAutoImport } from '../store/AutoImportContext';

const mockScan = jest.fn();
const mockMarkSeen = jest.fn();
const mockRead = jest.fn();
const mockImportText = jest.fn();
const mockImportImage = jest.fn();
const mockRefresh = jest.fn();

jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('expo-media-library', () => ({ addListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('../store/TransactionsContext', () => ({ useTransactions: () => ({ refreshPending: mockRefresh }) }));
jest.mock('../services/photoWatcher', () => ({
  getPhotoAccess: jest.fn(async () => 'all'),
  requestPhotoAccess: jest.fn(async () => 'all'),
  isDisabledByUser: jest.fn(async () => false),
  setDisabledByUser: jest.fn(),
  markSeen: (...a: unknown[]) => mockMarkSeen(...a),
  scanForNewPhotos: () => mockScan(),
}));
jest.mock('../services/slipOcr', () => ({ readSlipLines: (uri: string) => mockRead(uri) }));
jest.mock('../services/api', () => {
  const actual = jest.requireActual('../services/api');
  return { ...actual, importSlipText: (l: string[]) => mockImportText(l), importReceipt: (s: string) => mockImportImage(s) };
});

const photo = (id: string, createdAt: number) => ({ id, uri: `file:///${id}.jpg`, createdAt });
const SLIP_LINES = ['Amount', '35.00 THB', '07 Oct 26, 17:10'];

let scanNow: () => Promise<void>;
function Probe() {
  const auto = useAutoImport();
  scanNow = auto.scanNow;
  return <Text>{auto.error ?? 'no error'}</Text>;
}

async function mountAndScan() {
  await render(<AutoImportProvider><Probe /></AutoImportProvider>);
  await act(async () => {}); // the initial on-open scan
  mockScan.mockClear();
  mockImportText.mockClear();
  mockRead.mockClear();
  mockMarkSeen.mockClear();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScan.mockResolvedValue({ photos: [], scannedUpTo: null, hasMore: false });
});

it('sends the text of a payment slip, never the image', async () => {
  await mountAndScan();
  mockScan.mockResolvedValueOnce({ photos: [photo('slip', 2000)], scannedUpTo: 2000, hasMore: false });
  mockRead.mockResolvedValue(SLIP_LINES);
  mockImportText.mockResolvedValue({ id: 1 });

  await act(async () => { await scanNow(); });

  expect(mockImportText).toHaveBeenCalledWith(SLIP_LINES);
  expect(mockImportImage).not.toHaveBeenCalled();
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockMarkSeen).toHaveBeenCalledWith(2000);
});

it('keeps ordinary photos on the phone: nothing is sent for them', async () => {
  await mountAndScan();
  mockScan.mockResolvedValueOnce({ photos: [photo('beach', 3000)], scannedUpTo: 3000, hasMore: false });
  mockRead.mockResolvedValue(null); // not a slip

  await act(async () => { await scanNow(); });

  expect(mockImportText).not.toHaveBeenCalled();
  expect(mockImportImage).not.toHaveBeenCalled();
  expect(mockMarkSeen).toHaveBeenCalledWith(3000); // handled, so it is not examined again
});

it('skips text the backend says is not a slip, without showing an error', async () => {
  await mountAndScan();
  mockScan.mockResolvedValueOnce({ photos: [photo('x', 4000)], scannedUpTo: 4000, hasMore: false });
  mockRead.mockResolvedValue(SLIP_LINES);
  mockImportText.mockRejectedValue(new ApiError('not_a_receipt', 422));

  await act(async () => { await scanNow(); });

  expect(screen.getByText('no error')).toBeOnTheScreen();
  expect(mockMarkSeen).toHaveBeenCalledWith(4000);
});

it('keeps the photo for the next scan when the backend is unreachable', async () => {
  await mountAndScan();
  mockScan.mockResolvedValueOnce({ photos: [photo('slip', 5000)], scannedUpTo: 5000, hasMore: false });
  mockRead.mockResolvedValue(SLIP_LINES);
  mockImportText.mockRejectedValue(new ApiError('Cannot reach the server'));

  await act(async () => { await scanNow(); });

  expect(screen.getByText('Cannot reach the server')).toBeOnTheScreen();
  expect(mockMarkSeen).toHaveBeenCalledWith(4999); // just before this photo, so it is retried
});
