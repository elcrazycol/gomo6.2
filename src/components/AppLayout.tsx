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

export const AppLayout = ({ children }: AppLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<{ id: string; title: string; instance: any } | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const audioMapRef = useRef<Map<string, { inst: any; title: string }>>(new Map());
  const [progress, setProgress] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });
  const lastProgressUpdateRef = useRef<number>(0);
  const [volume, setVolume] = useState(1);
  const [isDesktop, setIsDesktop] = useState<boolean>(false);
  const { scrollY } = useScroll();

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

  useEffect(() => {
    const handleAudioPlay = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      const id = detail.playerId || crypto.randomUUID();
      const title = detail.title || "Аудио";

      // Pause other players when a new one starts.
      audioMapRef.current.forEach((entry, key) => {
        if (key !== id) entry.inst?.pause?.();
      });

      audioMapRef.current.set(id, { inst: detail.instance, title });
      setQueue((q) => (q.includes(id) ? q : [...q, id]));
      setNowPlaying({ id, title, instance: detail.instance });
      const initialVolume = detail.instance?.volume ?? 1;
      setVolume(typeof initialVolume === "number" ? Math.max(0, Math.min(initialVolume, 1)) : 1);

      const inst = detail.instance;
      if (inst?.on) {
        const update = () => {
          const now = performance.now();
          if (now - lastProgressUpdateRef.current < 200) return; // throttle to reduce re-renders
          lastProgressUpdateRef.current = now;
          const current = inst.currentTime || 0;
          const duration = inst.duration || 0;
          setProgress((prev) =>
            prev.current !== current || prev.duration !== duration
              ? { current, duration }
              : prev
          );
        };
        inst.on("timeupdate", update);
        inst.on("loadedmetadata", update);
        inst.on("ended", () => setProgress({ current: 0, duration: inst.duration || 0 }));
        update();
      }
    };

    window.addEventListener("global-audio-play", handleAudioPlay as EventListener);
    return () => window.removeEventListener("global-audio-play", handleAudioPlay as EventListener);
  }, []);

  const handleNowPlayingControl = (action: "prev" | "next" | "toggle" | "mute") => {
    if (!nowPlaying || queue.length === 0) return;

    const keys = queue;
    const idx = keys.findIndex((k) => k === nowPlaying.id);
    if (idx === -1) return;

    const playByKey = (key: string) => {
      const entry = audioMapRef.current.get(key);
      if (entry?.inst) {
        nowPlaying.instance?.pause?.();
        entry.inst.play();
        setNowPlaying({ id: key, title: entry.title, instance: entry.inst });
        const currentVolume = entry.inst.volume ?? volume;
        setVolume(typeof currentVolume === "number" ? currentVolume : volume);
        setProgress({
          current: entry.inst.currentTime || 0,
          duration: entry.inst.duration || 0,
        });
      }
    };

    const currentEntry = audioMapRef.current.get(nowPlaying.id);
    if (!currentEntry?.inst) return;

    if (action === "toggle") {
      currentEntry.inst.playing ? currentEntry.inst.pause() : currentEntry.inst.play();
      return;
    }
    if (action === "mute") {
      currentEntry.inst.muted = !currentEntry.inst.muted;
      return;
    }
    if (action === "next") {
      const next = (idx + 1) % keys.length;
      playByKey(keys[next]);
    } else if (action === "prev") {
      const prev = (idx - 1 + keys.length) % keys.length;
      playByKey(keys[prev]);
    }
  };

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
          style={{ top: isHeaderVisible ? (isDesktop ? 64 : 62) : 12 }}
          animate={{ y: isHeaderVisible ? 0 : -8 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
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
                  {nowPlaying.instance?.playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
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
                {nowPlaying.title}
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
                  <TooltipContent side="top" align="center" className="bg-card border border-border px-3 py-2">
                    <div className="flex items-center gap-2 w-36">
                      <span className="text-xs text-muted-foreground">0</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={volume}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setVolume(val);
                          const inst = nowPlaying?.instance;
                          if (!inst) return;
                          if (typeof inst.volume === "function") {
                            inst.volume(val);
                          } else {
                            inst.volume = val;
                          }
                          if ("muted" in inst && inst.muted && val > 0) {
                            inst.muted = false;
                          }
                        }}
                        className="flex-1 accent-primary"
                      />
                      <span className="text-xs text-muted-foreground">100</span>
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

      <div className="flex-1 min-h-0 pt-16 sm:pt-20">
        {children}
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};
