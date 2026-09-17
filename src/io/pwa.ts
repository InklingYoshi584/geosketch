/**
 * PWA shell: registers the service worker emitted from `public/sw.js`.
 *
 * Production only — a live service worker in `vite dev` serves stale modules
 * and fights HMR. Registration failures are logged at most: offline caching is
 * a progressive enhancement, never a reason to fail app startup.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const url = `${import.meta.env.BASE_URL}sw.js`;
  const start = async (): Promise<void> => {
    try {
      await navigator.serviceWorker.register(url);
    } catch (err) {
      console.warn(`[geosketch] service worker registration failed (${url})`, err);
    }
  };
  void start();
}
