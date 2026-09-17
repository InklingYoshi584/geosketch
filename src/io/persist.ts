/**
 * `.geosketch` document persistence (schema v1).
 *
 * The document is plain JSON end to end: `serializeDoc`/`parseDoc` copy values
 * verbatim instead of rebuilding them from typed classes, so a round trip is
 * lossless. Fields and object `type` strings this version does not know about
 * are kept — that is the forward-compatibility contract of DESIGN.md §6 (the
 * M3 `.gsp` importer must not force a schema migration).
 *
 * Browser APIs are feature-detected, so the pure helpers (`serializeDoc`,
 * `parseDoc`, the autosave trio) are safe to call outside a DOM.
 */
import { DEFAULT_VIEWPORT, type Doc, type Viewport } from '../engine';

/** Schema version this build writes and accepts. */
const SCHEMA_VERSION = 1;

/** Root key order of the on-disk format; unknown root fields follow after. */
const ROOT_KEYS = ['version', 'viewport', 'axes', 'objects'] as const;

const JSON_MIME = 'application/json';
const FILE_TYPES = [
  { description: 'geosketch sketch', accept: { [JSON_MIME]: ['.geosketch', '.json'] } },
];
const ACCEPT_ATTR = '.geosketch,.json,application/json';

/** Crash-recovery slot in `localStorage`. */
const AUTOSAVE_KEY = 'geosketch.autosave.v1';

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Pretty (2-space) JSON with a stable root key order: `version`, `viewport`,
 * `axes` (when present), `objects`, then any unknown root fields in their
 * original order. Object records are emitted as-is, so record key order and
 * unknown record fields survive too.
 */
export function serializeDoc(doc: Doc): string {
  const source = doc as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { version: SCHEMA_VERSION, viewport: source.viewport };
  for (const key of ROOT_KEYS) {
    if (key !== 'version' && key !== 'viewport' && key in source) out[key] = source[key];
  }
  for (const key of Object.keys(source)) {
    if (!(key in out)) out[key] = source[key];
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Parse and validate a `.geosketch` document.
 *
 * Throws an `Error` naming the exact problem (invalid JSON, wrong version,
 * malformed records); callers surface that message to the user. Known fields
 * are validated, never rewritten, and unknown ones are preserved verbatim.
 */
export function parseDoc(text: string): Doc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid document: the top level must be a JSON object, got ${describe(parsed)}`);
  }
  const root = parsed as Record<string, unknown>;

  if (root.version !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported document version ${describe(root.version)}: this build reads version ${SCHEMA_VERSION}`,
    );
  }

  const objects = root.objects;
  if (!Array.isArray(objects)) {
    throw new Error(`invalid document: "objects" must be an array, got ${describe(objects)}`);
  }

  const seen = new Set<string>();
  objects.forEach((record, index) => {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new Error(`invalid document: objects[${index}] must be an object, got ${describe(record)}`);
    }
    const { id, type, parents, params } = record as Record<string, unknown>;
    const at = `objects[${index}]`;
    if (typeof id !== 'string' || id === '') {
      throw new Error(`invalid document: ${at}.id must be a non-empty string`);
    }
    const where = `${at} ("${id}")`;
    if (typeof type !== 'string' || type === '') {
      throw new Error(`invalid document: ${where}.type must be a non-empty string`);
    }
    // `type` is deliberately NOT checked against the registry: unknown types are
    // valid data (they round-trip and render as unsupported placeholders).
    if (!Array.isArray(parents) || parents.some((parent) => typeof parent !== 'string')) {
      throw new Error(`invalid document: ${where}.parents must be an array of object ids`);
    }
    if (params === null || typeof params !== 'object') {
      throw new Error(`invalid document: ${where}.params must be a JSON object`);
    }
    if (seen.has(id)) throw new Error(`invalid document: duplicate object id "${id}"`);
    seen.add(id);
  });

  // A copy: the parsed Doc owns its viewport, never the shared constant.
  const viewport = root.viewport === undefined ? { ...DEFAULT_VIEWPORT } : normalizeViewport(root.viewport);

  // Every root field is preserved; only `version`/`viewport`/`objects` are normalized.
  return { ...root, version: SCHEMA_VERSION, viewport, objects } as unknown as Doc;
}

/** Keep unknown viewport fields; pin the three the renderer needs. */
function normalizeViewport(viewport: unknown): Viewport {
  if (typeof viewport !== 'object' || viewport === null || Array.isArray(viewport)) {
    throw new Error(`invalid document: "viewport" must be an object, got ${describe(viewport)}`);
  }
  const { cx, cy, scale } = viewport as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!finite(cx) || !finite(cy) || !finite(scale) || scale <= 0) {
    throw new Error(
      `invalid document: "viewport" must hold finite cx/cy and a positive scale, got ${JSON.stringify(viewport)}`,
    );
  }
  return { ...viewport, cx, cy, scale } as unknown as Viewport;
}

// ---------------------------------------------------------------------------
// Save / open
// ---------------------------------------------------------------------------

/**
 * Save a document as `.geosketch`. Uses the File System Access API where the
 * browser has it, otherwise a Blob download. Dismissing the picker is a normal
 * outcome, not an error.
 */
export async function saveDocFile(doc: Doc, suggestedName = 'untitled.geosketch'): Promise<void> {
  const text = serializeDoc(doc);

  const pickSave = getPicker('showSaveFilePicker');
  if (pickSave) {
    const handle = await cancelled(() => pickSave({ suggestedName, types: FILE_TYPES }));
    if (!handle) return;
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('cannot save in this environment: no file picker and no DOM download path');
  }
  const url = URL.createObjectURL(new Blob([text], { type: JSON_MIME }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Let the download start before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Prompt for and parse a `.geosketch` file. Returns `null` when the user
 * cancels; parse/validation errors propagate so the caller can show them.
 */
export async function openDocFile(): Promise<{ doc: Doc; name: string } | null> {
  const pickOpen = getPicker('showOpenFilePicker');
  if (pickOpen) {
    const picked = await cancelled(() => pickOpen({ multiple: false, types: FILE_TYPES }));
    const handle = picked?.[0];
    if (!handle) return null;
    const file = await handle.getFile();
    return { doc: parseDoc(await file.text()), name: file.name };
  }

  if (typeof document === 'undefined') {
    throw new Error('cannot open a file in this environment: no file picker and no DOM');
  }
  return openViaFileInput();
}

/** `<input type=file>` fallback for browsers without the File System Access API. */
function openViaFileInput(): Promise<{ doc: Doc; name: string } | null> {
  type Opened = { doc: Doc; name: string } | null;
  const { promise, resolve, reject } = (Promise as unknown as ResolversLike).withResolvers<Opened>();

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT_ATTR;
  input.style.display = 'none';

  let settled = false;
  const settle = (act: () => void): void => {
    if (settled) return;
    settled = true;
    input.remove();
    act();
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      settle(() => resolve(null));
      return;
    }
    file.text().then(
      (text) => {
        let doc: Doc;
        try {
          doc = parseDoc(text);
        } catch (err) {
          settle(() => reject(err));
          return;
        }
        settle(() => resolve({ doc, name: file.name }));
      },
      (err: unknown) => settle(() => reject(err)),
    );
  });
  // Fired when the picker is dismissed without choosing a file.
  input.addEventListener('cancel', () => settle(() => resolve(null)));

  document.body.appendChild(input);
  input.click();
  return promise;
}

/**
 * Run a file-picker call, mapping user cancellation (`AbortError`) to `null`.
 * Any other failure propagates.
 */
async function cancelled<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Crash-recovery autosave
// ---------------------------------------------------------------------------

/** Store the current document for crash recovery. Never throws, never blocks a drag. */
export function autosaveSave(doc: Doc): void {
  const store = localStore();
  if (!store) return;
  try {
    store.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), text: serializeDoc(doc) }));
  } catch {
    // Quota exceeded or storage disabled mid-session: autosave is best-effort.
  }
}

/** The document autosaved by an earlier session, or `null`. */
export function autosaveLoad(): Doc | null {
  const store = localStore();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const payload: unknown = JSON.parse(raw);
    const text =
      typeof payload === 'object' && payload !== null ? (payload as { text?: unknown }).text : undefined;
    if (typeof text !== 'string') return null;
    return parseDoc(text);
  } catch {
    // Corrupt payload or stale schema: treat the slot as empty rather than
    // blocking startup on a document the user never asked to open.
    return null;
  }
}

/** Drop the autosave slot (after a successful save, or an explicit discard). */
export function autosaveClear(): void {
  const store = localStore();
  if (!store) return;
  try {
    store.removeItem(AUTOSAVE_KEY);
  } catch {
    // Unreachable storage: nothing to clear.
  }
}

function localStore(): Storage | null {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null; // blocked by privacy settings -> even touching it throws
  }
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  name?: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
}

interface PickerOptions {
  suggestedName?: string;
  multiple?: boolean;
  types?: typeof FILE_TYPES;
}

interface PickerHost {
  showSaveFilePicker?: (options?: PickerOptions) => Promise<FileHandleLike>;
  showOpenFilePicker?: (options?: PickerOptions) => Promise<FileHandleLike[]>;
}

/** The browser's picker of that name, or `null` when unsupported. */
function getPicker<K extends keyof PickerHost>(name: K): NonNullable<PickerHost[K]> | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as PickerHost)[name];
  return typeof candidate === 'function' ? (candidate as NonNullable<PickerHost[K]>) : null;
}

/**
 * `Promise.withResolvers` (ES2024) as a typed local view: the tsconfig targets
 * ES2022, so the standard lib declaration is absent.
 */
interface ResolversLike {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'an array';
  // Primitives read naturally (2 -> "2", "2" -> '"2"', null -> "null");
  // JSON.parse output is always JSON-representable.
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  return 'an object';
}
