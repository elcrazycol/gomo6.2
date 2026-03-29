import { redirect } from "next/navigation";
import { MessengerClient } from "@/components/messenger-client";
import { getSessionFromCookies } from "@/lib/session";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const session = await getSessionFromCookies();
  if (!session) {
    redirect("https://gomo6.ru/auth");
  }

  const params = await searchParams;
  const targetUserId = params.user ?? session.targetUserId ?? null;

  return <MessengerClient username={session.username} targetUserId={targetUserId} />;
}
