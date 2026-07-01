import { useEffect, useRef, useState } from "react";
import { Music, ExternalLink, Disc3 } from "lucide-react";
import { wsService } from "@/services/websocket";

interface NowPlayingData {
  is_playing: boolean;
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  album_art_url?: string;
  track_url?: string;
  progress_ms?: number;
  duration_ms?: number;
  is_connected: boolean;
}

type SpotifyNowPlayingProps = {
  userId: string;
};

/**
 * SpotifyNowPlaying shows what a user is currently listening to on Spotify.
 * Polls the API on mount and listens for WebSocket updates.
 */
export const SpotifyNowPlaying = ({ userId }: SpotifyNowPlayingProps) => {
  const [data, setData] = useState<NowPlayingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayProgressMs, setDisplayProgressMs] = useState(0);
  const baseRef = useRef({ progress: 0, receivedAt: 0, duration: 0, playing: false });

  useEffect(() => {
    let mounted = true;

    const fetchNowPlaying = async () => {
      try {
        const res = await fetch(
          `/api/v1/integrations/spotify/now-playing/${encodeURIComponent(userId)}`
        );
        const json = await res.json();
        if (mounted) applyUpdate(json);
      } catch {
        if (mounted) {
          setData(null);
          setLoading(false);
        }
      }
    };

    // Subscribe to WebSocket updates
    const applyUpdate = (d: NowPlayingData) => {
      setData(d);
      setLoading(false);
      baseRef.current = {
        progress: d.progress_ms ?? 0,
        receivedAt: Date.now(),
        duration: d.duration_ms ?? 0,
        playing: d.is_playing,
      };
      setDisplayProgressMs(d.progress_ms ?? 0);
    };

    const room = `profile_now_playing_${userId}`;
    wsService.subscribe(room);
    const unsubHandler = wsService.on("now_playing", (msg) => {
      const p = msg.data as {
        user_id?: string;
        response?: NowPlayingData;
      };
      if (p?.user_id === userId && p?.response) {
        applyUpdate(p.response);
      }
    });

    fetchNowPlaying();

    // Poll every 30s as fallback
    const pollInterval = setInterval(fetchNowPlaying, 30000);

    // Interpolation loop: smoothly advance progress between server updates
    const interpId = setInterval(() => {
      const b = baseRef.current;
      if (!b.playing || b.duration === 0) return;
      const elapsed = Date.now() - b.receivedAt;
      const current = Math.min(b.progress + elapsed, b.duration);
      setDisplayProgressMs(current);
    }, 200);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
      clearInterval(interpId);
      unsubHandler();
      wsService.unsubscribe(room);
    };
  }, [userId]);

  if (loading) return null;

  if (!data || !data.is_connected || !data.is_playing) return null;

  const progressPct =
    data.duration_ms && displayProgressMs > 0
      ? Math.min((displayProgressMs / data.duration_ms) * 100, 100)
      : 0;

  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Disc3 className="h-3.5 w-3.5 text-[#1DB954] animate-pulse" />
        <span className="font-medium">Сейчас слушает</span>
        <Music className="h-3.5 w-3.5 text-[#1DB954]" />
      </div>

      {/* Track info */}
      <div className="flex items-center gap-3">
        {/* Album art */}
        {data.album_art_url ? (
          <div className="relative shrink-0">
            <img
              src={data.album_art_url}
              alt={data.album_name || "Album art"}
              className="w-14 h-14 rounded-md object-cover shadow-lg"
              loading="lazy"
            />
            {/* Spinning vinyl effect overlay */}
            <div className="absolute inset-0 rounded-md bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
          </div>
        ) : (
          <div className="w-14 h-14 rounded-md bg-[#1DB954]/10 flex items-center justify-center shrink-0">
            <Music className="h-6 w-6 text-[#1DB954]" />
          </div>
        )}

        {/* Track details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {data.track_name || "Неизвестный трек"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {data.artist_name || "Неизвестный артист"}
              </p>
              {data.album_name && (
                <p className="text-xs text-muted-foreground/60 truncate">
                  {data.album_name}
                </p>
              )}
            </div>

            {data.track_url && (
              <a
                href={data.track_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground hover:text-[#1DB954] transition-colors"
                title="Открыть в Spotify"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-[#1DB954] rounded-full"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground/50">
          <span>{formatMs(displayProgressMs)}</span>
          <span>{formatMs(data.duration_ms)}</span>
        </div>
      </div>
    </div>
  );
};

function formatMs(ms?: number): string {
  if (!ms) return "--:--";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export default SpotifyNowPlaying;
