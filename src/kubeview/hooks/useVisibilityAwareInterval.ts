import { useEffect, useRef } from 'react';

/**
 * Like setInterval but pauses when the tab is hidden.
 * Resumes immediately when tab becomes visible again.
 */
export function useVisibilityAwareInterval(callback: () => void, delayMs: number) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (intervalId) return;
      intervalId = setInterval(() => savedCallback.current(), delayMs);
    }

    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        savedCallback.current(); // run immediately on tab focus
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [delayMs]);
}
