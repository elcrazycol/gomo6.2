/**
 * Proof-of-Work CAPTCHA solver.
 *
 * Principle (same as mCaptcha):
 *   1. Server generates a challenge: { challenge_id, nonce, difficulty }
 *   2. Client finds a solution string such that:
 *      SHA-256(challenge_id + nonce + solution) has at least `difficulty` leading zero bits
 *   3. Client sends { challenge_id, solution } to server for verification
 *
 * Complexity: difficulty=16 means ~65k iterations on average (~100ms on modern hardware).
 * Bots doing this at scale would incur significant CPU cost.
 *
 * Uses Web Workers to keep the UI responsive during computation.
 */

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

// Fetch a new PoW challenge from server
export async function fetchChallenge(): Promise<PowChallenge> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const res = await fetch(`${baseUrl}/api/v1/auth/captcha-challenge`);
  if (!res.ok) {
    throw new Error('Failed to fetch CAPTCHA challenge');
  }
  const json = await res.json();
  return json.data as PowChallenge;
}

// Solve the PoW challenge using Web Worker
export function solveChallenge(challenge: PowChallenge): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const workerCode = `
        // Web Worker: find solution for PoW challenge
        function sha256(input) {
          // Use SubtleCrypto for SHA-256
          const encoder = new TextEncoder();
          const data = encoder.encode(input);
          return crypto.subtle.digest('SHA-256', data);
        }

        function hasLeadingZeroBits(hashBuffer, n) {
          const bytes = new Uint8Array(hashBuffer);
          const fullBytes = Math.floor(n / 8);
          const remainingBits = n % 8;

          for (let i = 0; i < fullBytes; i++) {
            if (bytes[i] !== 0) return false;
          }

          if (remainingBits > 0) {
            const mask = 0xFF << (8 - remainingBits);
            if ((bytes[fullBytes] & mask) !== 0) return false;
          }

          return true;
        }

        async function solve(challengeId, nonce, difficulty) {
          let solution = 0n;
          const batchSize = 10000;
          const startTime = performance.now();
          const deadline = startTime + 15000; // 15 second timeout

          while (performance.now() < deadline) {
            // Process in batches, yielding to check for messages
            for (let i = 0; i < batchSize; i++) {
              const input = challengeId + nonce + solution.toString(36);
              const hash = await sha256(input);
              if (hasLeadingZeroBits(hash, difficulty)) {
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
                self.postMessage({ type: 'solved', solution: solution.toString(36), elapsed });
                return;
              }
              solution++;
            }
            // Report progress
            if (solution % 50000n === 0n) {
              self.postMessage({ type: 'progress', iterations: Number(solution) });
            }
          }

          self.postMessage({ type: 'timeout' });
        }

        self.onmessage = function(e) {
          const { challengeId, nonce, difficulty } = e.data;
          solve(challengeId, nonce, difficulty);
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'solved') {
          worker.terminate();
          resolve(msg.solution);
        } else if (msg.type === 'timeout') {
          worker.terminate();
          reject(new Error('Proof-of-work timed out. Please try again.'));
        }
      };

      worker.onerror = () => {
        worker.terminate();
        reject(new Error('Proof-of-work solver failed'));
      };

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
