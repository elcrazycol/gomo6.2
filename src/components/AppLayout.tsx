import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { HeaderUsername } from "@/components/HeaderUsername";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
import { Settings, SkipBack, SkipForward, Play, Pause, Volume2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AppLayoutProps {
  children: React.ReactNode;
}

type NowPlayingState = {
  id: string;
  title: string;
  instance: any;
  playlistId?: string;
  playlistIndex?: number;
};

export const AppLayout = ({ children }: AppLayoutProps) => {
  const APP_VERSION = "v1.4";
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const audioMapRef = useRef<Map<string, { inst: any; title: string; playlistId?: string; playlistIndex?: number }>>(
    new Map()
  );
  const playlistMapRef = useRef<
    Map<
      string,
      {
        id: string;
        title: string;
        src?: string;
        index: number;
      }[]
    >
  >(new Map());
  const [progress, setProgress] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });
  const lastProgressUpdateRef = useRef<number>(0);
  const [volume, setVolume] = useState(1);
  const storedVolumeRef = useRef<number | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(false);
  const [contentPad, setContentPad] = useState<number>(72);
  const lastTrackRef = useRef<{ id: string; title: string; src?: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const controlRef = useRef<(action: "prev" | "next" | "toggle" | "mute") => void>(() => {});
  const { scrollY } = useScroll();

  useEffect(() => {
    console.info(`[gomo6] App version: ${APP_VERSION}`);
  }, []);

  const pauseOthers = (exceptId?: string) => {
    audioMapRef.current.forEach((entry, key) => {
      if (key === exceptId) return;
      if (entry.inst?.pause) entry.inst.pause();
      if ("paused" in entry.inst && entry.inst.paused === false && entry.inst?.pause) entry.inst.pause();
    });
  };

  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      const prev = window.history.scrollRestoration;
      window.history.scrollRestoration = "manual";
      return () => {
        window.history.scrollRestoration = prev;
      };
    }
  }, []);

  const getOrderedIds = () => {
    if (nowPlaying?.playlistId) {
      const list = playlistMapRef.current.get(nowPlaying.playlistId) || [];
      if (list.length) return list.map((i) => i.id);
    }
    return queue;
  };

  const playTrackById = (targetId: string) => {
    let entry = audioMapRef.current.get(targetId);
    let hasMedia = !!(entry?.inst?.media || entry?.inst instanceof HTMLMediaElement);

    // Reconstruct from playlist cache if missing
    if (!entry?.inst?.play || !hasMedia) {
      const orderedIds = getOrderedIds();
      const playlistId = nowPlaying?.playlistId;
      const list = playlistId ? playlistMapRef.current.get(playlistId) || [] : [];
      const meta = list.find((i) => i.id === targetId);
      if (meta?.src) {
        const audio = new Audio(meta.src);
        audio.preload = "auto";
        const v = storedVolumeRef.current !== null ? storedVolumeRef.current : volume;
        audio.volume = v;
        audioMapRef.current.set(targetId, {
          inst: audio,
          title: meta.title || "Аудио",
          playlistId,
          playlistIndex: meta.index,
        });

        const persist = () => {
          const now = performance.now();
          if (now - lastProgressUpdateRef.current < 200) return;
          lastProgressUpdateRef.current = now;
          setProgress({ current: audio.currentTime || 0, duration: audio.duration || 0 });
          localStorage.setItem(
            "audio-last",
            JSON.stringify({
              id: targetId,
              title: meta.title || "Аудио",
              src: meta.src,
              volume: v,
              position: audio.currentTime || 0,
              playlistId,
              playlistIndex: meta.index,
            })
          );
        };
        audio.addEventListener("timeupdate", persist);
        audio.addEventListener("loadedmetadata", persist);
        audio.addEventListener("ended", () => {
          setProgress({ current: 0, duration: audio.duration || 0 });
          controlRef.current?.("next");
        });
        audio.addEventListener("playing", () => setNowPlaying((cur) => (cur ? { ...cur, instance: audio } : cur)));
        audio.addEventListener("pause", () => setNowPlaying((cur) => (cur ? { ...cur, instance: audio } : cur)));
        hasMedia = true;
        entry = audioMapRef.current.get(targetId);
        setQueue((q) => (q.includes(targetId) ? q : [...q, targetId]));
      }
    }

    if (!entry?.inst?.play || !hasMedia) return;

    pauseOthers(targetId);
    entry.inst.play();
    const playlistId = entry.playlistId ?? nowPlaying?.playlistId;
    const list = playlistId ? playlistMapRef.current.get(playlistId) || [] : [];
    const found = list.find((i) => i.id === targetId);
    setNowPlaying({
      id: targetId,
      title: entry.title,
      instance: entry.inst,
      playlistId,
      playlistIndex: found?.index,
    });
    setProgress({ current: entry.inst.currentTime || 0, duration: entry.inst.duration || 0 });
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return "0:00";
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Header animation logic
  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious();
    if (previous !== undefined && latest > previous && latest > 100) {
      setIsHeaderVisible(false);
    } else if (previous !== undefined && latest < previous) {
      setIsHeaderVisible(true);
    }
  });

  // Global audio handling: keep a queue of players and expose transport controls.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const updateMatch = () => setIsDesktop(mq.matches);
    updateMatch();
    mq.addEventListener("change", updateMatch);
    return () => mq.removeEventListener("change", updateMatch);
  }, []);

  // Restore last audio session on load (paused) and volume from storage
  useEffect(() => {
    const savedVol = localStorage.getItem("audio-volume");
    if (savedVol) {
      const v = Number(savedVol);
      if (!Number.isNaN(v)) {
        storedVolumeRef.current = Math.min(1, Math.max(0, v));
        setVolume(storedVolumeRef.current);
      }
    }

    // restore cached playlists
    const cachedPlaylists = localStorage.getItem("playlist-cache");
    if (cachedPlaylists) {
      try {
        const parsed = JSON.parse(cachedPlaylists);
        if (parsed && typeof parsed === "object") {
          Object.entries(parsed).forEach(([pid, list]: any) => {
            if (Array.isArray(list)) {
              playlistMapRef.current.set(
                pid,
                list.map((p: any) => ({
                  id: p.id,
                  title: p.title || "Аудио",
                  src: p.src,
                  index: p.index ?? 0,
                }))
              );
            }
          });
        }
      } catch {
        /* ignore */
      }
    }

    const saved = localStorage.getItem("audio-last");
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (!data?.id || !data?.src) return;

      const audio = new Audio(data.src);
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      const savedPos = data.position || 0;
      const savedVol =
        storedVolumeRef.current !== null
          ? storedVolumeRef.current
          : typeof data.volume === "number"
          ? data.volume
          : 1;
      const applySavedPosition = () => {
        if (Number.isFinite(savedPos)) audio.currentTime = savedPos;
      };
      if (audio.readyState > 0) {
        applySavedPosition();
      } else {
        audio.addEventListener("loadedmetadata", applySavedPosition, { once: true });
      }
      audio.volume = savedVol;

      const id = data.id;
      const title = data.title || "Аудио";
      const playlistId = data.playlistId;
      const playlistIndex = data.playlistIndex;

      lastTrackRef.current = { id, title, src: data.src };

      audioMapRef.current.set(id, { inst: audio, title, playlistId, playlistIndex });
      if (playlistId !== undefined) {
        const storedList = localStorage.getItem(`playlist-last-${playlistId}`);
        if (storedList) {
          try {
            const parsed = JSON.parse(storedList);
            if (Array.isArray(parsed)) {
              playlistMapRef.current.set(
                playlistId,
                parsed.map((p: any) => ({
                  id: p.id,
                  title: p.title || "Аудио",
                  src: p.src,
                  index: p.index ?? 0,
                }))
              );
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (playlistId !== undefined && playlistIndex !== undefined) {
        const list = playlistMapRef.current.get(playlistId) || [];
        const filtered = list.filter((item) => item.id !== id);
        filtered.push({ id, title, src: data.src, index: playlistIndex });
        filtered.sort((a, b) => a.index - b.index);
        playlistMapRef.current.set(playlistId, filtered);
        localStorage.setItem(
          "playlist-cache",
          JSON.stringify(Object.fromEntries(Array.from(playlistMapRef.current.entries())))
        );
      }
      setQueue((q) => (q.includes(id) ? q : [...q, id]));
      setNowPlaying({ id, title, instance: audio, playlistId, playlistIndex });
      setVolume(savedVol);
      setProgress({ current: savedPos, duration: audio.duration || 0 });

      const update = () => {
        const now = performance.now();
        if (now - lastProgressUpdateRef.current < 200) return;
        lastProgressUpdateRef.current = now;
        const current = audio.currentTime || 0;
        const duration = audio.duration || 0;
        setProgress({ current, duration });
        localStorage.setItem(
          "audio-last",
          JSON.stringify({
            id,
            title,
            src: data.src,
            volume: audio.volume,
            position: current,
            playlistId,
            playlistIndex,
          })
        );
      };
      audio.addEventListener("timeupdate", update);
      audio.addEventListener("loadedmetadata", update);
      audio.addEventListener("ended", () => {
        setProgress({ current: 0, duration: audio.duration || 0 });
        controlRef.current?.("next");
      });

      // keep persisted state updated while paused
      const persistPaused = () => {
        if (!lastTrackRef.current?.src) return;
        localStorage.setItem(
          "audio-last",
          JSON.stringify({
            id,
            title,
            src: lastTrackRef.current.src,
            volume: audio.volume,
            position: audio.currentTime || 0,
            playlistId,
            playlistIndex,
          })
        );
      };
      audio.addEventListener("pause", persistPaused);
      setRestored(true);
    } catch (e) {
      console.error("Failed to restore audio-last", e);
    }
  }, []);

  useEffect(() => {
    const handleAudioPlay = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      const id = detail.playerId || crypto.randomUUID();
      const title = detail.title || "Аудио";
      const src = detail.src;
      const playlistId = detail.playlistId as string | undefined;
      const playlistIndex = detail.playlistIndex as number | undefined;

      // Pause other audio instances to avoid overlap
      pauseOthers(id);

      lastTrackRef.current = { id, title, src };

      const targetVolume =
        storedVolumeRef.current !== null
          ? storedVolumeRef.current
          : typeof detail.instance?.volume === "number"
          ? detail.instance.volume
          : 1;

      audioMapRef.current.set(id, { inst: detail.instance, title, playlistId, playlistIndex });
      setQueue((q) => (q.includes(id) ? q : [...q, id]));
      setNowPlaying({ id, title, instance: detail.instance, playlistId, playlistIndex });
      setVolume(targetVolume);
      if (typeof detail.instance?.volume === "function") {
        detail.instance.volume(targetVolume);
      } else if (detail.instance) {
        detail.instance.volume = targetVolume;
      }

      const inst = detail.instance;
      const attachProgress = () => {
        const update = () => {
          const now = performance.now();
          if (now - lastProgressUpdateRef.current < 200) return; // throttle to reduce re-renders
          lastProgressUpdateRef.current = now;
          const current = inst.currentTime || 0;
          const duration = inst.duration || 0;
          const vol =
            typeof inst.volume === "number"
              ? inst.volume
              : typeof inst.volume === "function"
              ? inst.volume()
              : volume;
          if (storedVolumeRef.current !== null) {
            // honor stored volume; keep instance aligned
            const v = storedVolumeRef.current;
            if (typeof inst.volume === "function") inst.volume(v);
            else inst.volume = v;
          }

          setProgress((prev) =>
            prev.current !== current || prev.duration !== duration
              ? { current, duration }
              : prev
          );

          if (lastTrackRef.current?.src) {
            localStorage.setItem(
              "audio-last",
              JSON.stringify({
                id: lastTrackRef.current.id,
                title: lastTrackRef.current.title,
                src: lastTrackRef.current.src,
                volume: vol,
                position: current,
                playlistId,
                playlistIndex,
              })
            );
          }
        };
        // normalize events for plyr (inst.on) and native audio
        if (typeof inst.on === "function") {
          inst.on("timeupdate", update);
          inst.on("loadedmetadata", update);
          inst.on("ended", () => {
            setProgress({ current: 0, duration: inst.duration || 0 });
            controlRef.current?.("next");
          });
          inst.on("playing", () => setNowPlaying((cur) => (cur ? { ...cur, instance: inst } : cur)));
          inst.on("pause", () => setNowPlaying((cur) => (cur ? { ...cur, instance: inst } : cur)));
        } else if (inst?.addEventListener) {
          inst.addEventListener("timeupdate", update);
          inst.addEventListener("loadedmetadata", update);
          inst.addEventListener("ended", () => {
            setProgress({ current: 0, duration: inst.duration || 0 });
            controlRef.current?.("next");
          });
          inst.addEventListener("playing", () => setNowPlaying((cur) => (cur ? { ...cur, instance: inst } : cur)));
          inst.addEventListener("pause", () => setNowPlaying((cur) => (cur ? { ...cur, instance: inst } : cur)));
        }
        update();
      };
      attachProgress();

      // persist meta
      if (src) {
            localStorage.setItem(
              "audio-last",
              JSON.stringify({
                id,
                title,
                src,
                volume: targetVolume,
                position: detail.instance?.currentTime || 0,
                playlistId,
                playlistIndex,
              })
            );
          }
        };

    window.addEventListener("global-audio-play", handleAudioPlay as EventListener);
    return () => window.removeEventListener("global-audio-play", handleAudioPlay as EventListener);
  }, []);

  useEffect(() => {
    const handleAudioRegister = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const id = detail.playerId;
      if (!id) return;
      const { title, src, playlistId, playlistIndex, instance } = detail;
      audioMapRef.current.set(id, { inst: instance, title: title || "Аудио", playlistId, playlistIndex });
      if (playlistId !== undefined && playlistIndex !== undefined) {
        const list = playlistMapRef.current.get(playlistId) || [];
        const filtered = list.filter((item) => item.id !== id);
        filtered.push({ id, title: title || "Аудио", src, index: playlistIndex });
        filtered.sort((a, b) => a.index - b.index);
        playlistMapRef.current.set(playlistId, filtered);
        localStorage.setItem(
          "playlist-cache",
          JSON.stringify(Object.fromEntries(Array.from(playlistMapRef.current.entries())))
        );
      }
    };

    const handleAudioUnregister = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.playerId) return;
      const { playerId, playlistId } = detail;
      audioMapRef.current.delete(playerId);
      if (playlistId !== undefined) {
        const list = playlistMapRef.current.get(playlistId);
        if (list) {
          const updated = list.filter((item) => item.id !== playerId);
          playlistMapRef.current.set(playlistId, updated);
          localStorage.setItem(
            "playlist-cache",
            JSON.stringify(Object.fromEntries(Array.from(playlistMapRef.current.entries())))
          );
        }
      }
    };

    window.addEventListener("global-audio-register", handleAudioRegister as EventListener);
    window.addEventListener("global-audio-unregister", handleAudioUnregister as EventListener);
    return () => {
      window.removeEventListener("global-audio-register", handleAudioRegister as EventListener);
      window.removeEventListener("global-audio-unregister", handleAudioUnregister as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleAudioDestroy = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const id = detail?.playerId;
      if (!id) return;

      audioMapRef.current.delete(id);
      setQueue((q) => q.filter((k) => k !== id));
      setNowPlaying((cur) => {
        if (cur?.id !== id) return cur;
        const remaining = Array.from(audioMapRef.current.keys());
        if (remaining.length > 0) {
          const nextId = remaining[0];
          const entry = audioMapRef.current.get(nextId);
          return entry ? { id: nextId, title: entry.title, instance: entry.inst } : null;
        }
        setProgress({ current: 0, duration: 0 });
        return null;
      });
    };

    window.addEventListener("global-audio-destroy", handleAudioDestroy as EventListener);
    return () => window.removeEventListener("global-audio-destroy", handleAudioDestroy as EventListener);
  }, []);

  useEffect(() => {
    const headerPad = isHeaderVisible ? (isDesktop ? 74 : 68) : 24;
    const nowPlayingPad = nowPlaying ? 52 : 0;
    setContentPad(headerPad + nowPlayingPad);
  }, [isDesktop, isHeaderVisible, nowPlaying]);

  const handleNowPlayingControl = (action: "prev" | "next" | "toggle" | "mute") => {
    if (!nowPlaying) return;

    const orderedIds = getOrderedIds();
    if (orderedIds.length === 0) return;

    const idx = orderedIds.findIndex((k) => k === nowPlaying.id);
    if (idx === -1) return;

    const currentEntry = audioMapRef.current.get(nowPlaying.id);
    const hasMedia = !!(currentEntry?.inst?.media || currentEntry?.inst instanceof HTMLMediaElement);
    if (!currentEntry?.inst?.play || !hasMedia) {
      audioMapRef.current.delete(nowPlaying.id);
      setQueue((q) => q.filter((k) => k !== nowPlaying.id));
      setNowPlaying(null);
      setProgress({ current: 0, duration: 0 });
      return;
    }

    if (action === "toggle") {
      const isPlaying =
        typeof currentEntry.inst.playing === "boolean"
          ? currentEntry.inst.playing
          : currentEntry.inst.paused === false;
      if (isPlaying) {
        currentEntry.inst.pause();
      } else {
        pauseOthers(nowPlaying.id);
        currentEntry.inst.play();
      }
      return;
    }
    if (action === "mute") {
      currentEntry.inst.muted = !currentEntry.inst.muted;
      return;
    }

    if (orderedIds.length === 1) return;

    const targetIdx =
      action === "next" ? (idx + 1) % orderedIds.length : (idx - 1 + orderedIds.length) % orderedIds.length;

    playTrackById(orderedIds[targetIdx]);
  };

  // keep latest handler for event listeners
  useEffect(() => {
    controlRef.current = handleNowPlayingControl;
  }, [handleNowPlayingControl]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        // Load user role
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .single();

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", user.id);

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p);
              break;
            }
          }
        }
      }
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Check if current page is special (no header/footer)
  const isSpecialPage = location.pathname.startsWith('/auth');

  if (isSpecialPage) {
    return <>{children}</>;
  }

  const nowPlayingTop = isHeaderVisible ? (isDesktop ? 72 : 62) : 12;

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <motion.header
        className="bg-board-header text-board-header-foreground p-2 sm:p-3 border-b border-border fixed top-0 left-0 right-0 z-50"
        initial={{ y: 0 }}
        animate={{ y: isHeaderVisible ? 0 : -100 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <Link to="/" className="text-lg sm:text-xl font-bold flex-shrink-0 relative group">
            gomo6
            <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            <span className="absolute inset-0 transition-transform duration-200 group-hover:translate-x-0.5"></span>
          </Link>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group">
                <Settings className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
                  <HeaderUsername userId={user.id} />
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
                Войти
              </Button>
            )}
          </div>
        </div>
      </motion.header>

      {nowPlaying && (
        <motion.div
          className="fixed left-0 right-0 z-40 px-2 sm:px-4"
          initial={false}
          animate={{ y: isHeaderVisible ? 0 : -8, top: nowPlayingTop }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
        >
          <div className="max-w-5xl mx-auto bg-card/95 backdrop-blur border border-border shadow-md rounded-md px-3 py-1 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm">
              <div className="flex gap-1">
                <button
                  className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted/40 transition"
                  onClick={() => handleNowPlayingControl("prev")}
                  aria-label="Предыдущий"
                >
                  <SkipBack className="w-3 h-3" />
                </button>
              <button
                className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted/40 transition"
                onClick={() => handleNowPlayingControl("toggle")}
                aria-label="Пауза/Воспроизведение"
              >
                {(() => {
                  const inst = nowPlaying.instance;
                  const playing =
                    typeof inst?.playing === "boolean"
                      ? inst.playing
                      : inst?.paused === false;
                  return playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />;
                })()}
              </button>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted/40 transition"
                  onClick={() => handleNowPlayingControl("next")}
                  aria-label="Следующий"
                >
                  <SkipForward className="w-3 h-3" />
                </button>
              </div>
            <div className="flex-1 min-w-0 font-medium truncate">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <span className="truncate cursor-pointer">{nowPlaying.title}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="bg-card/95 border border-border shadow-md p-2 rounded-md max-w-xs">
                  <div className="flex flex-col gap-1 text-sm">
                    {(() => {
                      const list = nowPlaying.playlistId
                        ? playlistMapRef.current.get(nowPlaying.playlistId) || []
                        : queue.map((id, idx) => ({
                            id,
                            title: audioMapRef.current.get(id)?.title || `Трек ${idx + 1}`,
                            index: idx,
                          }));
                      return list.slice(0, 12).map((item, idx) => (
                        <button
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/60 transition text-left"
                          onClick={() => {
                            const targetId = item.id;
                            setQueue((q) => (q.includes(targetId) ? q : [...q, targetId]));
                            const entry = audioMapRef.current.get(targetId);
                            if (entry?.inst?.play) {
                              pauseOthers(targetId);
                              entry.inst.play();
                              setNowPlaying({
                                id: targetId,
                                title: entry.title,
                                instance: entry.inst,
                                playlistId: nowPlaying.playlistId,
                                playlistIndex: item.index,
                              });
                              setProgress({
                                current: entry.inst.currentTime || 0,
                                duration: entry.inst.duration || 0,
                              });
                              return;
                            }
                            // if no instance available, delegate to next control (will reconstruct)
                            setTimeout(() => {
                              controlRef.current?.("next");
                            }, 0);
                          }}
                        >
                          <span className="truncate">{item.title}</span>
                          <Play className="w-4 h-4" />
                        </button>
                      ));
                    })()}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground font-medium">
                <span>{formatTime(progress.current)}</span>
                <span className="text-border">/</span>
                <span>{formatTime(progress.duration || 0)}</span>
              </div>
              <div className="hidden sm:flex">
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted/40 transition"
                      aria-label="Громкость"
                    >
                      <Volume2 className="w-3 h-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="center"
                    className="bg-card/95 border border-border px-3 py-2 rounded-lg shadow-lg"
                  >
                    <div className="flex items-center gap-3 w-36">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volume}
                      onChange={(e) => {
                          const val = Number(e.target.value);
                          const clamped = Math.max(0, Math.min(1, val));
                          setVolume(clamped);
                          storedVolumeRef.current = clamped;
                          localStorage.setItem("audio-volume", String(clamped));
                          const inst = nowPlaying?.instance;
                          if (!inst) return;
                          if (typeof inst.volume === "function") {
                            inst.volume(clamped);
                          } else {
                            inst.volume = clamped;
                          }
                          if ("muted" in inst && inst.muted && clamped > 0) {
                            inst.muted = false;
                          }
                      }}
                      className="flex-1 accent-primary h-[4px] rounded-full bg-muted/70 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                    />
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div
              className="w-full h-[4px] bg-muted/50 rounded-full overflow-hidden cursor-pointer transition-all duration-150 hover:h-[6px]"
              onClick={(e) => {
                if (!nowPlaying?.instance) return;
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const dur = nowPlaying.instance.duration || 0;
                if (dur > 0) {
                  nowPlaying.instance.currentTime = dur * ratio;
                  setProgress({ current: dur * ratio, duration: dur });
                }
              }}
            >
              <div
                className="h-full bg-primary transition-all duration-100"
                style={{
                  width: progress.duration ? `${(progress.current / progress.duration) * 100}%` : "0%",
                }}
              />
            </div>
          </div>
        </motion.div>
      )}

      <div className="flex-1 min-h-0" style={{ paddingTop: contentPad }}>
        {children}
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};
