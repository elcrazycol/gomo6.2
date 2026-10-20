import type { Attachment } from "@/components/messenger/types";

// ─── Messenger outbox ─────────────────────────────────────────────────────
// A message the reader sent is theirs the moment they press send. Telegram keeps
// it in the chat with a clock, retries on its own when the network returns, and
// the pending bubble survives an app restart — losing it (or popping a toast)
// would be the odd behaviour.
//
// The queue is persisted in its own IndexedDB database (the message cache's
// upgrade logic wipes its store on version bumps, and pending mail must never be
// collateral damage). A Map mirrors it so private mode / jsdom still work.

const DB_NAME = "gomo6-messenger-outbox";
const DB_VERSION = 1;
const STORE = "entries";
/** Give up after this many attempts; the bubble turns into the failed state. */
export const OUTBOX_MAX_ATTEMPTS = 6;
/** Backoff between attempts: 2s, 4s, 8s, 16s, 30s, 30s. */
export const OUTBOX_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000, 30000];

export type OutboxEntry = {
  /** `${ownerId}:${conversationId}:${clientId}` — one entry per message. */
  key: string;
  ownerId: string;
  conversationId: string;
  /** Plaintext as typed; notes are encrypted again on every attempt. */
  content: string;
  clientId: string;
  parentMessageId?: string;
  attachments: Attachment[];
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** The queue gave up (a refusal or too many attempts): only a tap retries it. */
  gaveUp?: boolean;
};

type OutboxRecord = OutboxEntry;

const memory = new Map<string, OutboxRecord>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

export function outboxKey(ownerId: string, conversationId: string, clientId: string): string {
  return `${ownerId}:${conversationId}:${clientId}`;
}

function getIndexedDB(): IDBFactory | null {
  if (typeof indexedDB === "undefined") return null;
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!databasePromise) {
    const idb = getIndexedDB();
    if (!idb) {
      databasePromise = Promise.resolve(null);
    } else {
      databasePromise = new Promise((resolve) => {
        let request: IDBOpenDBRequest;
        try {
          request = idb.open(DB_NAME, DB_VERSION);
        } catch {
          resolve(null);
          return;
        }
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE)) {
            database.createObjectStore(STORE, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }
  }
  return databasePromise;
}

function transaction(database: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return database.transaction(STORE, mode).objectStore(STORE);
}

/** Save (or replace) one entry. Never throws: the in-memory copy already has it. */
export async function putOutbox(entry: OutboxEntry): Promise<void> {
  memory.set(entry.key, entry);
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const request = transaction(database, "readwrite").put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteOutbox(key: string): Promise<void> {
  memory.delete(key);
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const request = transaction(database, "readwrite").delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Every pending entry of one account, oldest first. */
export async function listOutbox(ownerId: string): Promise<OutboxEntry[]> {
  const database = await openDatabase();
  if (database) {
    const stored = await new Promise<OutboxEntry[]>((resolve) => {
      try {
        const request = transaction(database, "readonly").getAll();
        request.onsuccess = () => resolve((request.result as OutboxEntry[]) ?? []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    // IndexedDB is the truth; the memory copy only covers a failed open.
    const normalized = stored.map((entry) => ({ ...entry, attachments: entry.attachments ?? [] }));
    normalized.forEach((entry) => memory.set(entry.key, entry));
    return normalized
      .filter((entry) => entry.ownerId === ownerId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  return [...memory.values()]
    .filter((entry) => entry.ownerId === ownerId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Drop everything for an account (sign-out): pending mail must not follow another user. */
export async function clearOutbox(ownerId?: string): Promise<void> {
  const database = await openDatabase();
  const entries = ownerId ? await listOutbox(ownerId) : [...memory.values()];
  entries.forEach((entry) => memory.delete(entry.key));
  if (!database) {
    if (!ownerId) memory.clear();
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const store = transaction(database, "readwrite");
      if (ownerId) entries.forEach((entry) => store.delete(entry.key));
      else store.clear();
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Delay before the next attempt for an entry that just failed. */
export function outboxRetryDelay(attempts: number): number {
  const index = Math.min(Math.max(0, attempts - 1), OUTBOX_BACKOFF_MS.length - 1);
  return OUTBOX_BACKOFF_MS[index];
}

/** Permanent refusals: a retry cannot help, the bubble must turn into "failed". */
export function isPermanentSendError(status: number | undefined): boolean {
  if (!status) return false;
  if (status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** Only for tests. */
export function __resetOutboxForTests(): void {
  memory.clear();
  databasePromise = null;
}
