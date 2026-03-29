import { redirect } from "next/navigation";
import { MessengerClient } from "@/components/messenger-client";
import { getSessionFromCookies } from "@/lib/session";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const appBaseUrl = process.env.APP_BASE_URL || "https://gomo6.wtf";
  const session = await getSessionFromCookies();
  if (!session) {
    redirect(`${appBaseUrl}/auth`);
  }

  const params = await searchParams;
  const targetUserId = params.user ?? null;

  return <MessengerClient username={session.username} targetUserId={targetUserId} appBaseUrl={appBaseUrl} />;
}
