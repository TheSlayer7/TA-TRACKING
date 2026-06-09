import { useState } from 'react';
import {
  LayoutDashboard, Users, BarChart3, Shield, ClipboardCheck,
  FileText, Plane, ChevronLeft, ChevronRight, LogOut, Sun, Moon,
  Building2, BookOpen, ScrollText
} from 'lucide-react';

const navConfig = {
  Admin: [
    { icon: LayoutDashboard, label: 'Dashboard', value: 'dashboard' },
    { icon: Users, label: 'Users', value: 'users' },
    { icon: BarChart3, label: 'Reports', value: 'reports' },
    { icon: Shield, label: 'Security', value: 'settings' },
  ],
  Faculty: [
    { icon: LayoutDashboard, label: 'Dashboard', value: 'dashboard' },
    { icon: ClipboardCheck, label: 'Tasks', value: 'tasks' },
    { icon: FileText, label: 'Reviews', value: 'reviews' },
    { icon: BarChart3, label: 'Reports', value: 'reports' },
    { icon: Shield, label: 'Security', value: 'settings' },
  ],
  TA: [
    { icon: LayoutDashboard, label: 'Dashboard', value: 'dashboard' },
    { icon: ClipboardCheck, label: 'Tasks', value: 'tasks' },
    { icon: Plane, label: 'Travel Allowance', value: 'travel' },
    { icon: BarChart3, label: 'Reports', value: 'reports' },
    { icon: Shield, label: 'Security', value: 'settings' },
  ],
};

export default function Sidebar({
  currentUser, workspaceSection, setWorkspaceSection,
  collapsed, onToggle, theme, setTheme, onLogout
}) {
  const role = currentUser?.role || 'TA';
  const items = navConfig[role] || navConfig.TA;
  const initials = (currentUser?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-logo"><span>TA</span></div>
        {!collapsed && (
          <div className="sidebar-title">
            TA Tracker
            <span>Finance Portal</span>
          </div>
        )}
        <button className="sidebar-collapse-btn" onClick={onToggle} aria-label="Toggle sidebar">
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Environment badge */}
      {!collapsed && (
        <div className="sidebar-env-badge">
          <span className="env-dot" />
          Production
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-nav-label">{collapsed ? '—' : 'Navigation'}</div>
        {items.map(item => {
          const Icon = item.icon;
          const isActive = workspaceSection === item.value;
          return (
            <button
              key={item.value}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => setWorkspaceSection(item.value)}
              title={collapsed ? item.label : undefined}
            >
              {isActive && <span className="sidebar-active-indicator" />}
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          className="sidebar-item"
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          title={collapsed ? (theme === 'light' ? 'Dark mode' : 'Light mode') : undefined}
        >
          {theme === 'light' ? <Moon size={20} strokeWidth={1.8} /> : <Sun size={20} strokeWidth={1.8} />}
          {!collapsed && <span className="sidebar-item-label">{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>}
        </button>
        <button
          className="sidebar-item sidebar-logout"
          onClick={onLogout}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={20} strokeWidth={1.8} />
          {!collapsed && <span className="sidebar-item-label">Sign out</span>}
        </button>

        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <strong>{currentUser?.name}</strong>
              <span>{currentUser?.role}{currentUser?.two_factor_enabled ? ' · 2FA' : ''}</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
