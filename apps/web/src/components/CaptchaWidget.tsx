/**
 * CaptchaWidget — visible CAPTCHA + HoneyPot for bot protection.
 *
 * Three visual states:
 *   1. Solving:  animated pentagram spinner + "Проверка на бота..."
 *   2. Complete: green shield with checkmark + "Пройдено"
 *   3. Error:    red X + error message + "Повторить" button
 *
 * HoneyPot: hidden DOM field — bots that fill it get caught server-side.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Shield, ShieldCheck, X, RefreshCw } from "lucide-react";
import {
  fetchCaptchaConfig,
  fetchChallenge,
  solveChallenge,
  type CaptchaConfig,
} from "@/services/captchaPow";

interface CaptchaWidgetProps {
  onReady: (data: {
    challengeId: string;
    solution: string;
    captchaToken: string;
    honeypotValue: string;
  }) => void;
  onError: (error: string) => void;
}

type WidgetState = "idle" | "solving" | "done" | "error";

export function CaptchaWidget({ onReady, onError }: CaptchaWidgetProps) {
  const [config, setConfig] = useState<CaptchaConfig | null>(null);
  const [state, setState] = useState<WidgetState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState("");
  const solved = useRef(false);
  const resultRef = useRef({
    challengeId: "",
    solution: "",
    captchaToken: "",
    honeypotValue: "",
  });

  const doSolve = useCallback(async () => {
    if (solved.current) {
      setState("done");
      onReady(resultRef.current);
      return;
    }

    setState("solving");
    setErrorMsg("");
    try {
      const challenge = await fetchChallenge();
      const solution = await solveChallenge(challenge, (elapsedSec) => {
        setElapsed(`${elapsedSec.toFixed(1)}с`);
      });

      resultRef.current = {
        challengeId: challenge.challenge_id,
        solution,
        captchaToken: "",
        honeypotValue: "",
      };
      solved.current = true;
      setState("done");
      onReady(resultRef.current);
    } catch {
      const msg = (err as Error).message || "Ошибка проверки";
      setState("error");
      setErrorMsg(msg);
      onError(msg);
    }
  }, [onReady, onError]);

  useEffect(() => {
    fetchCaptchaConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.type === "pow" && cfg.enabled) {
          doSolve();
        } else if (cfg.type === "mcaptcha") {
          // External mCaptcha — its own widget handles lifecycle
          setState("done");
          onReady(resultRef.current);
        } else {
          // CAPTCHA disabled — pass through
          setState("done");
          onReady(resultRef.current);
        }
      })
      .catch(() => {
        // Config fetch failed — block submission
        setState("error");
        setErrorMsg("Сервис проверки недоступен");
        onError("Сервис проверки недоступен");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* ── HoneyPot: hidden from humans, visible to bots in DOM ── */}
      <div
        style={{
          position: "absolute",
          left: "-9999px",
          opacity: 0,
          height: 0,
          width: 0,
          overflow: "hidden",
        }}
        aria-hidden="true"
      >
        <label htmlFor="website">Website</label>
        <input
          type="text"
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {/* ── Visible CAPTCHA widget ── */}
      <div
        className={`
          relative overflow-hidden rounded-md border transition-all duration-500
          ${state === "solving"
            ? "border-primary/30 bg-primary/5"
            : state === "done"
            ? "border-emerald-500/40 bg-emerald-500/5"
            : state === "error"
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-muted/20"
          }
        `}
      >
        {/* Progress bar (solving state) */}
        {state === "solving" && (
          <div className="absolute top-0 left-0 h-0.5 w-full bg-primary/20">
            <div className="h-full bg-primary animate-[progress_2s_ease-in-out_infinite]" />
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-3">
          {/* ── Icon ── */}
          <div className="flex-shrink-0">
            {state === "solving" && (
              <div className="relative">
                <Shield className="h-5 w-5 text-primary/40 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              </div>
            )}
            {state === "done" && (
              <div className="relative">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <div className="absolute -bottom-0.5 -right-0.5 bg-emerald-500 rounded-full p-px">
                  <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            )}
            {state === "error" && (
              <div className="rounded-full bg-destructive/20 p-0.5">
                <X className="h-4 w-4 text-destructive" />
              </div>
            )}
          </div>

          {/* ── Text ── */}
          <div className="flex-1 min-w-0">
            {state === "idle" && (
              <span className="text-sm text-muted-foreground">Загрузка...</span>
            )}
            {state === "solving" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-primary/80 font-medium">
                  Проверка на бота
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {elapsed}
                </span>
                <span className="inline-flex gap-0.5">
                  <span className="h-1 w-1 rounded-full bg-primary/60 animate-[bounce_1.4s_ease-in-out_infinite]" />
                  <span className="h-1 w-1 rounded-full bg-primary/60 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
                  <span className="h-1 w-1 rounded-full bg-primary/60 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
                </span>
              </div>
            )}
            {state === "done" && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                Пройдено
              </p>
            )}
            {state === "error" && (
              <div className="flex flex-col gap-0.5">
                <p className="text-sm text-destructive font-medium">
                  Ошибка проверки
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {errorMsg}
                </p>
              </div>
            )}
          </div>

          {/* ── Action ── */}
          {state === "error" && (
            <button
              type="button"
              onClick={() => {
                solved.current = false;
                doSolve();
              }}
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-destructive/80 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Повторить
            </button>
          )}
        </div>
      </div>

      {/* Tailwind keyframes for progress bar */}
      <style>{`
        @keyframes progress {
          0% { width: 0%; margin-left: 0; }
          50% { width: 70%; margin-left: 30%; }
          100% { width: 0%; margin-left: 100%; }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}
