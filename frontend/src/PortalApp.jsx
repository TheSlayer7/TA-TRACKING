import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useNavigate, Link } from 'react-router-dom';

const storageKey = 'ta-portal-session';
const defaultApiBase = 'http://localhost:5000/api';

const normalizeApiBase = (value) => {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');

  if (!trimmed) {
    return defaultApiBase;
  }

  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

const exampleSegments = [
  {
    mode: 'taxi',
    fare: 850,
    distance: 46,
    location: 'calicutAirport',
    state: 'kerala',
    vehicleType: 'car',
    description: 'Airport transfer'
  },
  {
    mode: 'rail',
    fare: 1240,
    distance: 0,
    location: '',
    state: 'other',
    vehicleType: 'car',
    description: 'Rail segment'
  }
];

const newSegment = () => ({
  mode: 'taxi',
  fare: 0,
  distance: 0,
  location: '',
  state: '',
  vehicleType: 'car',
  description: ''
});

const formatCurrency = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
}).format(Number(value || 0));

 import estimateClaim from './lib/taPolicy';

const readStoredSession = () => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch {
    return {};
  }
};

const SessionContext = createContext(null);

function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }

  return context;
}

function SessionProvider({ children }) {
  const savedPrefs = useMemo(readStoredSession, []);
  const [apiBase, setApiBase] = useState(normalizeApiBase(savedPrefs.apiBase || defaultApiBase));
  const [token, setToken] = useState(savedPrefs.token || '');
  const [currentUser, setCurrentUser] = useState(savedPrefs.user || null);
  const [theme, setTheme] = useState(savedPrefs.theme || 'light');
  const [workspaceSection, setWorkspaceSection] = useState(savedPrefs.workspaceSection || 'dashboard');
  const [health, setHealth] = useState({ state: 'idle', label: 'Checking backend...', text: 'Run a health check to confirm the API is online.' });
  const [sessionReady, setSessionReady] = useState(false);

  const apiRoot = normalizeApiBase(apiBase);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({
      apiBase: normalizeApiBase(apiBase),
      token,
      user: currentUser,
      theme,
      workspaceSection
    }));
  }, [apiBase, token, currentUser, theme, workspaceSection]);

  const readResponse = async (response) => {
    const contentType = response.headers.get('content-type') || '';
    const bodyText = await response.text();

    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(bodyText);
      } catch {
        return { error: 'Server returned invalid JSON.', raw: bodyText };
      }
    }

    return {
      error: 'Server returned HTML instead of JSON. Check that the backend is running.',
      raw: bodyText.slice(0, 200)
    };
  };

  useEffect(() => {
    let cancelled = false;

    const validateSession = async () => {
      const nextToken = String(token || '').trim();

      if (!nextToken) {
        if (!cancelled) {
          setCurrentUser(null);
          setSessionReady(true);
        }

        return;
      }

      try {
        const response = await fetch(`${apiRoot}/auth/me`, {
          headers: {
            Authorization: `Bearer ${nextToken}`
          }
        });

        const data = await readResponse(response);

        if (!response.ok) {
          throw new Error(data.error || 'Session validation failed');
        }

        if (!cancelled) {
          setCurrentUser(data.user);
        }
      } catch {
        if (!cancelled) {
          setToken('');
          setCurrentUser(null);
        }
      } finally {
        if (!cancelled) {
          setSessionReady(true);
        }
      }
    };

    validateSession();

    return () => {
      cancelled = true;
    };
  }, [apiRoot, token]);

  const authHeaders = (json = true) => {
    const headers = {};

    if (json) {
      headers['Content-Type'] = 'application/json';
    }

    if (token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    return headers;
  };

  const login = async ({ email, password }) => {
    let response;

    try {
      response = await fetch(`${apiRoot}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
    } catch {
      throw new Error(`Unable to reach the backend at ${apiRoot}. Start the API server and try again.`);
    }

    const data = await readResponse(response);

    if (!response.ok) {
      throw new Error(data.error || `Login failed with status ${response.status}`);
    }

    if (data.requiresTwoFactor) {
      return data;
    }

    setToken(data.token);
    setCurrentUser(data.user);

    return data;
  };

  const verifyTwoFactorLogin = async ({ challengeToken, code }) => {
    let response;

    try {
      response = await fetch(`${apiRoot}/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code })
      });
    } catch {
      throw new Error(`Unable to reach the backend at ${apiRoot}. Start the API server and try again.`);
    }

    const data = await readResponse(response);

    if (!response.ok) {
      throw new Error(data.error || `Two-factor verification failed with status ${response.status}`);
    }

    setToken(data.token);
    setCurrentUser(data.user);

    return data;
  };

  const loadTwoFactorSetup = async () => {
    const response = await fetch(`${apiRoot}/auth/2fa/setup`, {
      headers: authHeaders(false)
    });

    const data = await readResponse(response);

    if (!response.ok) {
      throw new Error(data.error || `Unable to start two-factor setup with status ${response.status}`);
    }

    return data;
  };

  const enableTwoFactor = async ({ secret, code }) => {
    const response = await fetch(`${apiRoot}/auth/2fa/enable`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ secret, code })
    });

    const data = await readResponse(response);

    if (!response.ok) {
      throw new Error(data.error || `Unable to enable two-factor authentication with status ${response.status}`);
    }

    setCurrentUser(data.user);

    return data;
  };

  const disableTwoFactor = async ({ password }) => {
    const response = await fetch(`${apiRoot}/auth/2fa/disable`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ password })
    });

    const data = await readResponse(response);

    if (!response.ok) {
      throw new Error(data.error || `Unable to disable two-factor authentication with status ${response.status}`);
    }

    setCurrentUser(data.user);

    return data;
  };

  const logout = () => {
    setToken('');
    setCurrentUser(null);
    setWorkspaceSection('dashboard');
  };

  const checkHealth = async () => {
    setHealth({ state: 'loading', label: 'Checking backend...', text: `Connecting to ${apiRoot}/health...` });

    try {
      const response = await fetch(`${apiRoot}/health`);
      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data.error || `Health check failed with status ${response.status}`);
      }

      setHealth({ state: 'ok', label: 'Backend online', text: data.message || 'API is reachable.' });
      return data;
    } catch (error) {
      setHealth({
        state: 'error',
        label: 'Backend offline',
        text: `${error.message} Start the backend with npm run dev in the backend folder.`
      });
      throw error;
    }
  };

  const value = {
    apiBase,
    setApiBase,
    apiRoot,
    token,
    currentUser,
    theme,
    setTheme,
    workspaceSection,
    setWorkspaceSection,
    health,
    checkHealth,
    authHeaders,
    readResponse,
    login,
    verifyTwoFactorLogin,
    loadTwoFactorSetup,
    enableTwoFactor,
    disableTwoFactor,
    logout,
    sessionReady,
    isAuthenticated: Boolean(token.trim() && currentUser)
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function LoadingScreen({ title, body }) {
  return (
    <main className="shell auth-shell">
      <section className="card auth-card">
        <p className="eyebrow">Loading</p>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
      </section>
    </main>
  );
}

function ProtectedRoute({ children, roles }) {
  const { currentUser, sessionReady } = useSession();

  if (!sessionReady) {
    return <LoadingScreen title="Restoring session" body="Checking your saved login and connecting to the backend." />;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (roles?.length && !roles.includes(currentUser.role)) {
    return <Navigate to="/access-denied" replace />;
  }

  return children;
}

function AppLayout({ children }) {
  const { currentUser, theme, setTheme, logout, workspaceSection, setWorkspaceSection } = useSession();
  const role = currentUser?.role;
  const navItems = role === 'Admin'
    ? [
        { label: 'Dashboard', value: 'dashboard' },
        { label: 'Users', value: 'users' },
        { label: 'Reports', value: 'reports' },
        { label: 'Security', value: 'settings' }
      ]
    : role === 'Faculty'
      ? [
          { label: 'Dashboard', value: 'dashboard' },
          { label: 'Tasks', value: 'tasks' },
          { label: 'Reviews', value: 'reviews' },
          { label: 'Reports', value: 'reports' },
          { label: 'Security', value: 'settings' }
        ]
      : [
          { label: 'Dashboard', value: 'dashboard' },
          { label: 'Tasks', value: 'tasks' },
          { label: 'Travel Allowance', value: 'travel' },
          { label: 'Reports', value: 'reports' },
          { label: 'Security', value: 'settings' }
        ];

  return (
    <div className="app-frame">
      <div className="bg-orb bg-orb-one" />
      <div className="bg-orb bg-orb-two" />

      <header className="site-header shell">
        <div className="brand-block">
          <div className="brand-mark">TA</div>
          <div>
            <strong className="brand-name">TA Portal</strong>
            <div className="brand-subtitle">Login, dashboard, claims and review pages</div>
          </div>
        </div>

        <nav className="site-nav">
          {navItems.map((item) => (
            <button
              key={item.label}
              className={`nav-link nav-button${workspaceSection === item.value ? ' active' : ''}`}
              type="button"
              onClick={() => setWorkspaceSection(item.value)}
            >
              {item.label}
            </button>
          ))}
          <button className="nav-link nav-button" type="button" onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </nav>

        <div className="user-chip">
          <div>
            <strong>{currentUser?.name}</strong>
            <span>{currentUser?.role}{currentUser?.two_factor_enabled ? ' · 2FA on' : ' · 2FA off'}</span>
          </div>
          <button className="btn btn-secondary" type="button" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="shell page-stack">
        {children}
      </main>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const { login, verifyTwoFactorLogin, currentUser, sessionReady, apiBase, setApiBase, theme, setTheme, health, checkHealth } = useSession();
  const [email, setEmail] = useState('ta@siteimade.local');
  const [password, setPassword] = useState('Password123!');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [awaitingTwoFactor, setAwaitingTwoFactor] = useState(false);
  const [message, setMessage] = useState('Use one of the PostgreSQL seed accounts to sign in.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionReady && currentUser) {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, navigate, sessionReady]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      if (awaitingTwoFactor) {
        const data = await verifyTwoFactorLogin({ challengeToken, code: twoFactorCode });
        setMessage(`Two-factor verification complete. Signed in as ${data.user.name}.`);
        navigate('/dashboard', { replace: true });
        return;
      }

      const data = await login({ email, password });

      if (data.requiresTwoFactor) {
        setAwaitingTwoFactor(true);
        setChallengeToken(data.challengeToken);
        setTwoFactorCode('');
        setMessage(data.message || 'Enter the code from your authenticator app.');
        return;
      }

      setMessage(`Signed in as ${data.user.name}. Redirecting to dashboard.`);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell auth-shell">
      <div className="bg-orb bg-orb-one" />
      <div className="bg-orb bg-orb-two" />

      <section className="hero-card card">
          <div className="hero-copy auth-copy">
          <p className="eyebrow">Travel allowance portal</p>
          <h1>Sign in to continue to your dashboard.</h1>
          <p className="lede">
            Use the dashboard to submit claims or review pending items. The app uses JWT authentication and a PostgreSQL backend.
          </p>
        </div>

        <aside className="hero-panel auth-side">
          <div className="status-card">
            <div className="status-head">
              <span className={`status-dot ${health.state}`} />
              <strong>{health.label}</strong>
            </div>
            <p>{health.text}</p>
            <button className="link-button" type="button" onClick={checkHealth}>Run health check</button>
          </div>

          <div className="mini-grid">
            <div className="mini-card">
              <span>API Base</span>
              <strong>{normalizeApiBase(apiBase)}</strong>
            </div>
            <div className="mini-card">
              <span>Theme</span>
              <strong>{theme}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="card auth-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Authentication</p>
            <h2>Login</h2>
          </div>
          <p className="muted">Seeded users live in PostgreSQL. Use `npm run seed` after creating the schema.</p>
        </div>

        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="apiBase">API Base URL</label>
              <input id="apiBase" type="text" value={apiBase} onChange={(event) => setApiBase(event.target.value)} spellCheck="false" />
            </div>
            <div className="field">
              <label htmlFor="theme">Theme</label>
              <select id="theme" value={theme} onChange={(event) => setTheme(event.target.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>

          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
          </div>

          {awaitingTwoFactor && (
            <div className="field-grid two-up two-factor-panel">
              <div className="field">
                <label htmlFor="twoFactorCode">Authentication code</label>
                <input
                  id="twoFactorCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value)}
                  placeholder="123456"
                />
              </div>
              <div className="field code-helper">
                <label>Step</label>
                <div className="helper-pill">Enter the 6-digit code from your authenticator app.</div>
              </div>
            </div>
          )}

          <div className="actions-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? (awaitingTwoFactor ? 'Verifying...' : 'Signing in...') : (awaitingTwoFactor ? 'Verify code' : 'Sign in')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              {awaitingTwoFactor && (
                <button className="btn btn-secondary" type="button" onClick={() => { setAwaitingTwoFactor(false); setChallengeToken(''); setTwoFactorCode(''); setMessage('Return to password sign-in or request a fresh 2FA challenge.'); }}>
                  Back to password
                </button>
              )}
              <button className="btn btn-secondary" type="button" onClick={() => { setEmail('ta@siteimade.local'); setPassword('Password123!'); }}>Fill TA</button>
              <button className="btn btn-secondary" type="button" onClick={() => { setEmail('faculty@siteimade.local'); setPassword('Password123!'); }}>Fill Faculty</button>
              <button className="btn btn-secondary" type="button" onClick={() => { setEmail('admin@siteimade.local'); setPassword('Password123!'); }}>Fill Admin</button>
            </div>
          </div>
        </form>

        <div className="notice">{message}</div>
        <div style={{ marginTop: 8 }}>
          <Link to="/signup" className="link-button">Create an account</Link>
        </div>
      </section>
    </main>
  );
}

function DashboardPage() {
  const { currentUser, apiRoot, authHeaders, readResponse, health, checkHealth } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({});

  const refreshDashboard = async () => {
    const role = currentUser?.role;

    if (!role) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (role === 'Admin') {
        const [summaryRes, usersRes, coursesRes, reportsRes] = await Promise.all([
          fetch(`${apiRoot}/rbac/admin/summary`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/admin/users`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/admin/courses`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/admin/reports`, { headers: authHeaders(false) })
        ]);

        const [summary, users, courses, reports] = await Promise.all([
          readResponse(summaryRes),
          readResponse(usersRes),
          readResponse(coursesRes),
          readResponse(reportsRes)
        ]);

        if (!summaryRes.ok) throw new Error(summary.error || 'Failed to load admin summary.');
        if (!usersRes.ok) throw new Error(users.error || 'Failed to load users.');
        if (!coursesRes.ok) throw new Error(courses.error || 'Failed to load courses.');
        if (!reportsRes.ok) throw new Error(reports.error || 'Failed to load reports.');

        setData({ summary, users, courses, reports });
      } else if (role === 'Faculty') {
        const [summaryRes, tasksRes, submissionsRes, reportsRes] = await Promise.all([
          fetch(`${apiRoot}/rbac/faculty/dashboard`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/faculty/tasks`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/faculty/submissions`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/faculty/reports`, { headers: authHeaders(false) })
        ]);

        const [summary, tasks, submissions, reports] = await Promise.all([
          readResponse(summaryRes),
          readResponse(tasksRes),
          readResponse(submissionsRes),
          readResponse(reportsRes)
        ]);

        if (!summaryRes.ok) throw new Error(summary.error || 'Failed to load faculty dashboard.');
        if (!tasksRes.ok) throw new Error(tasks.error || 'Failed to load faculty tasks.');
        if (!submissionsRes.ok) throw new Error(submissions.error || 'Failed to load submissions.');
        if (!reportsRes.ok) throw new Error(reports.error || 'Failed to load faculty reports.');

        setData({ summary, tasks, submissions, reports });
      } else {
        const [summaryRes, tasksRes, activityRes] = await Promise.all([
          fetch(`${apiRoot}/rbac/ta/dashboard`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/ta/tasks`, { headers: authHeaders(false) }),
          fetch(`${apiRoot}/rbac/ta/activity`, { headers: authHeaders(false) })
        ]);

        const [summary, tasks, activity] = await Promise.all([
          readResponse(summaryRes),
          readResponse(tasksRes),
          readResponse(activityRes)
        ]);

        if (!summaryRes.ok) throw new Error(summary.error || 'Failed to load TA dashboard.');
        if (!tasksRes.ok) throw new Error(tasks.error || 'Failed to load assigned tasks.');
        if (!activityRes.ok) throw new Error(activity.error || 'Failed to load activity history.');

        setData({ summary, tasks, activity });
      }
    } catch (loadError) {
      setError(loadError.message || 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth().catch(() => {});
    refreshDashboard();
  }, [currentUser?.role]);

  if (loading) {
    return <LoadingScreen title="Loading dashboard" body="Fetching the role-specific summary and action panels." />;
  }

  if (error) {
    return (
      <section className="card page-card notice-card">
        <p className="eyebrow">Dashboard error</p>
        <h2>Unable to load role data</h2>
        <p className="muted">{error}</p>
        <button className="btn btn-primary" type="button" onClick={refreshDashboard}>Retry</button>
      </section>
    );
  }

  if (currentUser?.role === 'Admin') {
    return <AdminDashboardPanel currentUser={currentUser} data={data} refreshDashboard={refreshDashboard} />;
  }

  if (currentUser?.role === 'Faculty') {
    return <FacultyDashboardPanel currentUser={currentUser} data={data} refreshDashboard={refreshDashboard} />;
  }

  return <TADashboardPanel currentUser={currentUser} data={data} refreshDashboard={refreshDashboard} health={health} checkHealth={checkHealth} apiRoot={apiRoot} />;
}

function AdminDashboardPanel({ currentUser, data, refreshDashboard }) {
  const { apiRoot, authHeaders, readResponse, workspaceSection, setWorkspaceSection } = useSession();
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', pay_level: 8, department: '', role: 'TA' });
  const [courseForm, setCourseForm] = useState({ code: '', title: '', term: 'Current', faculty_user_id: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState(data.users || []);
  const [courses, setCourses] = useState(data.courses || []);

  useEffect(() => setUsers(data.users || []), [data.users]);
  useEffect(() => setCourses(data.courses || []), [data.courses]);

  if (workspaceSection === 'settings') {
    return <SecurityPage />;
  }

  const saveUser = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/admin/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(userForm)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to create user.');
      setMessage('User created.');
      setUserForm({ name: '', email: '', password: '', pay_level: 8, department: '', role: 'TA' });
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (row) => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/admin/users/${row.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ name: row.name, email: row.email, pay_level: row.pay_level, department: row.department, active: row.active, role: row.role })
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to update user.');
      setMessage('User updated.');
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm('Delete this user?')) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(false)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to delete user.');
      setMessage('User deleted.');
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveCourse = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/admin/courses`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(courseForm)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to create course.');
      setMessage('Course created.');
      setCourseForm({ code: '', title: '', term: 'Current', faculty_user_id: '' });
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateCourse = async (row) => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/admin/courses/${row.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ code: row.code, title: row.title, term: row.term, faculty_user_id: row.faculty_user_id, active: row.active })
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to update course.');
      setMessage('Course updated.');
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteCourse = async (courseId) => {
    if (!window.confirm('Delete this course?')) return;
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/admin/courses/${courseId}`, {
        method: 'DELETE',
        headers: authHeaders(false)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to delete course.');
      setMessage('Course deleted.');
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-grid admin-grid">
      <article className={`card hero-card dashboard-hero${workspaceSection === 'dashboard' ? '' : ' is-hidden'}`} id="admin-summary">
        <div className="hero-copy">
          <p className="eyebrow">Admin dashboard</p>
          <h1>Welcome back, {currentUser?.name}.</h1>
          <p className="lede">Create users, assign roles, manage courses, and review system-wide reports from one place.</p>
          <div className="hero-actions">
            <button className="btn btn-primary" type="button" onClick={() => setWorkspaceSection('users')}>Manage users</button>
            <button className="btn btn-secondary" type="button" onClick={() => setWorkspaceSection('reports')}>View reports</button>
          </div>
        </div>

        <div className="dashboard-side">
          <div className="status-card">
            <div className="status-head"><strong>System summary</strong></div>
            <p>RBAC is active and all Admin actions are protected by role and permission checks.</p>
          </div>
          <div className="stats-grid">
            <div className="mini-card"><span>Users</span><strong>{data.summary?.userTotals?.reduce((total, item) => total + Number(item.total || 0), 0) || 0}</strong></div>
            <div className="mini-card"><span>Courses</span><strong>{data.summary?.courseTotal || 0}</strong></div>
            <div className="mini-card"><span>Tasks</span><strong>{data.reports?.recentTasks?.length || 0}</strong></div>
            <div className="mini-card"><span>Audit events</span><strong>{data.reports?.recentAudit?.length || 0}</strong></div>
          </div>
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'users' ? '' : ' is-hidden'}`} id="admin-users">
        <div className="panel-header"><div><p className="eyebrow">Users</p><h2>Create and manage users</h2></div></div>
        <div className="field-grid two-up">
          <input placeholder="Full name" value={userForm.name} onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))} />
          <input placeholder="Email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} />
          <input placeholder="Password" type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} />
          <input placeholder="Department" value={userForm.department} onChange={(event) => setUserForm((current) => ({ ...current, department: event.target.value }))} />
          <input type="number" min="1" max="18" value={userForm.pay_level} onChange={(event) => setUserForm((current) => ({ ...current, pay_level: Number(event.target.value) }))} />
          <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>
            <option value="TA">TA</option>
            <option value="Faculty">Faculty</option>
            <option value="Admin">Admin</option>
          </select>
        </div>
        <div className="actions-row"><button className="btn btn-primary" type="button" disabled={busy} onClick={saveUser}>Create user</button><span className="theme-note">{message}</span></div>

        <div className="data-table">
          {users.map((row) => (
            <div className="table-row" key={row.id}>
              <input value={row.name || ''} onChange={(event) => setUsers((current) => current.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} />
              <input value={row.email || ''} onChange={(event) => setUsers((current) => current.map((item) => item.id === row.id ? { ...item, email: event.target.value } : item))} />
              <input type="number" min="1" max="18" value={row.pay_level || 1} onChange={(event) => setUsers((current) => current.map((item) => item.id === row.id ? { ...item, pay_level: Number(event.target.value) } : item))} />
              <input value={row.department || ''} onChange={(event) => setUsers((current) => current.map((item) => item.id === row.id ? { ...item, department: event.target.value } : item))} />
              <select value={row.role || 'TA'} onChange={(event) => setUsers((current) => current.map((item) => item.id === row.id ? { ...item, role: event.target.value } : item))}>
                <option value="TA">TA</option>
                <option value="Faculty">Faculty</option>
                <option value="Admin">Admin</option>
              </select>
              <label className="toggle compact-toggle"><input type="checkbox" checked={Boolean(row.active)} onChange={(event) => setUsers((current) => current.map((item) => item.id === row.id ? { ...item, active: event.target.checked } : item))} /><span>Active</span></label>
              <div className="inline-actions">
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => updateUser(row)}>Save</button>
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => deleteUser(row.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'dashboard' ? '' : ' is-hidden'}`} id="admin-courses">
        <div className="panel-header"><div><p className="eyebrow">Courses</p><h2>Manage courses</h2></div></div>
        <div className="field-grid two-up">
          <input placeholder="Course code" value={courseForm.code} onChange={(event) => setCourseForm((current) => ({ ...current, code: event.target.value }))} />
          <input placeholder="Course title" value={courseForm.title} onChange={(event) => setCourseForm((current) => ({ ...current, title: event.target.value }))} />
          <input placeholder="Term" value={courseForm.term} onChange={(event) => setCourseForm((current) => ({ ...current, term: event.target.value }))} />
          <select value={courseForm.faculty_user_id} onChange={(event) => setCourseForm((current) => ({ ...current, faculty_user_id: event.target.value }))}>
            <option value="">Assign Faculty</option>
            {users.filter((row) => row.role === 'Faculty').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </div>
        <div className="actions-row"><button className="btn btn-primary" type="button" disabled={busy} onClick={saveCourse}>Create course</button></div>

        <div className="data-table">
          {courses.map((row) => (
            <div className="table-row" key={row.id}>
              <input value={row.code || ''} onChange={(event) => setCourses((current) => current.map((item) => item.id === row.id ? { ...item, code: event.target.value } : item))} />
              <input value={row.title || ''} onChange={(event) => setCourses((current) => current.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} />
              <input value={row.term || ''} onChange={(event) => setCourses((current) => current.map((item) => item.id === row.id ? { ...item, term: event.target.value } : item))} />
              <select value={row.faculty_user_id || ''} onChange={(event) => setCourses((current) => current.map((item) => item.id === row.id ? { ...item, faculty_user_id: event.target.value } : item))}>
                <option value="">Unassigned</option>
                {users.filter((item) => item.role === 'Faculty').map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
              </select>
              <label className="toggle compact-toggle"><input type="checkbox" checked={Boolean(row.active)} onChange={(event) => setCourses((current) => current.map((item) => item.id === row.id ? { ...item, active: event.target.checked } : item))} /><span>Active</span></label>
              <div className="inline-actions">
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => updateCourse(row)}>Save</button>
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => deleteCourse(row.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'reports' ? '' : ' is-hidden'}`} id="admin-reports">
        <div className="panel-header"><div><p className="eyebrow">Reports</p><h2>System metrics</h2></div></div>
        <div className="stats-grid">
          {data.reports?.userRoles?.map((item) => <div className="mini-card" key={item.role}><span>{item.role}</span><strong>{item.total}</strong></div>)}
        </div>
        <div className="feature-grid report-grid">
          {data.reports?.recentTasks?.map((task) => <div className="feature-card static-card" key={task.id}><strong>{task.title}</strong><span>{task.status} · {task.updated_at}</span></div>)}
          {data.reports?.recentAudit?.map((event) => <div className="feature-card static-card" key={event.id}><strong>{event.action}</strong><span>{event.entity_type} · {event.created_at}</span></div>)}
        </div>
      </article>
    </section>
  );
}

function FacultyDashboardPanel({ currentUser, data, refreshDashboard }) {
  const { apiRoot, authHeaders, readResponse, workspaceSection, setWorkspaceSection } = useSession();
  const [taskForm, setTaskForm] = useState({ course_id: '', assigned_ta_id: '', title: '', description: '', due_date: '' });
  const [reviewNotes, setReviewNotes] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submitTask = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/faculty/tasks`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(taskForm)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to assign task.');
      setMessage('Task assigned.');
      setTaskForm({ course_id: '', assigned_ta_id: '', title: '', description: '', due_date: '' });
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const reviewSubmission = async (id, status) => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/faculty/work-logs/${id}/review`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ status, reviewer_notes: reviewNotes })
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to review work log.');
      setMessage(payload.message || 'Work log updated.');
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const courseOptions = data.reports?.courseSummary || [];
  const taOptions = Array.from(new Map((data.reports?.taSummary || []).map((item) => [item.ta_name, item])).values());

  if (workspaceSection === 'settings') {
    return <SecurityPage />;
  }

  return (
    <section className="page-grid faculty-grid">
      <article className={`card hero-card dashboard-hero${workspaceSection === 'dashboard' ? '' : ' is-hidden'}`} id="faculty-summary">
        <div className="hero-copy">
          <p className="eyebrow">Faculty dashboard</p>
          <h1>Welcome back, {currentUser?.name}.</h1>
          <p className="lede">Assign tasks, review TA submissions, and monitor course reports.</p>
        </div>
        <div className="dashboard-side">
          <div className="stats-grid">
            <div className="mini-card"><span>Courses</span><strong>{data.summary?.courseSummary?.course_count || 0}</strong></div>
            <div className="mini-card"><span>TAs</span><strong>{data.summary?.courseSummary?.ta_count || 0}</strong></div>
            <div className="mini-card"><span>Pending reviews</span><strong>{data.summary?.pendingReviews || 0}</strong></div>
            <div className="mini-card"><span>Approved hours</span><strong>{formatCurrency(data.summary?.approvedHours || 0)}</strong></div>
          </div>
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'tasks' ? '' : ' is-hidden'}`} id="faculty-tasks">
        <div className="panel-header"><div><p className="eyebrow">Tasks</p><h2>Assign work to TAs</h2></div></div>
        <div className="field-grid two-up">
          <select value={taskForm.course_id} onChange={(event) => setTaskForm((current) => ({ ...current, course_id: event.target.value }))}>
            <option value="">Choose course</option>
            {courseOptions.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.title}</option>)}
          </select>
          <select value={taskForm.assigned_ta_id} onChange={(event) => setTaskForm((current) => ({ ...current, assigned_ta_id: event.target.value }))}>
            <option value="">Choose TA</option>
            {(data.reports?.taSummary || []).map((row) => <option key={row.ta_id} value={row.ta_id}>{row.ta_name}</option>)}
          </select>
          <input placeholder="Task title" value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} />
          <input type="date" value={taskForm.due_date} onChange={(event) => setTaskForm((current) => ({ ...current, due_date: event.target.value }))} />
          <textarea rows="3" placeholder="Task description" value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} />
        </div>
        <div className="actions-row"><button className="btn btn-primary" type="button" disabled={busy} onClick={submitTask}>Assign task</button><span className="theme-note">{message}</span></div>

        <div className="pending-list">
          {data.tasks?.map((task) => (
            <article className="pending-item" key={task.id}>
              <div className="topline"><div><h3>{task.title}</h3><p className="meta">{task.course_code} · {task.ta_name}</p></div><span className="badge pending">{task.status}</span></div>
              <p className="muted">{task.description || 'No description.'}</p>
            </article>
          ))}
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'reviews' ? '' : ' is-hidden'}`} id="faculty-submissions">
        <div className="panel-header"><div><p className="eyebrow">Submissions</p><h2>Review TA work logs</h2></div></div>
        <div className="field">
          <label htmlFor="reviewNotes">Reviewer notes</label>
          <input id="reviewNotes" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Optional review note" />
        </div>
        <div className="pending-list">
          {data.submissions?.map((submission) => (
            <article className="pending-item" key={submission.id}>
              <div className="topline"><div><h3>{submission.task_title}</h3><p className="meta">{submission.course_code} · {submission.ta_name}</p></div><span className="badge pending">{submission.status}</span></div>
              <p>{submission.summary}</p>
              <div className="actions-row"><button className="btn btn-primary" type="button" disabled={busy} onClick={() => reviewSubmission(submission.id, 'Approved')}>Approve</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => reviewSubmission(submission.id, 'Rejected')}>Reject</button></div>
            </article>
          ))}
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'reports' ? '' : ' is-hidden'}`} id="faculty-reports">
        <div className="panel-header"><div><p className="eyebrow">Reports</p><h2>Course reports</h2></div></div>
        <div className="feature-grid report-grid">
          {(data.reports?.courseSummary || []).map((course) => <div className="feature-card static-card" key={course.id}><strong>{course.code}</strong><span>{course.task_count} tasks · {course.submission_count} submissions · {formatCurrency(course.approved_hours || 0)} approved hours</span></div>)}
        </div>
      </article>
    </section>
  );
}

function TADashboardPanel({ currentUser, data, refreshDashboard }) {
  const { apiRoot, authHeaders, readResponse, health, checkHealth, workspaceSection } = useSession();
  const [logForm, setLogForm] = useState({ task_id: '', summary: '', hours_worked: 1, log_date: '' });
  const [statusForm, setStatusForm] = useState({ task_id: '', status: 'In Progress', completion_pct: 50 });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submitLog = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/ta/tasks/${logForm.task_id}/logs`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(logForm)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to submit work log.');
      setMessage('Work log submitted.');
      setLogForm({ task_id: '', summary: '', hours_worked: 1, log_date: '' });
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateTaskStatus = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiRoot}/rbac/ta/tasks/${statusForm.task_id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(statusForm)
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || 'Unable to update task status.');
      setMessage('Task status updated.');
      await refreshDashboard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (workspaceSection === 'settings') {
    return <SecurityPage />;
  }

  if (workspaceSection === 'travel') {
    return <ClaimsPage />;
  }

  return (
    <section className="page-grid ta-grid">
      <article className={`card hero-card dashboard-hero${workspaceSection === 'dashboard' ? '' : ' is-hidden'}`} id="ta-summary">
        <div className="hero-copy">
          <p className="eyebrow">TA dashboard</p>
          <h1>Welcome back, {currentUser?.name}.</h1>
          <p className="lede">Track your assignments, update status, and submit work logs tied to your courses.</p>
        </div>
        <div className="dashboard-side">
          <div className="status-card">
            <div className="status-head"><strong>Security</strong></div>
            <p>{currentUser?.two_factor_enabled ? '2FA is on for this account.' : 'Enable 2FA from the security page for better protection.'}</p>
          </div>
          <div className="stats-grid">
            <div className="mini-card"><span>Tasks</span><strong>{data.activity?.taskStats?.task_count || 0}</strong></div>
            <div className="mini-card"><span>Approved</span><strong>{data.activity?.taskStats?.approved_count || 0}</strong></div>
            <div className="mini-card"><span>Submitted logs</span><strong>{data.activity?.taskStats?.submitted_count || 0}</strong></div>
            <div className="mini-card"><span>Total hours</span><strong>{formatCurrency(data.activity?.reportStats?.total_hours || 0)}</strong></div>
          </div>
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'tasks' ? '' : ' is-hidden'}`} id="ta-tasks">
        <div className="panel-header"><div><p className="eyebrow">Tasks</p><h2>Your assignments</h2></div></div>
        <div className="field-grid two-up">
          <select value={statusForm.task_id} onChange={(event) => setStatusForm((current) => ({ ...current, task_id: event.target.value }))}>
            <option value="">Select task</option>
            {(data.tasks || []).map((task) => <option key={task.id} value={task.id}>{task.course_code} - {task.title}</option>)}
          </select>
          <select value={statusForm.status} onChange={(event) => setStatusForm((current) => ({ ...current, status: event.target.value }))}>
            <option value="Assigned">Assigned</option>
            <option value="In Progress">In Progress</option>
            <option value="Submitted">Submitted</option>
          </select>
          <input type="number" min="0" max="100" value={statusForm.completion_pct} onChange={(event) => setStatusForm((current) => ({ ...current, completion_pct: Number(event.target.value) }))} />
        </div>
        <div className="actions-row"><button className="btn btn-secondary" type="button" disabled={busy} onClick={updateTaskStatus}>Update status</button></div>

        <div className="pending-list">
          {(data.tasks || []).map((task) => (
            <article className="pending-item" key={task.id}>
              <div className="topline"><div><h3>{task.title}</h3><p className="meta">{task.course_code} · {task.course_title}</p></div><span className="badge pending">{task.status}</span></div>
              <p className="muted">{task.description || 'No description.'}</p>
              <p className="theme-note">{task.due_date ? `Due ${task.due_date}` : 'No due date'}</p>
            </article>
          ))}
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'reports' ? '' : ' is-hidden'}`} id="ta-activity">
        <div className="panel-header"><div><p className="eyebrow">Activity</p><h2>Submit work log and view history</h2></div></div>
        <div className="field-grid two-up">
          <select value={logForm.task_id} onChange={(event) => setLogForm((current) => ({ ...current, task_id: event.target.value }))}>
            <option value="">Select task</option>
            {(data.tasks || []).map((task) => <option key={task.id} value={task.id}>{task.course_code} - {task.title}</option>)}
          </select>
          <input type="number" min="0" step="0.25" value={logForm.hours_worked} onChange={(event) => setLogForm((current) => ({ ...current, hours_worked: Number(event.target.value) }))} />
          <input type="date" value={logForm.log_date} onChange={(event) => setLogForm((current) => ({ ...current, log_date: event.target.value }))} />
          <textarea rows="3" placeholder="Work summary" value={logForm.summary} onChange={(event) => setLogForm((current) => ({ ...current, summary: event.target.value }))} />
        </div>
        <div className="actions-row"><button className="btn btn-primary" type="button" disabled={busy} onClick={submitLog}>Submit work log</button><span className="theme-note">{message}</span></div>

        <div className="pending-list">
          {(data.activity?.logs || []).map((log) => (
            <article className="pending-item" key={log.id}>
              <div className="topline"><div><h3>{log.task_title}</h3><p className="meta">{log.course_code} · {log.log_date}</p></div><span className="badge pending">{log.status}</span></div>
              <p>{log.summary}</p>
              <p className="theme-note">{formatCurrency(log.hours_worked || 0)} hours</p>
            </article>
          ))}
        </div>
      </article>

      <article className={`card page-card${workspaceSection === 'dashboard' ? '' : ' is-hidden'}`} id="ta-summary-card">
        <div className="panel-header"><div><p className="eyebrow">Reports</p><h2>Personal summary</h2></div></div>
        <div className="feature-grid report-grid">
          <div className="feature-card static-card"><strong>Total logs</strong><span>{data.activity?.reportStats?.approved_logs || 0} approved logs</span></div>
          <div className="feature-card static-card"><strong>Backend</strong><span>{health.label}</span></div>
          <div className="feature-card static-card"><strong>Security</strong><span>{currentUser?.two_factor_enabled ? '2FA enabled' : '2FA not enabled'}</span></div>
        </div>
      </article>
    </section>
  );
}

function ClaimsPage() {
  const { currentUser, apiRoot, authHeaders, readResponse } = useSession();
  const [journeyType, setJourneyType] = useState('tour');
  const [payLevel, setPayLevel] = useState(8);
  const [segments, setSegments] = useState([newSegment(), newSegment()]);
  const [accommodationRequired, setAccommodationRequired] = useState(true);
  const [hotelNights, setHotelNights] = useState(2);
  const [hotelCharge, setHotelCharge] = useState(4200);
  const [gstRate, setGstRate] = useState(12);
  const [localTravelRequired, setLocalTravelRequired] = useState(true);
  const [localDays, setLocalDays] = useState(2);
  const [localKm, setLocalKm] = useState(46);
  const [localCharge, setLocalCharge] = useState(950);
  const [dailyAllowanceRequired, setDailyAllowanceRequired] = useState(true);
  const [absenceHours, setAbsenceHours] = useState(10);
  const [foodProvided, setFoodProvided] = useState(false);
  const [ownVehicleApproved, setOwnVehicleApproved] = useState(false);
  const [airTravelApproved, setAirTravelApproved] = useState(false);
  const [otherCharges, setOtherCharges] = useState(750);
  const [remarks, setRemarks] = useState('');
  const [apiOutput, setApiOutput] = useState('Ready.');

  const payload = useMemo(() => ({
    journeyDetails: {
      journeyType,
      segments
    },
    accommodation: {
      required: accommodationRequired,
      nights: Number(hotelNights),
      actualRoomCharges: Number(hotelCharge),
      gstRate: Number(gstRate)
    },
    localTravel: {
      required: localTravelRequired,
      days: Number(localDays),
      kilometers: Number(localKm),
      actualCharges: Number(localCharge)
    },
    dailyAllowance: {
      required: dailyAllowanceRequired,
      absenceHours: Number(absenceHours),
      foodProvided: Boolean(foodProvided)
    },
    approvals: {
      ownVehicleApproved: Boolean(ownVehicleApproved),
      airTravelApproved: Boolean(airTravelApproved)
    },
    otherCharges: {
      amount: Number(otherCharges),
      notes: remarks
    }
  }), [journeyType, segments, accommodationRequired, hotelNights, hotelCharge, gstRate, localTravelRequired, localDays, localKm, localCharge, dailyAllowanceRequired, absenceHours, foodProvided, ownVehicleApproved, airTravelApproved, otherCharges, remarks]);

  const estimatedAdmissible = useMemo(() => estimateClaim(payload, payLevel), [payload, payLevel]);

  const saveOutput = (value) => {
    setApiOutput(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };

  const updateSegment = (index, field, value) => {
    setSegments((current) => current.map((segment, segmentIndex) => (
      segmentIndex === index ? { ...segment, [field]: value } : segment
    )));
  };

  const addSegment = () => setSegments((current) => [...current, newSegment()]);
  const removeSegment = (index) => setSegments((current) => (current.length > 1 ? current.filter((_, segmentIndex) => segmentIndex !== index) : current));

  const loadExample = () => {
    setJourneyType('tour');
    setPayLevel(8);
    setSegments(exampleSegments.map((segment) => ({ ...segment })));
    setAccommodationRequired(true);
    setHotelNights(2);
    setHotelCharge(4200);
    setGstRate(12);
    setLocalTravelRequired(true);
    setLocalDays(2);
    setLocalKm(46);
    setLocalCharge(950);
    setDailyAllowanceRequired(true);
    setAbsenceHours(10);
    setFoodProvided(false);
    setOwnVehicleApproved(false);
    setAirTravelApproved(false);
    setOtherCharges(750);
    setRemarks('Sample data for testing the claim flow.');
  };

  const submitClaim = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${apiRoot}/claims/submit`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data.error || `Claim submission failed with status ${response.status}`);
      }

      saveOutput(data);
    } catch (error) {
      saveOutput({ error: error.message });
    }
  };

  return (
    <section className="page-grid claim-grid">
      <article className="card page-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Claim Builder</p>
            <h2>Submit a travel claim</h2>
          </div>
          <p className="muted">The backend recalculates the admissible amount using the JWT-derived pay level.</p>
        </div>

        <form className="stack-form" onSubmit={submitClaim}>
          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="journeyType">Journey Type</label>
              <select id="journeyType" value={journeyType} onChange={(event) => setJourneyType(event.target.value)}>
                <option value="tour">Tour</option>
                <option value="transfer">Transfer</option>
                <option value="training">Training</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="employeePayLevel">Employee Pay Level Preview</label>
              <input id="employeePayLevel" type="number" min="1" max="18" value={payLevel} onChange={(event) => setPayLevel(Number(event.target.value))} />
            </div>
          </div>

          <section className="subpanel">
            <div className="subpanel-head">
              <h3>Journey Segments</h3>
              <button type="button" className="link-button" onClick={addSegment}>Add Segment</button>
            </div>

            <div className="segment-list">
              {segments.map((segment, index) => (
                <div className="segment-card" key={index}>
                  <div className="segment-head">
                    <strong>Segment {index + 1}</strong>
                    <button type="button" className="link-button danger" onClick={() => removeSegment(index)}>Remove</button>
                  </div>

                  <div className="field-grid three-up">
                    <div className="field">
                      <label>Mode</label>
                      <select value={segment.mode} onChange={(event) => updateSegment(index, 'mode', event.target.value)}>
                        <option value="taxi">Taxi</option>
                        <option value="road">Road</option>
                        <option value="ownVehicle">Own Vehicle</option>
                        <option value="rail">Rail</option>
                        <option value="air">Air</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Fare</label>
                      <input type="number" min="0" step="0.01" value={segment.fare} onChange={(event) => updateSegment(index, 'fare', Number(event.target.value))} />
                    </div>
                    <div className="field">
                      <label>Distance</label>
                      <input type="number" min="0" step="0.01" value={segment.distance} onChange={(event) => updateSegment(index, 'distance', Number(event.target.value))} />
                    </div>
                  </div>

                  <div className="field-grid four-up">
                    <div className="field">
                      <label>Location</label>
                      <select value={segment.location} onChange={(event) => updateSegment(index, 'location', event.target.value)}>
                        <option value="">General</option>
                        <option value="calicutAirport">Calicut Airport</option>
                        <option value="calicutRailway">Calicut Railway</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>State</label>
                      <select value={segment.state} onChange={(event) => updateSegment(index, 'state', event.target.value)}>
                        <option value="">Other</option>
                        <option value="kerala">Kerala</option>
                        <option value="other">Other State</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Vehicle Type</label>
                      <select value={segment.vehicleType} onChange={(event) => updateSegment(index, 'vehicleType', event.target.value)}>
                        <option value="car">Car</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Description</label>
                      <input type="text" value={segment.description} onChange={(event) => updateSegment(index, 'description', event.target.value)} placeholder="Optional" />
                    </div>
                  </div>

                  <div className="field-grid two-up">
                    <div className="field">
                      <label>Travel Class</label>
                      <select value={segment.travelClass || ''} onChange={(event) => updateSegment(index, 'travelClass', event.target.value)}>
                        <option value="">Not set</option>
                        <option value="business">Business</option>
                        <option value="club">Club</option>
                        <option value="economy">Economy</option>
                        <option value="ac1">AC-I</option>
                        <option value="ac2">AC-II</option>
                        <option value="ac3">AC-III</option>
                        <option value="ac-chair-car">AC Chair Car</option>
                        <option value="first">First Class</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="subpanel">
            <div className="subpanel-head">
              <h3>Approvals and Daily Allowance</h3>
            </div>
            <div className="field-grid two-up">
              <div className="field">
                <label htmlFor="absenceHours">Absence from HQ (hours)</label>
                <input id="absenceHours" type="number" min="0" step="0.1" value={absenceHours} onChange={(event) => setAbsenceHours(Number(event.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="dailyAllowanceRequired">Daily Allowance</label>
                <label className="toggle">
                  <input id="dailyAllowanceRequired" type="checkbox" checked={dailyAllowanceRequired} onChange={(event) => setDailyAllowanceRequired(event.target.checked)} />
                  <span>Required</span>
                </label>
              </div>
              <div className="field">
                <label htmlFor="foodProvided">Food Provided</label>
                <label className="toggle">
                  <input id="foodProvided" type="checkbox" checked={foodProvided} onChange={(event) => setFoodProvided(event.target.checked)} />
                  <span>Yes</span>
                </label>
              </div>
              <div className="field">
                <label htmlFor="ownVehicleApproved">Own Vehicle Approved</label>
                <label className="toggle">
                  <input id="ownVehicleApproved" type="checkbox" checked={ownVehicleApproved} onChange={(event) => setOwnVehicleApproved(event.target.checked)} />
                  <span>Approved</span>
                </label>
              </div>
              <div className="field">
                <label htmlFor="airTravelApproved">Air Travel Approved</label>
                <label className="toggle">
                  <input id="airTravelApproved" type="checkbox" checked={airTravelApproved} onChange={(event) => setAirTravelApproved(event.target.checked)} />
                  <span>Approved</span>
                </label>
              </div>
            </div>
          </section>

          <div className="field-grid two-up">
            <section className="subpanel">
              <div className="subpanel-head">
                <h3>Accommodation</h3>
                <label className="toggle">
                  <input type="checkbox" checked={accommodationRequired} onChange={(event) => setAccommodationRequired(event.target.checked)} />
                  <span>Required</span>
                </label>
              </div>

              <div className="field-grid compact">
                <div className="field">
                  <label htmlFor="hotelNights">Nights</label>
                  <input id="hotelNights" type="number" min="0" value={hotelNights} onChange={(event) => setHotelNights(Number(event.target.value))} />
                </div>
                <div className="field">
                  <label htmlFor="hotelCharge">Room Charges</label>
                  <input id="hotelCharge" type="number" min="0" step="0.01" value={hotelCharge} onChange={(event) => setHotelCharge(Number(event.target.value))} />
                </div>
                <div className="field">
                  <label htmlFor="gstRate">GST %</label>
                  <input id="gstRate" type="number" min="0" step="0.01" value={gstRate} onChange={(event) => setGstRate(Number(event.target.value))} />
                </div>
              </div>
            </section>

            <section className="subpanel">
              <div className="subpanel-head">
                <h3>Local Travel</h3>
                <label className="toggle">
                  <input type="checkbox" checked={localTravelRequired} onChange={(event) => setLocalTravelRequired(event.target.checked)} />
                  <span>Required</span>
                </label>
              </div>

              <div className="field-grid compact">
                <div className="field">
                  <label htmlFor="localDays">Days</label>
                  <input id="localDays" type="number" min="0" value={localDays} onChange={(event) => setLocalDays(Number(event.target.value))} />
                </div>
                <div className="field">
                  <label htmlFor="localKm">Kilometers</label>
                  <input id="localKm" type="number" min="0" step="0.01" value={localKm} onChange={(event) => setLocalKm(Number(event.target.value))} />
                </div>
                <div className="field">
                  <label htmlFor="localCharge">Actual Charges</label>
                  <input id="localCharge" type="number" min="0" step="0.01" value={localCharge} onChange={(event) => setLocalCharge(Number(event.target.value))} />
                </div>
              </div>
            </section>
          </div>

          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="otherCharges">Other Charges</label>
              <input id="otherCharges" type="number" min="0" step="0.01" value={otherCharges} onChange={(event) => setOtherCharges(Number(event.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="remarks">Claim Notes</label>
              <input id="remarks" type="text" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional note for the reviewer" />
            </div>
          </div>

          <div className="actions-row">
            <button type="submit" className="btn btn-primary">Submit Claim</button>
            <button type="button" className="btn btn-secondary" onClick={loadExample}>Load Example Data</button>
          </div>
        </form>
      </article>

      <aside className="card page-card sticky-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>Frontend estimate</h2>
          </div>
        </div>

        <div className="estimate-row">
          <span>Estimated admissible amount</span>
          <strong>{formatCurrency(estimatedAdmissible.totalAdmissible)}</strong>
        </div>

        {estimatedAdmissible.warnings.length > 0 && (
          <div className="mini-card wide-card">
            <span>Policy warnings</span>
            <div className="stack-list">
              {estimatedAdmissible.warnings.map((warning) => <p key={warning} className="theme-note">{warning}</p>)}
            </div>
          </div>
        )}

        <div className="mini-card wide-card">
          <span>Active user</span>
          <strong>{currentUser?.name}</strong>
        </div>

        <pre className="api-output">{apiOutput}</pre>
      </aside>
    </section>
  );
}

function ReviewQueuePage() {
  const { currentUser, apiRoot, authHeaders, readResponse } = useSession();
  const [pendingClaims, setPendingClaims] = useState([]);
  const [queueMessage, setQueueMessage] = useState('Loading queue...');
  const [apiOutput, setApiOutput] = useState('Ready.');

  const saveOutput = (value) => {
    setApiOutput(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };

  const loadPendingClaims = async () => {
    try {
      const response = await fetch(`${apiRoot}/claims/pending`, {
        headers: authHeaders(false)
      });

      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data.error || `Could not load pending claims with status ${response.status}`);
      }

      setPendingClaims(data);
      setQueueMessage(`${data.length} pending claim${data.length === 1 ? '' : 's'}`);
      saveOutput({ loadedPendingClaims: data.length });
    } catch (error) {
      setPendingClaims([]);
      setQueueMessage('Unavailable');
      saveOutput({ error: error.message });
    }
  };

  const verifyClaim = async (id, status) => {
    const remarksText = window.prompt(`${status} claim #${id}. Optional remarks:`) || '';

    try {
      const response = await fetch(`${apiRoot}/claims/${id}/verify`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ status, remarks: remarksText })
      });

      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data.error || `Verification failed with status ${response.status}`);
      }

      saveOutput(data);
      await loadPendingClaims();
    } catch (error) {
      saveOutput({ error: error.message });
    }
  };

  useEffect(() => {
    loadPendingClaims();
  }, []);

  const canReview = currentUser?.role === 'Faculty' || currentUser?.role === 'Admin';

  if (!canReview) {
    return (
      <section className="card page-card notice-card">
        <p className="eyebrow">Faculty only</p>
        <h2>Review queue is restricted</h2>
        <p className="muted">Sign in with a Faculty or Admin account to open the approval workflow.</p>
      </section>
    );
  }

  return (
    <section className="page-grid review-grid">
      <article className="card page-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Faculty Review</p>
            <h2>Pending claims queue</h2>
          </div>
          <button className="btn btn-secondary" type="button" onClick={loadPendingClaims}>Refresh queue</button>
        </div>

        <div className="summary-strip">
          <span>Queue status</span>
          <strong>{queueMessage}</strong>
        </div>

        <div className={`pending-list ${pendingClaims.length ? '' : 'empty-state'}`}>
          {pendingClaims.length === 0 ? (
            <p>No pending claims right now.</p>
          ) : pendingClaims.map((item) => (
            <article className="pending-item" key={item.id}>
              <div className="topline">
                <div>
                  <h3>{item.name || 'Unknown User'}</h3>
                  <p className="meta">{item.department || 'No department'} · Pay Level {item.pay_level ?? '-'}</p>
                </div>
                <span className="badge pending">{item.status || 'Pending'}</span>
              </div>

              <div className="field-grid two-up">
                <div>
                  <span className="meta">Journey Type</span>
                  <strong>{item.journey_type || 'tour'}</strong>
                </div>
                <div>
                  <span className="meta">Admissible Amount</span>
                  <strong>{formatCurrency(item.admissible_amount)}</strong>
                </div>
                <div>
                  <span className="meta">Claim ID</span>
                  <strong>#{item.id}</strong>
                </div>
                <div>
                  <span className="meta">Claim Date</span>
                  <strong>{item.claim_date ? new Date(item.claim_date).toLocaleString() : 'N/A'}</strong>
                </div>
              </div>

              <div className="actions-row">
                <button type="button" className="btn btn-primary" onClick={() => verifyClaim(item.id, 'Approved')}>Approve</button>
                <button type="button" className="btn btn-secondary" onClick={() => verifyClaim(item.id, 'Rejected')}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      </article>

      <aside className="card page-card sticky-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Queue Console</p>
            <h2>Latest API result</h2>
          </div>
        </div>

        <pre className="api-output">{apiOutput}</pre>
      </aside>
    </section>
  );
}

function SecurityPage() {
  const { currentUser, loadTwoFactorSetup, enableTwoFactor, disableTwoFactor, setWorkspaceSection } = useSession();
  const [setupState, setSetupState] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [message, setMessage] = useState('Use this page to enable or disable two-factor authentication.');
  const [busy, setBusy] = useState(false);

  const refreshSetup = async () => {
    setBusy(true);
    try {
      const data = await loadTwoFactorSetup();
      setSetupState(data);
      setMessage('Scan the QR code in your authenticator app, then confirm with a code below.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async (event) => {
    event.preventDefault();

    if (!setupState?.secret) {
      setMessage('Generate a setup secret first.');
      return;
    }

    setBusy(true);
    try {
      const data = await enableTwoFactor({ secret: setupState.secret, code: setupCode });
      setMessage(data.message || 'Two-factor authentication enabled.');
      setSetupCode('');
      setSetupState(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const data = await disableTwoFactor({ password: disablePassword });
      setMessage(data.message || 'Two-factor authentication disabled.');
      setDisablePassword('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-grid security-grid">
      <article className="card page-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Security</p>
            <h2>Two-factor authentication</h2>
          </div>
          <span className={`badge ${currentUser?.two_factor_enabled ? 'enabled' : 'pending'}`}>
            {currentUser?.two_factor_enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div className="actions-row" style={{ marginBottom: 16 }}>
          <button className="btn btn-secondary" type="button" onClick={() => setWorkspaceSection('dashboard')}>
            Back to dashboard
          </button>
        </div>

        <p className="lede security-copy">
          Two-factor authentication protects your account with a time-based code from an authenticator app. It adds a second check after your password.
        </p>

        <div className="feature-grid security-summaries">
          <div className="feature-card static-card">
            <strong>Status</strong>
            <span>{currentUser?.two_factor_enabled ? 'Your account requires a code after password sign-in.' : 'Your account still uses password-only sign-in.'}</span>
          </div>
          <div className="feature-card static-card">
            <strong>Recommended app</strong>
            <span>Microsoft Authenticator, Google Authenticator, Authy, or any TOTP-compatible app.</span>
          </div>
          <div className="feature-card static-card">
            <strong>Recovery</strong>
            <span>If you change phones, disable 2FA here using your password, then set it up again on the new device.</span>
          </div>
        </div>

        <div className="actions-row security-actions">
          <button className="btn btn-primary" type="button" onClick={refreshSetup} disabled={busy || currentUser?.two_factor_enabled}>
            {busy ? 'Loading...' : 'Generate setup QR'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setSetupState(null)}>
            Clear setup
          </button>
        </div>

        {setupState?.qrCodeDataUrl && (
          <div className="setup-panel">
            <div className="setup-qr">
              <img src={setupState.qrCodeDataUrl} alt="Two-factor setup QR code" />
            </div>
            <div className="setup-copy">
              <p className="eyebrow">Scan code</p>
              <h3>Connect your authenticator</h3>
              <p className="muted">If the QR code is not available, enter this setup key manually in your authenticator app.</p>
              <div className="secret-box">{setupState.secret}</div>
              <p className="theme-note">Account label: {setupState.label}</p>
            </div>
          </div>
        )}

        {setupState?.secret && !currentUser?.two_factor_enabled && (
          <form className="stack-form security-form" onSubmit={handleEnable}>
            <div className="field-grid two-up">
              <div className="field">
                <label htmlFor="setupCode">Authenticator code</label>
                <input
                  id="setupCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                  placeholder="123456"
                />
              </div>
              <div className="field code-helper">
                <label>Confirm</label>
                <div className="helper-pill">Enter the current 6-digit code to activate 2FA.</div>
              </div>
            </div>

            <div className="actions-row">
              <button className="btn btn-primary" type="submit" disabled={busy}>Enable 2FA</button>
            </div>
          </form>
        )}

        {currentUser?.two_factor_enabled && (
          <form className="stack-form security-form" onSubmit={handleDisable}>
            <div className="field-grid two-up">
              <div className="field">
                <label htmlFor="disablePassword">Password</label>
                <input
                  id="disablePassword"
                  type="password"
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                  placeholder="Confirm your password"
                />
              </div>
              <div className="field code-helper">
                <label>Disable 2FA</label>
                <div className="helper-pill danger">Turning this off returns the account to password-only sign-in.</div>
              </div>
            </div>

            <div className="actions-row">
              <button className="btn btn-secondary" type="submit" disabled={busy}>Disable 2FA</button>
            </div>
          </form>
        )}

        <div className="notice">{message}</div>
      </article>

      <aside className="card page-card sticky-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Quick view</p>
            <h2>Account snapshot</h2>
          </div>
        </div>

        <div className="mini-grid">
          <div className="mini-card">
            <span>User</span>
            <strong>{currentUser?.name}</strong>
          </div>
          <div className="mini-card">
            <span>Role</span>
            <strong>{currentUser?.role}</strong>
          </div>
          <div className="mini-card wide-card">
            <span>Security mode</span>
            <strong>{currentUser?.two_factor_enabled ? 'Password + authenticator code' : 'Password only'}</strong>
          </div>
        </div>
      </aside>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section className="card page-card notice-card">
      <p className="eyebrow">404</p>
      <h2>Page not found</h2>
      <p className="muted">Use the navigation to go back to the dashboard or security settings.</p>
    </section>
  );
}

function AccessDeniedPage() {
  const navigate = useNavigate();

  return (
    <main className="shell auth-shell">
      <section className="card notice-card access-denied-card">
        <p className="eyebrow">Access denied</p>
        <h1>You do not have permission to open that area.</h1>
        <p className="lede">Sign in with the correct role, or return to the dashboard for your allowed actions.</p>
        <div className="actions-row">
          <button className="btn btn-primary" type="button" onClick={() => navigate('/dashboard')}>Go to dashboard</button>
          <button className="btn btn-secondary" type="button" onClick={() => navigate('/login')}>Back to login</button>
        </div>
      </section>
    </main>
  );
}

function SignUpPage() {
  const navigate = useNavigate();
  const { apiBase } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, email, password, role: 'TA' };

      const resp = await fetch(`${apiBase}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Registration failed');
      setMessage('Registration successful — please sign in.');
      setTimeout(() => navigate('/login', { replace: true }), 900);
    } catch (err) {
      setMessage(err.message || 'Registration error');
    } finally { setBusy(false); }
  };

  return (
    <main className="shell">
      <section className="card auth-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create account</p>
            <h2>Sign up</h2>
          </div>
          <p className="muted">New accounts register as `TA` by default. Admins create Faculty and Admin users from the dashboard.</p>
        </div>

        <form className="stack-form" onSubmit={handleRegister}>
          <div className="field">
            <label htmlFor="signupName">Full name</label>
            <input id="signupName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signupEmail">Email</label>
            <input id="signupEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="signupRole">Role</label>
            <input id="signupRole" value="TA" readOnly />
          </div>
          <div className="field">
            <label htmlFor="signupPassword">Password</label>
            <input id="signupPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div className="actions-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
            <button className="btn btn-secondary" type="button" onClick={() => navigate('/login')}>Back to login</button>
          </div>
        </form>

        <div className="notice">{message}</div>
      </section>
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/access-denied" element={<AccessDeniedPage />} />
      <Route
        path="/dashboard"
        element={(
          <ProtectedRoute>
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          </ProtectedRoute>
        )}
      />
      <Route
        path="/claims"
        element={(
          <ProtectedRoute>
            <AppLayout>
              <ClaimsPage />
            </AppLayout>
          </ProtectedRoute>
        )}
      />
      <Route
        path="/review"
        element={(
          <ProtectedRoute roles={["Faculty", "Admin"]}>
            <AppLayout>
              <ReviewQueuePage />
            </AppLayout>
          </ProtectedRoute>
        )}
      />
      <Route
        path="/security"
        element={(
          <ProtectedRoute>
            <AppLayout>
              <SecurityPage />
            </AppLayout>
          </ProtectedRoute>
        )}
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </HashRouter>
  );
}
