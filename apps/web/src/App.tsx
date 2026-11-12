import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { session } from './lib/api';
import { DashboardPage } from './pages/DashboardPage';
import { DriversPage } from './pages/DriversPage';
import { LoginPage } from './pages/LoginPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { VehicleFormPage } from './pages/VehicleFormPage';
import { VehiclesPage } from './pages/VehiclesPage';

// MapLibre is large; load it only when the map is opened.
const LiveMapPage = lazy(() => import('./pages/LiveMapPage').then((m) => ({ default: m.LiveMapPage })));

function RequireAuth({ children }: { children: JSX.Element }) {
  return session.user() ? children : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="map"
          element={
            <Suspense fallback={<p className="muted">Loading map…</p>}>
              <LiveMapPage />
            </Suspense>
          }
        />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="vehicles/new" element={<VehicleFormPage />} />
        <Route path="vehicles/:id" element={<VehicleDetailPage />} />
        <Route path="drivers" element={<DriversPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
