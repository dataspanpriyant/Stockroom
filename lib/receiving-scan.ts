export type ScannerBuffer = { text: string; lastAt: number | null; fast: boolean };
export const SCANNER_MAX_GAP_MS = 80;
export const SCANNER_MIN_LENGTH = 4;
export const RECEIVING_DRAFT_VERSION = 3;
export type ReceivingTone = "success" | "error";
type ToneContext = { currentTime: number; destination: unknown; createOscillator(): { type: string; frequency: { setValueAtTime(value: number, at: number): void }; connect(destination: unknown): void; start(at?: number): void; stop(at?: number): void }; createGain(): { gain: { setValueAtTime(value: number, at: number): void; exponentialRampToValueAtTime(value: number, at: number): void }; connect(destination: unknown): void } };
export function playReceivingTone(kind: ReceivingTone, muted: boolean, createContext: () => ToneContext = () => new AudioContext() as unknown as ToneContext) {
  if (muted) return false;
  try {
    const context = createContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "success" ? 880 : 220, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
    return true;
  } catch {
    return false;
  }
}

export function scannerKey(
  buffer: ScannerBuffer,
  key: string,
  at: number,
  maxGapMs = SCANNER_MAX_GAP_MS,
) {
  if (key === "Enter") {
    const barcode = buffer.fast && buffer.text.length >= SCANNER_MIN_LENGTH ? buffer.text : undefined;
    return { buffer: { text: "", lastAt: null, fast: true }, barcode, handled: Boolean(barcode) };
  }
  if (key.length !== 1) return { buffer, handled: false };
  const fast = buffer.lastAt === null || at - buffer.lastAt <= maxGapMs;
  return {
    buffer: { text: fast ? buffer.text + key : key, lastAt: at, fast },
    handled: fast,
  };
}

export type ReceivingDraftEnvelope<T> = { version: number; warehouse: string; lines: T[] };
export function draftStorageKey(warehouse: string) { return `stockroom.receiving.draft.${warehouse}`; }
export function readReceivingDraft<T>(storage: Storage | null, warehouse: string, valid: (value: unknown) => value is T) {
  if (!storage || !warehouse) return { lines: [] as T[], dropped: 0 };
  try {
    const raw = storage.getItem(draftStorageKey(warehouse));
    if (!raw) return { lines: [] as T[], dropped: 0 };
    const parsed = JSON.parse(raw) as Partial<ReceivingDraftEnvelope<unknown>>;
    if (![1, 2, RECEIVING_DRAFT_VERSION].includes(Number(parsed.version)) || parsed.warehouse !== warehouse || !Array.isArray(parsed.lines)) return { lines: [] as T[], dropped: 0, rejected: true };
    const lines = parsed.lines.filter(valid) as T[];
    return { lines, dropped: parsed.lines.length - lines.length };
  } catch { return { lines: [] as T[], dropped: 0, rejected: true }; }
}
export function writeReceivingDraft<T>(storage: Storage | null, warehouse: string, lines: T[]) {
  if (!storage || !warehouse) return false;
  try { storage.setItem(draftStorageKey(warehouse), JSON.stringify({ version: RECEIVING_DRAFT_VERSION, warehouse, lines })); return true; } catch { return false; }
}
export function clearReceivingDraft(storage: Storage | null, warehouse: string) {
  if (!storage || !warehouse) return;
  try { storage.removeItem(draftStorageKey(warehouse)); } catch { /* blocked storage is non-fatal */ }
}

export type ReceivingDraft = {
  product: string;
  barcode: string;
  batch: string;
  manufacturingDate: string;
  expiry: string;
  received: number;
  damaged: number;
  warehouse: string;
};

export function validateReceivingLine(line: ReceivingDraft, currentDate: string, productLabel = line.product) {
  if (!Number.isSafeInteger(line.received) || line.received < 1) return "Received quantity must be a positive whole number.";
  if (!Number.isSafeInteger(line.damaged) || line.damaged < 0) return "Damaged quantity must be a non-negative whole number.";
  if (line.damaged > line.received) return "Damaged quantity cannot exceed received quantity.";
  if (!line.expiry) return `Set dates for ${productLabel}`;
  if (line.expiry < currentDate) return "Expiry must be today or later.";
  if (line.manufacturingDate && line.manufacturingDate > line.expiry) return "Production date must be on or before expiry.";
  if (line.manufacturingDate && line.manufacturingDate > currentDate) return "Production date cannot be in the future.";
  return "";
}

export function commitReceivingDraft(lines: ReceivingDraft[], draft: ReceivingDraft) {
  if (!Number.isSafeInteger(draft.received) || draft.received < 1)
    throw Error("Received quantity must be a positive whole number.");
  if (!Number.isSafeInteger(draft.damaged) || draft.damaged < 0 || draft.damaged > draft.received)
    throw Error("Damaged quantity must be non-negative and cannot exceed received quantity.");
  if (!draft.product || !draft.barcode)
    throw Error("Product, barcode, and warehouse are required.");
  return [...lines, { ...draft, batch: draft.batch.trim(), accepted: draft.received - draft.damaged }];
}

export function pendingBatchDuplicateErrors(lines: ReceivingDraft[]) {
  const groups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const key = `${line.product}|${line.batch.trim()}`;
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  const errors = lines.map(() => "");
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const labels = indexes.map((index) => index + 1).join(" and ");
    for (const index of indexes) errors[index] = `Rows ${labels} use the same batch`;
  }
  return errors;
}
