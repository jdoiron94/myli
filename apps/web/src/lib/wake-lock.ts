import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Whether the screen is kept on: still asking, on, or not, as the browser can't or wouldn't. */
export type WakeLockState = 'asking' | 'on' | 'unsupported' | 'refused';

/**
 * Keeps the screen on while the component that calls it is mounted, with the Screen Wake Lock API,
 * and lets go when it unmounts. Browsers let go by themselves while the page is hidden, so it asks
 * again whenever the page shows. The API exists only in a secure context: HTTPS, or localhost.
 */
export function useScreenWakeLock() {
  const supported = 'wakeLock' in navigator;
  const state = ref<WakeLockState>(supported ? 'asking' : 'unsupported');
  let lock: WakeLockSentinel | undefined;
  let mounted = false;

  async function acquire() {
    if (!supported || document.visibilityState !== 'visible') return;
    try {
      const granted = await navigator.wakeLock.request('screen');
      // Granted after the page was left, or while another is held, as when the page shows again
      // before the browser let go: nothing would ever let go of this one.
      if (!mounted || lock) {
        void granted.release();
        return;
      }
      lock = granted;
      state.value = 'on';
      granted.addEventListener('release', () => {
        if (lock === granted) lock = undefined;
      });
    } catch {
      // Refused, as in battery saver mode, or when the page isn't visible after all.
      if (mounted) state.value = 'refused';
    }
  }

  function onVisibilityChange() {
    void acquire();
  }

  onMounted(() => {
    mounted = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    void acquire();
  });

  onBeforeUnmount(() => {
    mounted = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    const held = lock;
    lock = undefined;
    void held?.release();
  });

  return state;
}
