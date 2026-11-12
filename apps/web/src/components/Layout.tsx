import { Permission } from '@fms/shared';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { logout, session } from '../lib/api';
import { NotificationBell } from './NotificationBell';

const sections: { title: string; items: { to: string; label: string; perm: string; end?: boolean }[] }[] = [
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
    ],
  },
  {
    title: 'Fleet',
    items: [
      { to: '/vehicles', label: 'Vehicles', perm: Permission.VEHICLE_READ },
      { to: '/drivers', label: 'Drivers', perm: Permission.DRIVER_READ },
      { to: '/fuel', label: 'Fuel', perm: Permission.FUEL_READ },
      { to: '/maintenance', label: 'Maintenance', perm: Permission.MAINTENANCE_READ },
      { to: '/geofences', label: 'Geofences', perm: Permission.TRACKING_READ },
    ],
  },
  { title: 'Admin', items: [{ to: '/settings', label: 'Settings', perm: Permission.BRANCH_READ }] },
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
            const items = sec.items.filter((n) => session.can(n.perm));
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
