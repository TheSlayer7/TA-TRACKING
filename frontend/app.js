const state = {
  apiBase: 'http://localhost:5000/api',
  token: '',
  segments: []
};

const els = {
  apiBase: document.getElementById('apiBase'),
  jwtToken: document.getElementById('jwtToken'),
  apiBasePreview: document.getElementById('apiBasePreview'),
  tokenPreview: document.getElementById('tokenPreview'),
  healthDot: document.getElementById('healthDot'),
  healthLabel: document.getElementById('healthLabel'),
  healthText: document.getElementById('healthText'),
  checkHealthBtn: document.getElementById('checkHealthBtn'),
  savePrefsBtn: document.getElementById('savePrefsBtn'),
  loadPendingBtn: document.getElementById('loadPendingBtn'),
  claimForm: document.getElementById('claimForm'),
  addSegmentBtn: document.getElementById('addSegmentBtn'),
  segmentsList: document.getElementById('segmentsList'),
  loadExampleBtn: document.getElementById('loadExampleBtn'),
  pendingClaims: document.getElementById('pendingClaims'),
  pendingSummary: document.getElementById('pendingSummary'),
  apiOutput: document.getElementById('apiOutput'),
  clearOutputBtn: document.getElementById('clearOutputBtn')
};

const savedPrefs = JSON.parse(localStorage.getItem('taFrontendPrefs') || '{}');
state.apiBase = savedPrefs.apiBase || state.apiBase;
state.token = savedPrefs.token || '';

els.apiBase.value = state.apiBase;
els.jwtToken.value = state.token;
els.apiBasePreview.textContent = state.apiBase;
els.tokenPreview.textContent = state.token ? `${state.token.slice(0, 16)}...` : 'Not set';

function writeOutput(value) {
  if (typeof value === 'string') {
    els.apiOutput.textContent = value;
    return;
  }

  els.apiOutput.textContent = JSON.stringify(value, null, 2);
}

function updatePrefsPreview() {
  els.apiBasePreview.textContent = state.apiBase;
  els.tokenPreview.textContent = state.token ? `${state.token.slice(0, 16)}...` : 'Not set';
}

function savePrefs() {
  state.apiBase = els.apiBase.value.trim() || 'http://localhost:5000/api';
  state.token = els.jwtToken.value.trim();
  localStorage.setItem('taFrontendPrefs', JSON.stringify({ apiBase: state.apiBase, token: state.token }));
  updatePrefsPreview();
}

function headers(includeJson = true) {
  const result = {};
  if (includeJson) {
    result['Content-Type'] = 'application/json';
  }

  if (state.token) {
    result.Authorization = `Bearer ${state.token}`;
  }

  return result;
}

function setHealthState(kind, label, text) {
  els.healthDot.className = `status-dot ${kind}`.trim();
  els.healthLabel.textContent = label;
  els.healthText.textContent = text;
}

async function checkHealth() {
  savePrefs();

  try {
    const response = await fetch(`${state.apiBase}/health`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Health check failed');
    }

    setHealthState('ok', 'Backend online', payload.message || 'API is reachable.');
    writeOutput(payload);
  } catch (error) {
    setHealthState('bad', 'Backend offline', error.message);
    writeOutput({ error: error.message });
  }
}

function segmentMarkup() {
  const template = document.getElementById('segmentTemplate');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.segment-card');

  card.querySelector('.remove-segment-btn').addEventListener('click', () => {
    card.remove();
    refreshSegmentLabels();
    if (!els.segmentsList.children.length) {
      addSegment();
    }
  });

  card.querySelectorAll('input, select').forEach((control) => {
    control.addEventListener('input', updatePendingBadgeHints);
  });

  return clone;
}

function refreshSegmentLabels() {
  [...els.segmentsList.querySelectorAll('.segment-card strong')].forEach((label, index) => {
    label.textContent = `Segment ${index + 1}`;
  });
}

function addSegment(defaults = {}) {
  const fragment = segmentMarkup();
  const card = fragment.querySelector('.segment-card');

  const setField = (field, value) => {
    const control = card.querySelector(`[data-field="${field}"]`);
    if (control && value !== undefined) {
      control.value = value;
    }
  };

  setField('mode', defaults.mode ?? 'taxi');
  setField('fare', defaults.fare ?? 0);
  setField('distance', defaults.distance ?? 0);
  setField('location', defaults.location ?? '');
  setField('state', defaults.state ?? '');
  setField('vehicleType', defaults.vehicleType ?? 'car');
  setField('description', defaults.description ?? '');

  els.segmentsList.appendChild(fragment);
  refreshSegmentLabels();
}

function collectSegments() {
  return [...els.segmentsList.querySelectorAll('.segment-card')].map((card) => ({
    mode: card.querySelector('[data-field="mode"]').value,
    fare: Number(card.querySelector('[data-field="fare"]').value || 0),
    distance: Number(card.querySelector('[data-field="distance"]').value || 0),
    location: card.querySelector('[data-field="location"]').value,
    state: card.querySelector('[data-field="state"]').value,
    vehicleType: card.querySelector('[data-field="vehicleType"]').value,
    description: card.querySelector('[data-field="description"]').value.trim()
  }));
}

function buildClaimPayload() {
  return {
    journeyDetails: {
      journeyType: document.getElementById('journeyType').value,
      segments: collectSegments()
    },
    accommodation: {
      required: document.getElementById('accommodationRequired').checked,
      nights: Number(document.getElementById('hotelNights').value || 0),
      actualRoomCharges: Number(document.getElementById('hotelCharge').value || 0),
      gstRate: Number(document.getElementById('gstRate').value || 0)
    },
    localTravel: {
      required: document.getElementById('localTravelRequired').checked,
      days: Number(document.getElementById('localDays').value || 0),
      kilometers: Number(document.getElementById('localKm').value || 0),
      actualCharges: Number(document.getElementById('localCharge').value || 0)
    },
    otherCharges: {
      amount: Number(document.getElementById('otherCharges').value || 0),
      notes: document.getElementById('remarks').value.trim()
    }
  };
}

function loadExampleData() {
  document.getElementById('journeyType').value = 'tour';
  document.getElementById('employeePayLevel').value = 8;
  document.getElementById('accommodationRequired').checked = true;
  document.getElementById('hotelNights').value = 2;
  document.getElementById('hotelCharge').value = 4200;
  document.getElementById('gstRate').value = 12;
  document.getElementById('localTravelRequired').checked = true;
  document.getElementById('localDays').value = 2;
  document.getElementById('localKm').value = 46;
  document.getElementById('localCharge').value = 950;
  document.getElementById('otherCharges').value = 750;
  document.getElementById('remarks').value = 'Sample data for testing the claim flow.';

  els.segmentsList.innerHTML = '';
  addSegment({
    mode: 'taxi',
    fare: 850,
    distance: 46,
    location: 'calicutAirport',
    state: 'kerala',
    vehicleType: 'car',
    description: 'Airport pickup'
  });
  addSegment({
    mode: 'rail',
    fare: 1240,
    distance: 0,
    location: '',
    state: 'other',
    vehicleType: 'car',
    description: 'Train from headquarters'
  });
}

function updatePendingBadgeHints() {
  const totalSegments = els.segmentsList.querySelectorAll('.segment-card').length;
  document.querySelector('[data-scroll-to="admin-panel"]').textContent = totalSegments > 1 ? 'Open Review Queue' : 'Open Review Queue';
}

async function submitClaim(event) {
  event.preventDefault();
  savePrefs();

  try {
    const response = await fetch(`${state.apiBase}/claims/submit`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildClaimPayload())
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Claim submission failed');
    }

    writeOutput(payload);
    await loadPendingClaims();
  } catch (error) {
    writeOutput({ error: error.message });
  }
}

async function loadPendingClaims() {
  savePrefs();

  try {
    const response = await fetch(`${state.apiBase}/claims/pending`, {
      headers: headers(false)
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Could not load pending claims');
    }

    renderPendingClaims(payload);
    const count = payload.length;
    els.pendingSummary.innerHTML = `<span>Queue status</span><strong>${count} pending claim${count === 1 ? '' : 's'}</strong>`;
    writeOutput({ loadedPendingClaims: count });
  } catch (error) {
    els.pendingSummary.innerHTML = `<span>Queue status</span><strong>Unavailable</strong>`;
    els.pendingClaims.innerHTML = `<div class="empty-state"><p>${error.message}</p></div>`;
    writeOutput({ error: error.message });
  }
}

async function verifyClaim(id, status, remarks = '') {
  savePrefs();

  try {
    const response = await fetch(`${state.apiBase}/claims/${id}/verify`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ status, remarks })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Verification failed');
    }

    writeOutput(payload);
    await loadPendingClaims();
  } catch (error) {
    writeOutput({ error: error.message });
  }
}

function renderPendingClaims(items) {
  if (!items.length) {
    els.pendingClaims.className = 'pending-list empty-state';
    els.pendingClaims.innerHTML = '<p>No pending claims right now.</p>';
    return;
  }

  els.pendingClaims.className = 'pending-list';
  els.pendingClaims.innerHTML = items.map((item) => {
    const statusClass = String(item.status || 'Pending').toLowerCase();
    return `
      <article class="pending-item">
        <div class="topline">
          <div>
            <h3>${escapeHtml(item.name || 'Unknown User')}</h3>
            <p class="meta">${escapeHtml(item.department || 'No department')} · Pay Level ${escapeHtml(String(item.pay_level ?? '-'))}</p>
          </div>
          <span class="badge ${statusClass}">${escapeHtml(item.status || 'Pending')}</span>
        </div>
        <div class="field-grid two-up">
          <div>
            <span class="meta">Journey Type</span>
            <strong>${escapeHtml(item.journey_type || 'tour')}</strong>
          </div>
          <div>
            <span class="meta">Admissible Amount</span>
            <strong>${formatCurrency(item.admissible_amount)}</strong>
          </div>
          <div>
            <span class="meta">Claim ID</span>
            <strong>#${escapeHtml(String(item.id))}</strong>
          </div>
          <div>
            <span class="meta">Claim Date</span>
            <strong>${escapeHtml(item.claim_date ? new Date(item.claim_date).toLocaleString() : 'N/A')}</strong>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" data-verify="approve">Approve</button>
          <button type="button" class="btn btn-secondary" data-verify="reject">Reject</button>
        </div>
      </article>
    `;
  }).join('');

  [...els.pendingClaims.querySelectorAll('.pending-item')].forEach((card, index) => {
    const item = items[index];
    card.querySelector('[data-verify="approve"]').addEventListener('click', () => {
      const remarks = prompt(`Approve claim #${item.id}. Optional remarks:`) || '';
      verifyClaim(item.id, 'Approved', remarks);
    });
    card.querySelector('[data-verify="reject"]').addEventListener('click', () => {
      const remarks = prompt(`Reject claim #${item.id}. Optional remarks:`) || '';
      verifyClaim(item.id, 'Rejected', remarks);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
}

els.checkHealthBtn.addEventListener('click', checkHealth);
els.savePrefsBtn.addEventListener('click', () => {
  savePrefs();
  writeOutput({ saved: true, apiBase: state.apiBase });
});
els.loadPendingBtn.addEventListener('click', loadPendingClaims);
els.claimForm.addEventListener('submit', submitClaim);
els.addSegmentBtn.addEventListener('click', () => addSegment());
els.loadExampleBtn.addEventListener('click', loadExampleData);
els.clearOutputBtn.addEventListener('click', () => writeOutput('Ready.'));

[els.apiBase, els.jwtToken].forEach((input) => {
  input.addEventListener('change', () => {
    savePrefs();
    updatePrefsPreview();
  });
});

document.querySelectorAll('[data-scroll-to]').forEach((button) => {
  button.addEventListener('click', () => {
    document.getElementById(button.dataset.scrollTo).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

addSegment({
  mode: 'taxi',
  fare: 850,
  distance: 46,
  location: 'calicutAirport',
  state: 'kerala',
  vehicleType: 'car',
  description: 'Airport transfer'
});

addSegment({
  mode: 'rail',
  fare: 1240,
  distance: 0,
  location: '',
  state: 'other',
  vehicleType: 'car',
  description: 'Rail segment'
});

checkHealth();
