import { useEffect, useMemo, useState } from 'react';

const storageKey = 'ta-portal-prefs';
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

function escapeString(value) {
  return String(value ?? '');
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
}

function estimateClaim(payload, payLevel) {
  const rates = {
    hotelCeiling: {
      level1to5: 563,
      level6to8: 938,
      level9to11: 2813,
      level12to13: 5625,
      level14plus: 9375
    },
    localTravel: {
      level1to5: 141,
      level6to8: 281,
      level9to11: 423
    },
    taxiCeilings: {
      calicutAirport: 1500,
      calicutRailway: 1200,
      keralaPerKm: 18,
      keralaAutoPerKm: 15,
      otherStatesPerKm: 30
    },
    mileageRate: {
      ownVehicle: 16
    }
  };

  const getEmployeeClass = (level) => {
    if (level <= 5) return 'level1to5';
    if (level <= 8) return 'level6to8';
    if (level <= 11) return 'level9to11';
    if (level <= 13) return 'level12to13';
    return 'level14plus';
  };

  const employeeClass = getEmployeeClass(Number(payLevel || 0));
  let total = 0;

  (payload.journeyDetails?.segments || []).forEach((segment) => {
    const claimedFare = Number(segment.fare || 0);
    let segmentAmount = 0;

    if (segment.mode === 'taxi' || segment.mode === 'road') {
      if (segment.location === 'calicutAirport') {
        segmentAmount = Math.min(claimedFare, rates.taxiCeilings.calicutAirport);
      } else if (segment.location === 'calicutRailway') {
        segmentAmount = Math.min(claimedFare, rates.taxiCeilings.calicutRailway);
      } else {
        const distance = Number(segment.distance || 0);
        const isKerala = segment.state === 'kerala';
        const isAuto = segment.vehicleType === 'auto';
        let rate = rates.taxiCeilings.otherStatesPerKm;

        if (isKerala) {
          rate = isAuto ? rates.taxiCeilings.keralaAutoPerKm : rates.taxiCeilings.keralaPerKm;
        }

        segmentAmount = Math.min(claimedFare, distance * rate);
      }
    } else if (segment.mode === 'ownVehicle') {
      const distance = Number(segment.distance || 0);
      segmentAmount = distance * rates.mileageRate.ownVehicle;
    } else {
      segmentAmount = claimedFare;
    }

    total += segmentAmount;
  });

  if (payload.accommodation?.required) {
    const nights = Number(payload.accommodation.nights || 0);
    const actualCharges = Number(payload.accommodation.actualRoomCharges || 0);
    const gstRate = Number(payload.accommodation.gstRate || 0);
    const eligibleTotal = nights * rates.hotelCeiling[employeeClass];
    const admissibleRoom = Math.min(actualCharges, eligibleTotal);
    const admissibleGst = (admissibleRoom * gstRate) / 100;
    total += admissibleRoom + admissibleGst;
  }

  if (payload.localTravel?.required) {
    const days = Number(payload.localTravel.days || 0);
    const actualCharges = Number(payload.localTravel.actualCharges || 0);
    const kilometers = Number(payload.localTravel.kilometers || 0);

    if (payLevel <= 11) {
      total += days * rates.localTravel[employeeClass];
    } else if (payLevel <= 13) {
      total += kilometers > 50 ? (actualCharges / kilometers) * 50 : actualCharges;
    } else {
      total += actualCharges;
    }
  }

  return Number(total.toFixed(2));
}

export default function App() {
  const savedPrefs = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
      return {};
    }
  }, []);

  const [apiBase, setApiBase] = useState(normalizeApiBase(savedPrefs.apiBase || defaultApiBase));
  const [token, setToken] = useState(savedPrefs.token || '');
  const [currentUser, setCurrentUser] = useState(savedPrefs.user || null);
  const [route, setRoute] = useState(savedPrefs.route || (savedPrefs.token ? 'dashboard' : 'login'));
  const [theme, setTheme] = useState(savedPrefs.theme || 'light');
  const [loginEmail, setLoginEmail] = useState('employee@siteimade.local');
  const [loginPassword, setLoginPassword] = useState('Password123!');
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
  const [otherCharges, setOtherCharges] = useState(750);
  const [remarks, setRemarks] = useState('');
  const [health, setHealth] = useState({ state: 'idle', label: 'Checking backend...', text: 'Pinging the API to confirm it is online.' });
  const [pendingClaims, setPendingClaims] = useState([]);
  const [queueMessage, setQueueMessage] = useState('Waiting for load');
  const [apiOutput, setApiOutput] = useState('Ready.');

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ apiBase: normalizeApiBase(apiBase), token, user: currentUser, route, theme }));
  }, [apiBase, token, currentUser, route, theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const apiRoot = normalizeApiBase(apiBase);

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

    return { error: 'Server returned HTML instead of JSON. Check that the backend is running on port 5000.', raw: bodyText.slice(0, 200) };
  };

  const syncSessionFromToken = async (nextToken = token) => {
    const trimmedToken = String(nextToken || '').trim();

    if (!trimmedToken) {
      setCurrentUser(null);
      return;
    }

    try {
      const response = await fetch(`${apiRoot}/auth/me`, {
        headers: {
          Authorization: `Bearer ${trimmedToken}`
        }
      });

      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data.error || 'Session validation failed');
      }

      setCurrentUser(data.user);
    } catch (error) {
      setCurrentUser(null);
      setToken('');
      saveOutput({ error: error.message });
    }
  };

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
    otherCharges: {
      amount: Number(otherCharges),
      notes: remarks
    }
  }), [journeyType, segments, accommodationRequired, hotelNights, hotelCharge, gstRate, localTravelRequired, localDays, localKm, localCharge, otherCharges, remarks]);

  const estimatedAdmissible = useMemo(() => estimateClaim(payload, payLevel), [payload, payLevel]);

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

  const login = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${apiRoot}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });

      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(data.error || `Login failed with status ${response.status}`);
      }

      setToken(data.token);
      setCurrentUser(data.user);
      setRoute('dashboard');
      setLoginPassword('');
      saveOutput(data);
    } catch (error) {
      saveOutput({ error: error.message });
    }
  };

  const saveOutput = (value) => {
    setApiOutput(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
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
      saveOutput(data);
    } catch (error) {
      setHealth({ state: 'error', label: 'Backend offline', text: `${error.message} Start the backend with npm run dev in the backend folder.` });
      saveOutput({ error: error.message });
    }
  };

  const updateSegment = (index, field, value) => {
    setSegments((current) => current.map((segment, segmentIndex) => (
      segmentIndex === index ? { ...segment, [field]: value } : segment
    )));
  };

  const addSegment = () => setSegments((current) => [...current, newSegment()]);
  const removeSegment = (index) => setSegments((current) => current.length > 1 ? current.filter((_, segmentIndex) => segmentIndex !== index) : current);
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
      await loadPendingClaims();
    } catch (error) {
      saveOutput({ error: error.message });
    }
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
    checkHealth();
  }, []);

  useEffect(() => {
    syncSessionFromToken(token);
  }, []);

  const handleLogout = () => {
    setToken('');
    setCurrentUser(null);
    setRoute('login');
    localStorage.removeItem(storageKey);
  };

  const Nav = () => (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
      <div>
        <strong style={{ fontSize: 18 }}>TA Portal</strong>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>7th CPC TA Workflow</div>
      </div>
      <nav style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="link-button" type="button" onClick={() => setRoute('dashboard')}>Dashboard</button>
        <button className="link-button" type="button" onClick={() => setRoute('login')}>Login</button>
        <button className="link-button" type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
        {currentUser ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>{currentUser.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{currentUser.role}</div>
            </div>
            <button className="btn btn-secondary" type="button" onClick={handleLogout}>Sign out</button>
          </div>
        ) : null}
      </nav>
    </header>
  );

  const LoginPanel = () => (
    <section className="card auth" style={{ padding: 20, maxWidth: 720, margin: '0 auto' }}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">Authentication</p>
          <h2>Sign in</h2>
        </div>
        <p className="muted">Use one of the seeded PostgreSQL accounts. The backend signs the token after password verification.</p>
      </div>
      <form className="auth-grid" onSubmit={login} style={{ display: 'grid', gap: 12 }}>
        <div className="field">
          <label htmlFor="loginEmail">Email</label>
          <input id="loginEmail" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="loginPassword">Password</label>
          <input id="loginPassword" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary">Sign in</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setLoginEmail('employee@siteimade.local'); setLoginPassword('Password123!'); }}>Fill demo creds</button>
        </div>
      </form>
    </section>
  );

  return (
    <main className="shell">
      <div className="bg-orb bg-orb-one" />
      <div className="bg-orb bg-orb-two" />
      <Nav />

      {route === 'login' || !token || !currentUser ? (
        <LoginPanel />
      ) : (
        <>
          <section className="hero card">
            <div className="hero-copy">
              <p className="eyebrow">7th CPC TA Workflow</p>
              <h1>Travel allowance claims, built for speed and review.</h1>
              <p className="lede">
                Submit a claim, check the API health, and review pending claims from a polished React interface.
                The UI talks to <span>{escapeString(apiRoot)}</span> by default.
              </p>
              <div className="hero-actions">
                <button className="btn btn-primary" type="button" onClick={() => document.getElementById('claim-panel')?.scrollIntoView({ behavior: 'smooth' })}>Start a Claim</button>
                <button className="btn btn-secondary" type="button" onClick={() => document.getElementById('admin-panel')?.scrollIntoView({ behavior: 'smooth' })}>Open Review Queue</button>
              </div>
            </div>

            <aside className="hero-panel">
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
                  <strong>{apiRoot}</strong>
                </div>
                <div className="mini-card">
                  <span>Saved Token</span>
                  <strong>{currentUser ? `${currentUser.role} session` : 'Not set'}</strong>
                </div>
              </div>
            </aside>
          </section>

          <section className="toolbar card">
            <div className="toolbar-group">
              <label htmlFor="apiBase">API Base URL</label>
              <input id="apiBase" type="text" value={apiBase} onChange={(event) => setApiBase(event.target.value)} spellCheck="false" />
            </div>
            <div className="toolbar-group grow">
              <label htmlFor="jwtToken">JWT Token</label>
              <input id="jwtToken" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste a bearer token with user or Accounts role" spellCheck="false" />
            </div>
            <div className="toolbar-group actions">
              <button className="btn btn-secondary" type="button" onClick={() => saveOutput({ saved: true, apiBase })}>Save</button>
              <button className="btn btn-primary" type="button" onClick={loadPendingClaims}>Load Pending Claims</button>
            </div>
          </section>
        </>
      )}

      <section className="grid-layout">
        <article className="card panel" id="claim-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Claim Builder</p>
              <h2>Submit a travel claim</h2>
            </div>
            <p className="muted">The server recalculates the admissible amount from the payload and JWT-derived pay level.</p>
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
                  </div>
                ))}
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

        <article className="card panel" id="admin-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Accounts Review</p>
              <h2>Pending claims queue</h2>
            </div>
            <p className="muted">This section uses the Accounts role token to fetch and verify pending claims.</p>
          </div>
          {currentUser && (currentUser.role === 'Accounts' || currentUser.role === 'Admin') ? (
            <>
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
                    <div className="actions">
                      <button type="button" className="btn btn-primary" onClick={() => verifyClaim(item.id, 'Approved')}>Approve</button>
                      <button type="button" className="btn btn-secondary" onClick={() => verifyClaim(item.id, 'Rejected')}>Reject</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state" style={{ padding: 20 }}>
              <p style={{ margin: 0 }}>Accounts-only area. Sign in with an Accounts or Admin role to view pending claims and perform approvals.</p>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" type="button" onClick={() => setRoute('login')}>Sign in</button>
                <button className="btn btn-secondary" type="button" onClick={() => saveOutput({ info: 'Need Accounts role token' })}>How to get token</button>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="card output-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Response Console</p>
            <h2>Latest API result</h2>
          </div>
          <button className="link-button" type="button" onClick={() => setApiOutput('Ready.')}>Clear</button>
        </div>
        <div className="estimate-row">
          <span>Frontend admissible estimate</span>
          <strong>{formatCurrency(estimatedAdmissible)}</strong>
        </div>
        <pre className="api-output">{apiOutput}</pre>
      </section>
    </main>
  );
}
