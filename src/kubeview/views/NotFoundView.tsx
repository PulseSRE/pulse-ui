import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, Home } from 'lucide-react';
import { EmptyState } from '../components/primitives/EmptyState';
import { Button } from '../components/primitives/Button';

/**
 * Shown for any path the router does not mount. It used to redirect silently
 * to /pulse, which made every broken link look like it worked.
 */
export default function NotFoundView() {
  const location = useLocation();
  const navigate = useNavigate();
  const badPath = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    console.warn(`[routes] No page for ${badPath}`);
  }, [badPath]);

  return (
    <div className="flex h-full items-center justify-center" data-testid="not-found">
      <div className="flex flex-col items-center">
        <EmptyState
          icon={<Compass className="h-8 w-8" />}
          title="Page not found"
          description="Pulse has no page at this address. The link that brought you here may be out of date."
        />
        <code className="-mt-8 mb-6 max-w-xl break-all rounded-sm bg-slate-900 px-3 py-1.5 text-xs text-slate-300">
          {badPath}
        </code>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button onClick={() => navigate('/pulse')}>
            <Home className="h-4 w-4" />
            Go to Pulse
          </Button>
        </div>
      </div>
    </div>
  );
}
