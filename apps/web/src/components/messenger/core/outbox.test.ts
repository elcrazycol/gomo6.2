import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetOutboxForTests,
  clearOutbox,
  deleteOutbox,
  isPermanentSendError,
  listOutbox,
  outboxKey,
  outboxRetryDelay,
  putOutbox,
  type OutboxEntry,
} from "./outbox";

const entry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  key: outboxKey("u1", "conv-1", "client-1"),
  ownerId: "u1",
  conversationId: "conv-1",
  content: "привет",
  clientId: "client-1",
  attachments: [],
  createdAt: 1000,
  attempts: 0,
  nextAttemptAt: 0,
  ...overrides,
});

beforeEach(() => {
  __resetOutboxForTests();
});

describe("outbox queue", () => {
  it("keys an entry by account, chat and client id", () => {
    expect(outboxKey("u1", "conv-1", "client-1")).toBe("u1:conv-1:client-1");
  });

  it("keeps entries oldest first and replaces by key", async () => {
    await putOutbox(entry({ clientId: "b", key: outboxKey("u1", "conv-1", "b"), createdAt: 2000 }));
    await putOutbox(entry({ clientId: "a", key: outboxKey("u1", "conv-1", "a"), createdAt: 1000 }));
    await putOutbox(entry({ clientId: "a", key: outboxKey("u1", "conv-1", "a"), content: "правка" }));

    const queued = await listOutbox("u1");

    expect(queued.map((item) => item.clientId)).toEqual(["a", "b"]);
    expect(queued[0].content).toBe("правка");
  });

  it("never hands another account's pending mail to the current user", async () => {
    await putOutbox(entry({ ownerId: "u1", key: outboxKey("u1", "conv-1", "c1") }));
    await putOutbox(entry({ ownerId: "u2", key: outboxKey("u2", "conv-2", "c2"), conversationId: "conv-2" }));

    expect((await listOutbox("u2")).map((item) => item.key)).toEqual(["u2:conv-2:c2"]);
  });

  it("deletes one entry and clears an account", async () => {
    await putOutbox(entry());
    await putOutbox(entry({ clientId: "c2", key: outboxKey("u1", "conv-1", "c2"), createdAt: 2000 }));

    await deleteOutbox(outboxKey("u1", "conv-1", "client-1"));
    expect((await listOutbox("u1")).map((item) => item.clientId)).toEqual(["c2"]);

    await clearOutbox("u1");
    expect(await listOutbox("u1")).toHaveLength(0);
  });

  it("clears everything on sign-out when no account is given", async () => {
    await putOutbox(entry());
    await putOutbox(entry({ ownerId: "u2", key: outboxKey("u2", "conv-2", "c2") }));

    await clearOutbox();

    expect(await listOutbox("u1")).toHaveLength(0);
    expect(await listOutbox("u2")).toHaveLength(0);
  });
});

describe("outbox retry policy", () => {
  it("backs off and then stays at the ceiling", () => {
    expect(outboxRetryDelay(1)).toBe(2000);
    expect(outboxRetryDelay(2)).toBe(4000);
    expect(outboxRetryDelay(3)).toBe(8000);
    expect(outboxRetryDelay(6)).toBe(30000);
    expect(outboxRetryDelay(50)).toBe(30000);
  });

  it("retries network, auth-refresh, timeout, rate limit and server errors", () => {
    expect(isPermanentSendError(undefined)).toBe(false);
    expect(isPermanentSendError(401)).toBe(false);
    expect(isPermanentSendError(408)).toBe(false);
    expect(isPermanentSendError(429)).toBe(false);
    expect(isPermanentSendError(500)).toBe(false);
    expect(isPermanentSendError(503)).toBe(false);
  });

  it("gives up only on refusals a retry cannot fix", () => {
    expect(isPermanentSendError(400)).toBe(true);
    expect(isPermanentSendError(403)).toBe(true);
    expect(isPermanentSendError(404)).toBe(true);
    expect(isPermanentSendError(413)).toBe(true);
    expect(isPermanentSendError(422)).toBe(true);
  });
});
