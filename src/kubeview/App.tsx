import { useEffect, useMemo } from 'react';
import { useFleetStore } from './store/fleetStore';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './components/Shell';
import PulseView from './views/PulseView';

import CustomView from './views/CustomView';
import ClaimView from './views/ClaimView';
import { resourceRoutes, domainRoutes } from './routes';

function createQueryClient(clusterId: string) {
  return new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
      meta: { clusterId },
    },
  },
  });
}

function DefaultRedirect() {
  return <Navigate to="/pulse" replace />;
}

export default function OpenshiftPulseApp() {
  const activeClusterId = useFleetStore((s) => s.activeClusterId);
  // Domain/detail queries historically omit cluster IDs. Separate cache and
  // view lifetimes ensure neither cached objects nor pending dialogs cross a
  // switch, including identical resource paths on different clusters.
  const queryClient = useMemo(() => createQueryClient(activeClusterId), [activeClusterId]);
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return (
    <QueryClientProvider key={activeClusterId} client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />}>
            {/* Home */}
            <Route index element={<DefaultRedirect />} />
            <Route path="pulse" element={<PulseView />} />

            {/* Resource routes (list, detail, yaml, logs, metrics, create, deps, investigate) */}
            {resourceRoutes()}

            {/* Custom views */}
            <Route path="custom/:viewId" element={<CustomView />} />
            <Route path="share/:shareToken" element={<ClaimView />} />

            {/* Domain views (workloads, networking, compute, storage, etc.) */}
            {domainRoutes()}

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/pulse" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
