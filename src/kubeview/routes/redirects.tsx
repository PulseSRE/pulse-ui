import { Route, Navigate } from 'react-router-dom';

export function redirectRoutes() {
  return (
    <>
      <Route path="software" element={<Navigate to="/create" replace />} />
      <Route path="operators" element={<Navigate to="/admin" replace />} />
      <Route path="operatorhub" element={<Navigate to="/create/v1~pods?tab=operators" replace />} />
      <Route path="dashboard" element={<Navigate to="/welcome" replace />} />
      <Route path="morning-report" element={<Navigate to="/incidents" replace />} />
      <Route path="troubleshoot" element={<Navigate to="/incidents" replace />} />
      <Route path="config-compare" element={<Navigate to="/admin" replace />} />
      <Route path="timeline" element={<Navigate to="/incidents?tab=history" replace />} />
      <Route path="monitor" element={<Navigate to="/incidents" replace />} />
      {/* /users and /access-control redirects are in domainRoutes.tsx */}
    </>
  );
}
