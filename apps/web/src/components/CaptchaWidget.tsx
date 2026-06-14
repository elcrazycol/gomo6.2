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
  loadMCaptchaScript,
  CaptchaTimeoutError,
  type CaptchaConfig,
  type MCaptchaInstance,
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
  const [state, setState] = useState<WidgetState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [autoRetryIn, setAutoRetryIn] = useState<number | null>(null);
  const autoRetryInRef = useRef<number | null>(null);
  const activeWorkerRef = useRef<Worker | null>(null);
  const solved = useRef(false);
  const resultRef = useRef({
    challengeId: "",
    solution: "",
    captchaToken: "",
    honeypotValue: "",
  });

  // Real mCaptcha widget branch.
  //
  // mCaptcha is a self-hosted PoW CAPTCHA (Rust server) that exposes a global
  // `mCaptcha` constructor. The constructor mounts an iframe inside `el`,
  // hands out a PoW challenge, verifies the solution against its own server,
  // and calls `onSuccess(token)` once the user passes.
  //
  // We only render this branch when the server told us cfg.type === "mcaptcha"
  // and provided a site_key + widget_url. Token is forwarded to the parent
  // form via onReady({ captchaToken }); the Go backend then verifies it via
  // MCAPTCHA_VERIFY_URL (see captcha.go).
  const [mcaptcha, setMcaptcha] = useState<{ siteKey: string; widgetUrl: string } | null>(null);
  const mcaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const mcaptchaInstanceRef = useRef<MCaptchaInstance | null>(null);

  useEffect(() => {
    if (!mcaptcha) return;
    if (!mcaptchaContainerRef.current) return;
    const container = mcaptchaContainerRef.current;

    let cancelled = false;
    setState("solving");
    setErrorMsg("");

    loadMCaptchaScript(mcaptcha.widgetUrl)
      .then((ctor) => {
        if (cancelled) return;
        if (!mcaptchaContainerRef.current) return;
        if (typeof ctor !== "function") {
          throw new Error("mCaptcha constructor is not available");
        }
        const instance = ctor({
          el: container,
          siteKey: mcaptcha.siteKey,
          widgetUrl: mcaptcha.widgetUrl,
          onSuccess: (token: string) => {
            if (cancelled) return;
            resultRef.current = {
              challengeId: "",
              solution: "",
              captchaToken: token,
              honeypotValue: "",
            };
            solved.current = true;
            setState("done");
            setErrorMsg("");
            onReadyRef.current(resultRef.current);
          },
          onError: (err: unknown) => {
            if (cancelled) return;
            const msg = err instanceof Error ? err.message : "Ошибка mCaptcha";
            setState("error");
            setErrorMsg(msg);
            onErrorRef.current(msg);
          },
        });
        mcaptchaInstanceRef.current = instance ?? null;
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Не удалось загрузить mCaptcha";
        setState("error");
        setErrorMsg(msg);
        onErrorRef.current(msg);
      });

    return () => {
      cancelled = true;
      const inst = mcaptchaInstanceRef.current;
      mcaptchaInstanceRef.current = null;
      if (inst) {
        try { inst.destroy?.(); } catch { /* noop */ }
        try { inst.reset?.(); } catch { /* noop */ }
      }
      // The mCaptcha widget injects child nodes into the container; clear
      // them so a remount starts clean.
      while (container.firstChild) container.removeChild(container.firstChild);
    };
    // onReady/onError are intentionally read via refs (not deps) so parent
    // re-renders that produce new function identities don't tear down an
    // in-progress PoW challenge. The latest callback is always used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcaptcha]);

  // Refs for the latest onReady/onError so the mcaptcha effect (which
  // intentionally omits them from deps) can call through to the parent
  // without re-running on every parent render.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const doSolve = useCallback(async () => {
    if (solved.current) {
      setState("done");
      onReady(resultRef.current);
      return;
    }

    // Terminate any in-flight worker from a previous attempt so we don't burn
    // CPU on stale work.
    if (activeWorkerRef.current) {
      try { activeWorkerRef.current.terminate(); } catch { /* noop */ }
      activeWorkerRef.current = null;
    }

    setState("solving");
    setErrorMsg("");
    setAutoRetryIn(null);
    try {
      // After a timeout (retryNonce > 0) ask the server for a slightly
      // easier challenge. This is the safety net for the slowest devices.
      const maxDifficulty = retryNonce > 0 ? Math.max(8, 12 - Math.min(retryNonce, 4) * 1) : undefined;
      const challenge = await fetchChallenge(maxDifficulty);
      const solution = await solveChallenge(
        challenge,
        (info) => setElapsed(`${info.elapsedSec.toFixed(1)}с`),
        (w) => { activeWorkerRef.current = w; }
      );

      resultRef.current = {
        challengeId: challenge.challenge_id,
        solution,
        captchaToken: "",
        honeypotValue: "",
      };
      solved.current = true;
      setState("done");
      setAutoRetryIn(null);
      onReady(resultRef.current);
    } catch (err) {
      const isTimeout = err instanceof CaptchaTimeoutError;
      const msg = (err as Error).message || "Ошибка проверки";
      setState("error");
      setErrorMsg(msg);
      onError(msg);

      // Auto-retry once on a fresh challenge after a short delay. The widget
      // does the next fetch via the "Повторить" button too, but on slow
      // devices a single auto-attempt at lower difficulty usually clears it.
      //
      // Guard: only schedule the countdown if one isn't already running.
      // Without this, a device that times out repeatedly would get stuck in
      // an infinite auto-retry loop because each failed attempt re-arms the
      // countdown.
      if (isTimeout && autoRetryInRef.current === null) {
        setAutoRetryIn(2);
      }
    }
  }, [onReady, onError, retryNonce]);

  // Auto-retry countdown — gives the user a chance to read the error first,
  // then transparently re-fetches a (slightly easier) challenge. Aborts if
  // state is no longer "error" (e.g. user manually retried and it succeeded).
  useEffect(() => {
    if (autoRetryIn === null) {
      autoRetryInRef.current = null;
      return;
    }
    if (state !== "error") {
      setAutoRetryIn(null);
      return;
    }
    autoRetryInRef.current = autoRetryIn;
    if (autoRetryIn <= 0) {
      setAutoRetryIn(null);
      setRetryNonce((n) => n + 1);
      return;
    }
    const t = window.setTimeout(() => setAutoRetryIn((v) => (v === null ? null : v - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [autoRetryIn, state]);

  // Whenever the auto-retry fires (retryNonce bumps), kick off a new solve.
  useEffect(() => {
    if (retryNonce === 0) return;
    if (state !== "error") return;
    doSolve();
  }, [retryNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCaptchaConfig()
      .then((cfg: CaptchaConfig) => {
        if (cfg.type === "pow" && cfg.enabled) {
          doSolve();
        } else if (cfg.type === "mcaptcha") {
          if (cfg.site_key && cfg.widget_url) {
            // Trigger the mCaptcha-mount effect above.
            setMcaptcha({ siteKey: cfg.site_key, widgetUrl: cfg.widget_url });
          } else {
            // Misconfigured: operator set MCAPTCHA_SITE_KEY but not the URL,
            // or the backend dropped the field. Don't silently pass through.
            setState("error");
            const msg = "mCaptcha настроен на сервере, но widget_url не передан";
            setErrorMsg(msg);
            onError(msg);
          }
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

      {/*
        mCaptcha container — only mounted when the server told us to use the
        external widget. The mCaptcha constructor injects an iframe here; we
        do not render any UI ourselves so it can style itself.
      */}
      {mcaptcha && (
        <div
          key={retryNonce}
          ref={mcaptchaContainerRef}
          data-mcaptcha-widget
          className="mcaptcha-container"
        />
      )}

      {/*
        Status strip.
        - For the PoW branch this is the only captcha UI, so we always show it.
        - For the mCaptcha branch the widget has its own UI, so we only show
          the strip for the terminal states (done / error) and hide it during
          the in-progress states (idle / solving) so the user isn't distracted.
      */}
      {(!mcaptcha || state === "done" || state === "error") && (
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
            {state === "solving" && !mcaptcha && (
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
            <div className="flex-shrink-0 flex items-center gap-2">
              {autoRetryIn !== null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  авто · {autoRetryIn}с
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  solved.current = false;
                  // Bump retryNonce — the container div's `key` prop is bound
                  // to it, so React unmounts the old mCaptcha iframe and
                  // mounts a fresh one atomically. The mcaptcha useEffect's
                  // cleanup runs once during this transition, calling
                  // destroy() on the stale instance.
                  setRetryNonce((n) => n + 1);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-destructive/80 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Повторить
              </button>
            </div>
          )}
        </div>
      </div>
      )}

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
        .mcaptcha-container {
          margin-top: 0.5rem;
        }
      `}</style>
    </>
  );
}
