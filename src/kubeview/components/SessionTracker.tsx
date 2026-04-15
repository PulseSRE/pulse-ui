import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { startSessionTracker, trackPageView, trackPageLeave } from '../engine/sessionTracker';

/**
 * Invisible component that tracks page views and time-on-page.
 * Mount once in Shell.tsx.
 */
export function SessionTracker() {
  const location = useLocation();
  const prevPage = useRef<string>('');
  const pageEnterTime = useRef<number>(Date.now());

  // Start the flush timer on mount
  useEffect(() => {
    startSessionTracker();
  }, []);

  // Track route changes
  useEffect(() => {
    const currentPage = location.pathname;

    // Track leaving the previous page
    if (prevPage.current && prevPage.current !== currentPage) {
      const duration = Date.now() - pageEnterTime.current;
      trackPageLeave(prevPage.current, duration);
    }

    // Track viewing the new page
    trackPageView(currentPage, prevPage.current || undefined);
    prevPage.current = currentPage;
    pageEnterTime.current = Date.now();
  }, [location.pathname]);

  return null;
}
