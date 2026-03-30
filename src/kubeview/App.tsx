import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './components/Shell';
import PulseView from './views/PulseView';
import WelcomeView from './views/WelcomeView';
import CustomView from './views/CustomView';
import { resourceRoutes, domainRoutes, redirectRoutes } from './routes';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function OpenshiftPulseApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />}>
            {/* Home */}
            <Route index element={<Navigate to="/welcome" replace />} />
            <Route path="welcome" element={<WelcomeView />} />
            <Route path="pulse" element={<PulseView />} />

            {/* Resource routes (list, detail, yaml, logs, metrics, create, deps, investigate) */}
            {resourceRoutes()}

            {/* Custom views (AI-generated dashboards) */}
            <Route path="custom/:viewId" element={<CustomView />} />

            {/* Domain views (workloads, networking, compute, storage, etc.) */}
            {domainRoutes()}

            {/* Legacy redirects */}
            {redirectRoutes()}

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/pulse" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
