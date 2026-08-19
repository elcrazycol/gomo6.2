import { apiClient } from "@/integrations/api/client";

export interface TranslationProposal {
  id: string;
  key: string;
  locale: string;
  value: string;
  user_id: string | null;
  username: string;
  votes: number;
  my_vote: number;
  created_at: string;
}

export async function listTranslations(locale: string): Promise<TranslationProposal[]> {
  const res = await apiClient.request<unknown>(`/api/v1/translations?locale=${encodeURIComponent(locale)}`);
  const data = res.data as unknown;
  return Array.isArray(data) ? (data as TranslationProposal[]) : [];
}

export async function submitTranslation(input: {
  key: string;
  locale: string;
  value: string;
}): Promise<TranslationProposal> {
  const res = await apiClient.request<unknown>("/api/v1/translations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const data = res.data as unknown;
  if (Array.isArray(data)) throw new Error("Unexpected response");
  return data as TranslationProposal;
}

export async function voteTranslation(id: string, direction: 1 | -1): Promise<{ votes: number; my_vote: number }> {
  const res = await apiClient.request<unknown>(`/api/v1/translations/${id}/vote`, {
    method: "POST",
    body: JSON.stringify({ direction }),
  });
  const data = res.data as unknown;
  if (Array.isArray(data)) throw new Error("Unexpected response");
  return data as { votes: number; my_vote: number };
}

export async function deleteTranslation(id: string): Promise<void> {
  await apiClient.request<unknown>(`/api/v1/translations/${id}`, { method: "DELETE" });
}
