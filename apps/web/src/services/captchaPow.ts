/**
 * Proof-of-Work CAPTCHA solver.
 *
 * Principle (same as mCaptcha):
 *   1. Server generates a challenge: { challenge_id, nonce, difficulty }
 *   2. Client finds a solution string such that:
 *      SHA-256(challenge_id + nonce + solution) has at least `difficulty` leading zero bits
 *   3. Client sends { challenge_id, solution } to server for verification
 *
 * Why a synchronous SHA-256 (and not `crypto.subtle.digest`)?
 *   `crypto.subtle.digest` is async — it returns a Promise. In a tight loop on a
 *   weak device (low-end Android, old iPhone, low-power laptop) the microtask
 *   overhead per iteration dominates: we measured 50–100 hashes/sec vs 50–100k/sec
 *   with a sync JS implementation. With difficulty=16 (~65k hashes avg) the async
 *   worker simply could not finish inside its 15s budget on weak hardware, so the
 *   user saw "captcha expired" without ever being able to log in.
 *
 *   Sync SHA-256 in a Web Worker is fine: the worker is off the main thread, so
 *   the UI stays responsive.
 *
 * Complexity: difficulty=12 means ~4k hashes avg (~50ms on a low-end phone, sub-ms on desktop).
 *              difficulty=16 means ~65k hashes avg (~1s on a low-end phone, ~50ms on desktop).
 */

import { sha256HexSync } from "./sha256";

// PoW Challenge from server
export interface PowChallenge {
  challenge_id: string;
  nonce: string;
  difficulty: number;
  expires_at: number;
}

// CAPTCHA config from server
export interface CaptchaConfig {
  type: 'pow' | 'mcaptcha';
  enabled: boolean;
  site_key?: string;
}

// Fetch CAPTCHA config from server
export async function fetchCaptchaConfig(): Promise<CaptchaConfig> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const res = await fetch(`${baseUrl}/api/v1/auth/captcha-config`);
  if (!res.ok) {
    return { type: 'pow', enabled: false };
  }
  const json = await res.json();
  return json.data as CaptchaConfig;
}

// Fetch a new PoW challenge from server.
// `maxDifficulty` lets the client ask the server for a lower-difficulty
// challenge (e.g. after the previous attempt timed out on a weak device).
// The server clamps to its configured minimum, so passing a too-low value
// has no effect.
export async function fetchChallenge(maxDifficulty?: number): Promise<PowChallenge> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const qs = maxDifficulty ? `?max_difficulty=${encodeURIComponent(String(maxDifficulty))}` : '';
  const res = await fetch(`${baseUrl}/api/v1/auth/captcha-challenge${qs}`);
  if (!res.ok) {
    throw new Error('Failed to fetch CAPTCHA challenge');
  }
  const json = await res.json();
  return json.data as PowChallenge;
}

// Custom error class so the UI can distinguish "we couldn't solve it" from
// "the server already forgot this challenge" and react appropriately (auto-retry
// vs. ask the user to refresh).
export class CaptchaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptchaTimeoutError';
  }
}

// Solve the PoW challenge using a Web Worker (synchronous SHA-256 inside the worker).
// The worker code is inlined as a Blob so we don't need a separate file/build step.
//
// `onWorkerCreated` is called once with the active Worker so the caller can
// terminate it on retry (avoiding wasted CPU on stale work).
export function solveChallenge(
  challenge: PowChallenge,
  onProgress?: (info: { iterations: number; elapsedSec: number; hashesPerSec: number }) => void,
  onWorkerCreated?: (w: Worker) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 60 second hard timeout — generous for weak devices (difficulty=12 typically
    // finishes in well under a second, difficulty=16 in ~1–2s on a low-end phone).
    const TIMEOUT_MS = 60_000;

    const workerCode = `
      // Synchronous SHA-256 — see sha256.ts for the implementation. The whole
      // function body is inlined so the worker has zero external dependencies.
      ${sha256HexSync.toString()}

      function hasLeadingZeroBits(hexHash, n) {
        // hexHash is a 64-char lowercase hex string
        const fullHex = n >> 2; // 4 bits per hex char
        const remBits = n & 3;
        for (let i = 0; i < fullHex; i++) {
          if (hexHash.charCodeAt(i * 2) !== 48 || hexHash.charCodeAt(i * 2 + 1) !== 48) {
            return false;
          }
        }
        if (remBits > 0) {
          // remBits=1 → nibble must be 0..7  (binary 0xxx)
          // remBits=2 → nibble must be 0..3  (binary 00xx)
          // remBits=3 → nibble must be 0..1  (binary 0xxx)
          const threshold = [0, 8, 4, 2][remBits];
          const c = hexHash.charCodeAt(fullHex * 2);
          let nibble;
          if (c >= 48 && c <= 57) nibble = c - 48;        // '0'..'9'
          else if (c >= 97 && c <= 102) nibble = c - 87;  // 'a'..'f'
          else nibble = 15; // uppercase or other — treat as non-zero
          if (nibble >= threshold) return false;
        }
        return true;
      }

      function solve(challengeId, nonce, difficulty) {
        let solution = 0;
        const start = performance.now();
        const deadline = start + ${TIMEOUT_MS};
        let lastReport = start;
        const PROGRESS_INTERVAL_MS = 250;

        while (performance.now() < deadline) {
          // Tight loop with synchronous SHA-256 — no microtask overhead.
          const input = challengeId + nonce + solution.toString(36);
          const hash = sha256HexSync(input);
          if (hasLeadingZeroBits(hash, difficulty)) {
            const elapsed = (performance.now() - start) / 1000;
            self.postMessage({ type: 'solved', solution: solution.toString(36), iterations: solution + 1, elapsed });
            return;
          }
          solution++;

          const now = performance.now();
          if (now - lastReport >= PROGRESS_INTERVAL_MS) {
            const elapsed = (now - start) / 1000;
            const rate = elapsed > 0 ? solution / elapsed : 0;
            self.postMessage({ type: 'progress', iterations: solution, elapsed, rate });
            lastReport = now;
          }
        }

        const elapsed = (performance.now() - start) / 1000;
        const rate = elapsed > 0 ? solution / elapsed : 0;
        self.postMessage({ type: 'timeout', iterations: solution, elapsed, rate });
      }

      self.onmessage = function(e) {
        const { challengeId, nonce, difficulty } = e.data;
        try {
          solve(challengeId, nonce, difficulty);
        } catch (err) {
          self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
        }
      };
    `;

    try {
      const blobURL = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
      const worker = new Worker(blobURL);

      const cleanup = () => {
        try { worker.terminate(); } catch { /* noop */ }
        URL.revokeObjectURL(blobURL);
      };

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'solved') {
          cleanup();
          onProgress?.({ iterations: msg.iterations, elapsedSec: msg.elapsed, hashesPerSec: msg.elapsed > 0 ? msg.iterations / msg.elapsed : 0 });
          resolve(msg.solution);
        } else if (msg.type === 'timeout') {
          cleanup();
          onProgress?.({ iterations: msg.iterations, elapsedSec: msg.elapsed, hashesPerSec: msg.elapsed > 0 ? msg.iterations / msg.elapsed : 0 });
          reject(new CaptchaTimeoutError(
            `Проверка не завершилась за ${TIMEOUT_MS / 1000} с (${msg.iterations.toLocaleString()} попыток). ` +
            `Устройство слишком медленное для этой задачи.`
          ));
        } else if (msg.type === 'progress') {
          onProgress?.({ iterations: msg.iterations, elapsedSec: msg.elapsed, hashesPerSec: msg.rate });
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error('Proof-of-work solver failed: ' + msg.message));
        }
      };

      worker.onerror = (e) => {
        cleanup();
        reject(new Error('Proof-of-work solver crashed: ' + (e.message || 'unknown error')));
      };

      onWorkerCreated?.(worker);

      worker.postMessage({
        challengeId: challenge.challenge_id,
        nonce: challenge.nonce,
        difficulty: challenge.difficulty,
      });
    } catch (err) {
      reject(err);
    }
  });
}
