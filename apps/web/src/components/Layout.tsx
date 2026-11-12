import { Permission } from '@fms/shared';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { logout, session } from '../lib/api';
import { NotificationBell } from './NotificationBell';

const nav = [
  { to: '/', label: 'Dashboard', perm: Permission.VEHICLE_READ, end: true },
  { to: '/map', label: 'Live map', perm: Permission.TRACKING_READ },
  { to: '/vehicles', label: 'Vehicles', perm: Permission.VEHICLE_READ },
  { to: '/drivers', label: 'Drivers', perm: Permission.DRIVER_READ },
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
          {nav
            .filter((n) => session.can(n.perm))
            .map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
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
