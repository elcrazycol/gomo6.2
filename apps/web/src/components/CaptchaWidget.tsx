/**
 * CaptchaWidget — invisible CAPTCHA + HoneyPot for bot protection.
 *
 * HoneyPot: a hidden form field invisible to humans but tempting to bots.
 * If filled, the server silently rejects the submission.
 *
 * CAPTCHA: built-in Proof-of-Work (same principle as mCaptcha).
 * Client solves a SHA-256 puzzle; server verifies.
 *
 * The widget is invisible to the user — the PoW computation runs
 * automatically in the background before form submission.
 */
import { useState, useEffect, useCallback, useRef } from "react";
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
    honeypotValue: string; // always empty string for real users
  }) => void;
  onError: (error: string) => void;
}

export function CaptchaWidget({ onReady, onError }: CaptchaWidgetProps) {
  const [config, setConfig] = useState<CaptchaConfig | null>(null);
  const [solving, setSolving] = useState(false);
  const solved = useRef(false);
  const resultRef = useRef({
    challengeId: "",
    solution: "",
    captchaToken: "",
    honeypotValue: "",
  });

  const doSolve = useCallback(async () => {
    if (solved.current) {
      onReady(resultRef.current);
      return;
    }

    setSolving(true);
    try {
      // For external mCaptcha: the widget would handle this
      // For built-in PoW: fetch challenge, solve, return
      const challenge = await fetchChallenge();
      const solution = await solveChallenge(challenge);

      resultRef.current = {
        challengeId: challenge.challenge_id,
        solution,
        captchaToken: "",
        honeypotValue: "", // Always empty — honeyPot is server-side
      };
      solved.current = true;
      setSolving(false);
      onReady(resultRef.current);
    } catch (err) {
      setSolving(false);
      onError((err as Error).message || "CAPTCHA verification failed");
    }
  }, [onReady, onError]);

  useEffect(() => {
    fetchCaptchaConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.type === "pow" && cfg.enabled) {
          // Auto-start solving for built-in PoW
          doSolve();
        } else if (cfg.type === "mcaptcha") {
          // External mCaptcha — widget handles its own lifecycle
          onReady(resultRef.current);
        } else {
          // CAPTCHA disabled — pass through
          onReady(resultRef.current);
        }
      })
      .catch(() => {
        // If config fetch fails, pass through without CAPTCHA
        onReady(resultRef.current);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // HoneyPot: hidden field that bots fill, humans don't
  // Styled to be invisible to humans but present in DOM
  return (
    <>
      {/* HoneyPot field — hidden from humans, tempting for bots */}
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

      {/* Subtle loading indicator while PoW is solving */}
      {solving && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Защита от ботов...</span>
        </div>
      )}
    </>
  );
}
