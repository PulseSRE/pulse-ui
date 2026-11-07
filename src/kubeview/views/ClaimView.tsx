/**
 * ClaimView — handles shared view links. Clones the view to the
 * current user's account and redirects to the new view.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useCustomViewStore } from '../store/customViewStore';
import { NotFound } from '../components/primitives/NotFound';
import { LoadError } from '../components/primitives/LoadError';
import { inAppClick } from '../components/primitives/PageHeader';
import { readErrorStatus } from '../engine/readError';

/** Why the link itself is unusable, by the claim endpoint's status. Anything else is a failure to retry. */
const DEAD_LINK: Record<number, string> = {
  400: 'This is not a valid share link. Check that it was copied whole, or ask its owner to share it again.',
  404: 'The view this link shared no longer exists; its owner may have deleted it.',
  410: 'This share link has expired. Ask the view\'s owner for a new one.',
};

export default function ClaimView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!shareToken) {
      setError({ status: 400 });
      return;
    }

    let live = true;
    setError(null);
    useCustomViewStore.getState().claimSharedView(shareToken).then((newId) => {
      if (live) navigate(`/custom/${newId}`, { replace: true });
    }).catch((err: unknown) => {
      // A rejection used to leave the spinner running forever.
      if (live) setError(err ?? new Error('Unknown error'));
    });
    return () => { live = false; };
  }, [shareToken, navigate, attempt]);

  const toViews = { label: 'Go to Views', href: '/views', onClick: () => navigate('/views') };

  if (error) {
    const status = readErrorStatus(error);
    const dead = status !== undefined ? DEAD_LINK[status] : undefined;
    if (dead) {
      return (
        <div className="h-full bg-slate-950">
          <NotFound headingLevel={1} what="Shared view" where="in the views shared on this Pulse" reason={dead} actions={[toViews]} />
        </div>
      );
    }
    // 403, 5xx, network: the link may be fine; say what failed and offer Retry.
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950 p-6 gap-3">
        <h1 className="sr-only">Shared view</h1>
        <LoadError className="max-w-md w-full" title="The dashboard could not be cloned" error={error} onRetry={() => setAttempt((n) => n + 1)} />
        <a href={toViews.href} onClick={inAppClick(toViews.onClick)} className="text-sm text-blue-400 hover:text-blue-300">
          {toViews.label}
        </a>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-950 gap-4" role="status">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" aria-hidden="true" />
      <p className="text-slate-400">Cloning dashboard to your account...</p>
    </div>
  );
}
