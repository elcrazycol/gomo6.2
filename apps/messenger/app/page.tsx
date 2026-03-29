import { MessengerClient } from "@/components/messenger-client";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; conversation?: string }>;
}) {
  const params = await searchParams;

  return (
    <MessengerClient
      appBaseUrl={process.env.NEXT_PUBLIC_APP_BASE_URL || "https://gomo6.wtf"}
      initialTargetUserId={params.user ?? null}
      initialConversationId={params.conversation ?? null}
    />
  );
}
