import { useCallback, useEffect, useState } from "react";
import { api } from "@/integrations/api/compat";

/** One profile album row (post_count embedded by the albums GET handler). */
export interface ProfileAlbum {
  id: string;
  user_id: string;
  name: string;
  post_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Profile albums state + mutations. The albums list is fetched raw (bypasses
 * the client GET cache) so post_count is always fresh; writes go through the
 * query builder, which handles auth and invalidates the client cache. The
 * server data cache is invalidated by the backend album hooks.
 */
export function useProfileAlbums(userId: string | undefined, enabled: boolean) {
  const [albums, setAlbums] = useState<ProfileAlbum[]>([]);
  const [albumsLoaded, setAlbumsLoaded] = useState(false);

  const loadAlbums = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/v1/profile_albums?user_id=eq.${userId}`);
      const json = await res.json();
      setAlbums((json.data as ProfileAlbum[]) || []);
    } catch (error) {
      console.error("Error loading profile albums:", error);
    } finally {
      setAlbumsLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    loadAlbums();
  }, [enabled, userId, loadAlbums]);

  const createAlbum = useCallback(async (name: string) => {
    const { data, error } = await api.from("profile_albums").insert({ name }).single();
    if (error) throw error;
    await loadAlbums();
    return data as ProfileAlbum | null;
  }, [loadAlbums]);

  const renameAlbum = useCallback(async (albumId: string, name: string) => {
    const { error } = await api.from("profile_albums").update({ name }).eq("id", albumId).single();
    if (error) throw error;
    await loadAlbums();
  }, [loadAlbums]);

  const deleteAlbum = useCallback(async (albumId: string) => {
    const { error } = await api.from("profile_albums").delete().eq("id", albumId).single();
    if (error) throw error;
    await loadAlbums();
  }, [loadAlbums]);

  const addPosts = useCallback(async (albumId: string, postIds: string[]) => {
    for (const postId of postIds) {
      const { error } = await api.from("profile_album_posts").insert({ album_id: albumId, post_id: postId }).single();
      if (error) throw error;
    }
    await loadAlbums();
  }, [loadAlbums]);

  const removePost = useCallback(async (albumId: string, postId: string) => {
    const { error } = await api
      .from("profile_album_posts")
      .delete()
      .eq("album_id", albumId)
      .eq("post_id", postId)
      .single();
    if (error) throw error;
    await loadAlbums();
  }, [loadAlbums]);

  return { albums, albumsLoaded, loadAlbums, createAlbum, renameAlbum, deleteAlbum, addPosts, removePost };
}
