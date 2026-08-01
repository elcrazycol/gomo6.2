import type { MessageView } from "@/components/messenger/types";

const DB_NAME = "gomo6-messenger";
const DB_VERSION = 2;
const STORE_NAME = "messages";
const MAX_CACHED_MESSAGES = 50;

type MessageCacheRecord = {
  cacheKey: string;
  conversationId: string;
  messages: MessageView[];
  savedAt: number;
};

function getCacheKey(ownerId: string, conversationId: string): string {
  return `${ownerId}:${conversationId}`;
}

function getIndexedDB(): IDBFactory | null {
  if (typeof indexedDB === "undefined") return null;
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase | null> {
  const idb = getIndexedDB();
  if (!idb) return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      // Version 2 changes the key to an owner-scoped key. Dropping the old
      // store also removes legacy unscoped records rather than risking cross-user
      // reads after a logout/login in the same browser profile.
      if (database.objectStoreNames.contains(STORE_NAME)) {
        database.deleteObjectStore(STORE_NAME);
      }
      database.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function loadCachedMessages(ownerId: string, conversationId: string): Promise<MessageView[] | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(getCacheKey(ownerId, conversationId));
      request.onsuccess = () => {
        const record = request.result as MessageCacheRecord | undefined;
        resolve(record?.messages ?? null);
      };
      request.onerror = () => resolve(null);
      request.transaction.oncomplete = () => database.close();
    } catch {
      database.close();
      resolve(null);
    }
  });
}

export async function saveCachedMessages(ownerId: string, conversationId: string, messages: MessageView[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put({
          cacheKey: getCacheKey(ownerId, conversationId),
          conversationId,
          messages: messages.slice(-MAX_CACHED_MESSAGES),
          savedAt: Date.now(),
        } satisfies MessageCacheRecord);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

export function clearMessengerCache(): Promise<void> {
  const idb = getIndexedDB();
  if (!idb) return Promise.resolve();

  return new Promise((resolve) => {
    const request = idb.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export const messengerCacheLimits = {
  maxMessages: MAX_CACHED_MESSAGES,
};
