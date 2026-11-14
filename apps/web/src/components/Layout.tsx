import { Permission } from '@fms/shared';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { logout, session } from '../lib/api';
import { NotificationBell } from './NotificationBell';

const sections: {
  title: string;
  items: { to: string; label: string; perm: string; end?: boolean }[];
}[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', perm: Permission.VEHICLE_READ, end: true },
      { to: '/map', label: 'Live map', perm: Permission.TRACKING_READ },
      { to: '/events', label: 'Events', perm: Permission.TRACKING_READ },
      { to: '/reports', label: 'Reports & costs', perm: Permission.COST_READ },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/dispatch', label: 'Dispatch board', perm: Permission.TRIP_WRITE },
      { to: '/trips', label: 'Trips', perm: Permission.TRIP_WRITE },
      { to: '/attendance', label: 'Attendance', perm: Permission.DRIVER_READ },
      { to: '/orders', label: 'Delivery orders', perm: Permission.ORDER_READ },
      {
        to: '/vehicle-requests',
        label: 'Booking requests',
        perm: Permission.VEHICLE_REQUEST_CREATE,
      },
      { to: '/approvals', label: 'Approvals', perm: '' },
    ],
  },
  {
    title: 'Fleet',
    items: [
      { to: '/vehicles', label: 'Vehicles', perm: Permission.VEHICLE_READ },
      { to: '/drivers', label: 'Drivers', perm: Permission.DRIVER_READ },
      { to: '/safety', label: 'Driver safety', perm: Permission.SAFETY_READ },
      { to: '/incidents', label: 'Incidents & claims', perm: Permission.SAFETY_READ },
      { to: '/inspections', label: 'Inspections', perm: Permission.INSPECTION_READ },
      { to: '/training', label: 'Training', perm: Permission.DRIVER_READ },
      { to: '/incentives', label: 'Incentives', perm: Permission.INCENTIVE_READ },
      { to: '/fuel', label: 'Fuel', perm: Permission.FUEL_READ },
      { to: '/maintenance', label: 'Maintenance', perm: Permission.MAINTENANCE_READ },
      { to: '/geofences', label: 'Geofences', perm: Permission.TRACKING_READ },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/settings', label: 'Settings', perm: Permission.BRANCH_READ },
      { to: '/integrations', label: 'Integrations', perm: Permission.INTEGRATION_MANAGE },
    ],
  },
];

export function Layout() {
  const navigate = useNavigate();
  const user = session.user();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Fleet Management</span>
        </div>
        <nav>
          {sections.map((sec) => {
            const items = sec.items.filter((n) => !n.perm || session.can(n.perm));
            if (!items.length) return null;
            return (
              <div key={sec.title} className="nav-section">
                <span className="nav-title">{sec.title}</span>
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end}>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
          <NotificationBell />
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <strong>{user?.fullName}</strong>
            <span>{user?.roles.join(', ')}</span>
          </div>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
