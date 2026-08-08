import { describe, it, expect, afterEach } from 'vitest';
import { installObjectHasOwnPolyfill } from './polyfills';

// Object.hasOwn is ES2022, which is absent from tsconfig's ES2020 lib —
// access it through a cast so the test still typechecks.
type HasOwnFn = (object: object, key: PropertyKey) => boolean;
const getHasOwn = () => (Object as { hasOwn?: HasOwnFn }).hasOwn;

describe('Object.hasOwn polyfill', () => {
  const nativeHasOwn = getHasOwn();

  afterEach(() => {
    // Restore the native implementation so other tests are unaffected.
    if (nativeHasOwn) {
      Object.defineProperty(Object, 'hasOwn', {
        value: nativeHasOwn,
        writable: true,
        configurable: true,
      });
    }
  });

  it('is a no-op when the native API exists', () => {
    installObjectHasOwnPolyfill();
    expect(getHasOwn()).toBe(nativeHasOwn);
  });

  it('installs a working polyfill when Object.hasOwn is missing', () => {
    // Simulate an old browser/WebView.
    delete (Object as { hasOwn?: HasOwnFn }).hasOwn;
    expect(getHasOwn()).toBeUndefined();

    installObjectHasOwnPolyfill();

    expect(typeof getHasOwn()).toBe('function');
    const hasOwn = getHasOwn()!;
    const obj = Object.create({ inherited: 1 });
    obj.own = 2;
    expect(hasOwn(obj, 'own')).toBe(true);
    expect(hasOwn(obj, 'inherited')).toBe(false);
    expect(hasOwn(obj, 'missing')).toBe(false);
    // Matches native behaviour: null/undefined receiver throws a TypeError.
    expect(() => hasOwn(null as unknown as object, 'own')).toThrow();
  });
});
