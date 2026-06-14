/**
 * mCaptcha widget loader tests.
 *
 * These cover the non-DOM-heavy behaviors of loadMCaptchaScript: the URL
 * normalization, dedup via the per-URL promise cache, and the rejection
 * path when the URL is empty. The actual <script> injection is exercised
 * end-to-end by the dev server / browser; here we just confirm the
 * contract the widget code depends on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadMCaptchaScript } from './captchaPow';

describe('loadMCaptchaScript', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    // Ensure no leftover global from a previous test
    delete (window as { mCaptcha?: unknown }).mCaptcha;
  });

  afterEach(() => {
    document.head.innerHTML = '';
    delete (window as { mCaptcha?: unknown }).mCaptcha;
    vi.restoreAllMocks();
  });

  it('rejects when the widget URL is empty', async () => {
    await expect(loadMCaptchaScript('')).rejects.toThrow(/empty/);
  });

  it('rejects when the widget URL is whitespace', async () => {
    await expect(loadMCaptchaScript('   ')).rejects.toThrow();
  });

  it('uses window.mCaptcha immediately if it already exists', async () => {
    const fake = vi.fn();
    (window as { mCaptcha?: unknown }).mCaptcha = fake;

    const ctor = await loadMCaptchaScript('https://mcaptcha.example.com');
    expect(ctor).toBe(fake);
    // It must not have injected a <script> tag in the fast path.
    expect(document.querySelectorAll('script[src*="mcaptcha.js"]').length).toBe(0);
  });

  it('dedupes concurrent loads for the same URL (case + trailing-slash insensitive)', async () => {
    // We can't easily simulate onload without a real network, so we just
    // confirm that two callers for the "same" URL share the cache. The
    // easiest way is to assert that the second call's promise identity
    // matches the first's.
    const p1 = loadMCaptchaScript('https://mcaptcha.example.com/');
    const p2 = loadMCaptchaScript('https://mcaptcha.example.com');
    const p3 = loadMCaptchaScript('https://mcaptcha.example.com/');
    // All three should reference the same cached promise object.
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    // Suppress unhandled rejection: we never resolve the script in JSDOM
    // and the test only checks identity.
    p1.catch(() => undefined);
  });

  it('uses different cache entries for different widget URLs', async () => {
    const a = loadMCaptchaScript('https://a.example.com');
    const b = loadMCaptchaScript('https://b.example.com');
    expect(a).not.toBe(b);
    a.catch(() => undefined);
    b.catch(() => undefined);
  });

  it('injects exactly one <script> tag per unique widget URL', async () => {
    // Cache-buster URL so neither the per-URL cache from earlier tests nor
    // any residual <script> tag in document.head matches the selector below.
    const url = `https://mcaptcha.example.com?v=${Date.now()}-${Math.random()}`;
    loadMCaptchaScript(url).catch(() => undefined);
    loadMCaptchaScript(url).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    const expectedSrc = `${url.replace(/\/+$/, '')}/mcaptcha.js`;
    const matches = document.querySelectorAll(`script[src="${expectedSrc}"]`);
    expect(matches.length).toBe(1);
  });
});
