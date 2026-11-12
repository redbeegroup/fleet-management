import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { session } from './lib/api';
import { DashboardPage } from './pages/DashboardPage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { DriverFormPage } from './pages/DriverFormPage';
import { DriversPage } from './pages/DriversPage';
import { AttendancePage } from './pages/AttendancePage';
import { DispatchBoardPage } from './pages/DispatchBoardPage';
import { EventsPage } from './pages/EventsPage';
import { FuelPage } from './pages/FuelPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { WorkOrderPage } from './pages/WorkOrderPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TripDetailPage } from './pages/TripDetailPage';
import { TripFormPage } from './pages/TripFormPage';
import { TripsPage } from './pages/TripsPage';
import { LoginPage } from './pages/LoginPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { VehicleFormPage } from './pages/VehicleFormPage';
import { VehiclesPage } from './pages/VehiclesPage';

// MapLibre is large; load it only when the map is opened.
const LiveMapPage = lazy(() => import('./pages/LiveMapPage').then((m) => ({ default: m.LiveMapPage })));
const TrackPage = lazy(() => import('./pages/TrackPage').then((m) => ({ default: m.TrackPage })));
const GeofencesPage = lazy(() => import('./pages/GeofencesPage').then((m) => ({ default: m.GeofencesPage })));

const withMap = (el: JSX.Element) => <Suspense fallback={<p className="muted">Loading map…</p>}>{el}</Suspense>;

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
        <Route path="map" element={withMap(<LiveMapPage />)} />
        <Route path="geofences" element={withMap(<GeofencesPage />)} />
        <Route path="events" element={<EventsPage />} />
        <Route path="dispatch" element={<DispatchBoardPage />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="trips/new" element={<TripFormPage />} />
        <Route path="trips/:id" element={<TripDetailPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="fuel" element={<FuelPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="maintenance/work-orders/:id" element={<WorkOrderPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="vehicles/new" element={<VehicleFormPage />} />
        <Route path="vehicles/:id" element={<VehicleDetailPage />} />
        <Route path="vehicles/:id/edit" element={<VehicleFormPage />} />
        <Route path="vehicles/:id/track" element={withMap(<TrackPage />)} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="drivers/new" element={<DriverFormPage />} />
        <Route path="drivers/:id" element={<DriverDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
