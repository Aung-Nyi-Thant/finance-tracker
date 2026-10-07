import { extractTextFromImage } from 'expo-text-extractor';
import { looksLikeSlip, readSlipLines } from '../services/slipOcr';

jest.mock('expo-text-extractor', () => ({ extractTextFromImage: jest.fn() }));
const extract = extractTextFromImage as jest.Mock;

// Real Apple Vision output for a Bangkok Bank PromptPay slip.
const SLIP = [
  'Bangkok Bank', 'Transaction successful', '07 Oct 26, 17:10', 'Amount', '35.00 THB', 'From', 'To',
  'MR. AUNG NYI NYI THANT', '672-0-xxx086', 'Bangkok Bank', 'WILAIWAN TREETHAWAT', '1-4106-0xxxx-41-5',
  'PromptPay', 'Fee', '0.00 THB', 'Bank reference no.', '370575', 'Transaction reference',
  '2026100717105324009619408', 'Scan to verify',
];

describe('looksLikeSlip', () => {
  it('accepts a bank slip', () => expect(looksLikeSlip(SLIP)).toBe(true));
  it('accepts a baht sign before the amount', () =>
    expect(looksLikeSlip(['฿1,250.00', '7 October 2026'])).toBe(true));

  it.each([
    ['empty', []],
    ['a beach photo', ['Sunset', 'IMG_1234']],
    ['a menu with prices but no currency or date', ['Pad Thai 120.00', 'Green curry 150.00']],
    ['an amount with no date', ['Amount', '35.00 THB']],
    ['a date with no amount', ['07 Oct 26, 17:10', 'Meeting notes']],
  ])('rejects %s', (_name, lines) => expect(looksLikeSlip(lines as string[])).toBe(false));
});

describe('readSlipLines', () => {
  beforeEach(() => extract.mockReset());

  it('returns the recognised text for a slip', async () => {
    extract.mockResolvedValue(SLIP);
    await expect(readSlipLines('file:///a.jpg')).resolves.toEqual(SLIP);
    expect(extract).toHaveBeenCalledWith('file:///a.jpg');
  });

  it('returns null for an ordinary photo so nothing is uploaded', async () => {
    extract.mockResolvedValue(['Sunset']);
    await expect(readSlipLines('file:///a.jpg')).resolves.toBeNull();
  });

  it('returns null, not an error, when the photo cannot be read', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    extract.mockRejectedValue(new Error('bad image'));
    await expect(readSlipLines('file:///a.jpg')).resolves.toBeNull();
  });
});
