import { extractTextFromImage } from 'expo-text-extractor';

const MONEY_WITH_CURRENCY = /\d[\d,]*\.\d{2}\s*(THB|฿|baht)|(THB|฿)\s*\d[\d,]*\.\d{2}/i;
const DATE_LIKE = /\b\d{1,2}\s+[A-Za-z]{3}[a-z]*\.?\s+\d{2,4}\b/;

/**
 * Cheap on-device check that recognised text is a payment slip (an amount in baht plus a date).
 * It is what keeps ordinary photos on the phone: only text that passes this is ever sent anywhere.
 */
export function looksLikeSlip(lines: string[]): boolean {
  return lines.some((l) => MONEY_WITH_CURRENCY.test(l)) && lines.some((l) => DATE_LIKE.test(l));
}

/**
 * Read a photo with the iPhone's built-in text recognition. Returns the text lines when the photo looks like a
 * payment slip, otherwise null. The image itself never leaves the phone.
 */
export async function readSlipLines(uri: string): Promise<string[] | null> {
  let lines: string[];
  try {
    lines = await extractTextFromImage(uri);
  } catch (err) {
    console.warn('[auto-import] could not read text from photo:', (err as Error)?.message ?? err);
    return null;
  }
  return looksLikeSlip(lines) ? lines : null;
}
