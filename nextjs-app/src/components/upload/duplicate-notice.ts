/**
 * D46 duplicate-upload notice, persisted across the wizard's navigation to
 * /prepare. The wizard unmounts the moment `router.push` runs, so the notice
 * cannot live in its component state: it is written here, keyed by the NEW
 * contract id, and the prepare page reads it back. sessionStorage survives a
 * reload of the prepare page and dies with the tab.
 */

export interface DuplicateNotice {
  /** The earlier contract holding the same bytes. */
  duplicateOf: string;
  /** ISO timestamp of that earlier upload. */
  createdAt: string;
}

const KEY_PREFIX = 'contractiq.duplicate-notice.';

/** Same-tab fallback when sessionStorage is unavailable (private mode, blocked). */
const memory = new Map<string, DuplicateNotice>();

export function rememberDuplicateNotice(contractId: string, notice: DuplicateNotice): void {
  memory.set(contractId, notice);
  try {
    window.sessionStorage.setItem(KEY_PREFIX + contractId, JSON.stringify(notice));
  } catch {
    // memory fallback already holds it
  }
}

export function readDuplicateNotice(contractId: string): DuplicateNotice | null {
  const inMemory = memory.get(contractId);
  if (inMemory) return inMemory;
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + contractId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DuplicateNotice>;
    if (typeof parsed.duplicateOf !== 'string' || typeof parsed.createdAt !== 'string') return null;
    return { duplicateOf: parsed.duplicateOf, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}
