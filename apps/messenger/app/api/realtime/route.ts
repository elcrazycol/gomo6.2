import { NextRequest } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { getMessengerConversationSnapshot, getMessengerUserByMainId } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const eventChunk = (event: string, data: Record<string, unknown>) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const heartbeatChunk = () => encoder.encode(": keepalive\n\n");

export async function GET(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const self = await getMessengerUserByMainId(session.sub);
  if (!self) {
    return new Response("Messenger user not found", { status: 404 });
  }

  const conversationId = request.nextUrl.searchParams.get("conversationId");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let previousSnapshot = "";

      const pushSnapshot = async () => {
        if (closed) return;

        try {
          const nextSnapshot = await getMessengerConversationSnapshot(self.id, conversationId);
          if (nextSnapshot !== previousSnapshot) {
            previousSnapshot = nextSnapshot;
            controller.enqueue(eventChunk("update", { at: Date.now() }));
          } else {
            controller.enqueue(heartbeatChunk());
          }
        } catch {
          controller.enqueue(eventChunk("warning", { message: "snapshot_failed" }));
        }
      };

      await pushSnapshot();
      const interval = setInterval(() => {
        void pushSnapshot();
      }, 2000);

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
