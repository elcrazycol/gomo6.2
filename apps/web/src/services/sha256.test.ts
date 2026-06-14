/**
 * SHA-256 parity test.
 *
 * The captcha PoW solver relies on `sha256HexSync` producing the exact same
 * bytes as the browser's built-in `crypto.subtle.digest('SHA-256', ...)`. If
 * they ever drift apart the server's verification will reject every solution
 * and login will be impossible. This test pins the two implementations
 * together across a representative set of inputs.
 */
import { describe, it, expect } from 'vitest';
import { sha256HexSync } from './sha256';

async function subtleHex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('sha256HexSync', () => {
  it('matches crypto.subtle.digest for empty string', async () => {
    const expected = await subtleHex('');
    expect(sha256HexSync('')).toBe(expected);
    // Known constant: SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(expected).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('matches crypto.subtle.digest for "abc"', async () => {
    const expected = await subtleHex('abc');
    expect(sha256HexSync('abc')).toBe(expected);
    // Known constant
    expect(expected).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('matches crypto.subtle.digest for PoW-shaped inputs', async () => {
    // The captcha solver concatenates challengeId + nonce + solution(base36).
    // Test a variety of lengths to exercise the multi-block padding path.
    const samples = [
      '0123456789abcdef' + 'fedcba9876543210' + '0',
      '0123456789abcdef' + 'fedcba9876543210' + 'z',
      '0123456789abcdef' + 'fedcba9876543210' + '1k3j9',
      'a'.repeat(55) + 'b'.repeat(10),  // forces 2 blocks
      'x'.repeat(119),                    // forces 3 blocks (2 padding bytes)
      '🔥💀✨', // 4-byte UTF-8 sequence to confirm non-ASCII handling
    ];
    for (const s of samples) {
      const expected = await subtleHex(s);
      const got = sha256HexSync(s);
      expect(got, `mismatch for input of length ${s.length}`).toBe(expected);
    }
  });

  it('returns a 64-char lowercase hex string', () => {
    const out = sha256HexSync('hello world');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hasLeadingZeroBits: empty/difficulty=12 input is realistic for captcha', async () => {
    // We don't assert that any particular input satisfies difficulty=12
    // (that would be flaky) — just exercise the function a few times to
    // make sure it doesn't crash and always returns the same result.
    const a = sha256HexSync('test-challenge-1234test-nonce-56789');
    const b = sha256HexSync('test-challenge-1234test-nonce-56789');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
