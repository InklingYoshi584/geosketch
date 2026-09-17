import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './pwa';

/**
 * The registration contract: one URL, built from the deploy base, and nothing
 * at all outside production or where service workers are missing. No flushes
 * are needed — an async function body runs synchronously up to its first
 * suspension, so the register call (or a synchronous throw) is observable
 * immediately.
 */
describe('registerServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('registers sw.js relative to the deploy base in production', () => {
    const register = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubEnv('PROD', true);
    vi.stubEnv('BASE_URL', '/geosketch/');

    registerServiceWorker();

    expect(register).toHaveBeenCalledExactlyOnceWith('/geosketch/sw.js');
  });

  it('stays out of the way during development', () => {
    const register = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { serviceWorker: { register } });

    registerServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it('is a silent no-op where service workers do not exist', () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('navigator', {});

    expect(() => registerServiceWorker()).not.toThrow();
  });

  it('swallows a registration failure instead of breaking startup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('PROD', true);
    vi.stubGlobal('navigator', {
      // A rejected registration takes the same catch clause this throw does.
      serviceWorker: {
        register: () => {
          throw new Error('offline');
        },
      },
    });

    expect(() => registerServiceWorker()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
