import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listConversationsForUser } from "@/lib/messenger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const eventChunk = (event: string, payload: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

export async function GET(request: NextRequest) {
  const accessToken = request.nextUrl.searchParams.get("accessToken");
  const user = await getAuthenticatedUser(
    request.headers.get("authorization") ?? (accessToken ? `Bearer ${accessToken}` : null)
  );
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const selectedConversationId = request.nextUrl.searchParams.get("conversationId");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let previousSnapshot = "";
      let closed = false;

      const tick = async () => {
        if (closed) return;

        try {
          const conversations = await listConversationsForUser(user.id);
          const selectedConversation = selectedConversationId
            ? conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
            : null;
          const snapshot = JSON.stringify({
            conversations: conversations.map((conversation) => ({
              id: conversation.id,
              lastMessageAt: conversation.lastMessageAt,
              unreadCount: conversation.unreadCount,
              lastReadAt: conversation.lastReadAt,
              peerId: conversation.otherUser.id,
            })),
            selectedConversation: selectedConversation
              ? {
                  id: selectedConversation.id,
                  lastMessageAt: selectedConversation.lastMessageAt,
                  unreadCount: selectedConversation.unreadCount,
                  lastReadAt: selectedConversation.lastReadAt,
                }
              : null,
          });

          if (snapshot !== previousSnapshot) {
            previousSnapshot = snapshot;
            controller.enqueue(eventChunk("update", { snapshot: JSON.parse(snapshot), at: Date.now() }));
          } else {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch {
          controller.enqueue(eventChunk("warning", { message: "snapshot_failed" }));
        }
      };

      await tick();
      const interval = setInterval(() => void tick(), 2500);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
