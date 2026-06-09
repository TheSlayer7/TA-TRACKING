const assert = require('assert');
const { calculateAdmissibleTA } = require('../src/lib/taPolicy');

function approx(a, b, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

try {
  // Test 1: Air class entitlement warning for low pay level
  const claim1 = {
    journeyDetails: { segments: [{ mode: 'air', fare: 20000, travelClass: 'business' }] },
    accommodation: { required: false },
    dailyAllowance: { required: false },
    localTravel: { required: false }
  };
  const res1 = calculateAdmissibleTA(claim1, 6); // payLevel 6 -> economy only
  assert(res1.warnings.length >= 1, 'Expected warning for air class entitlement');

  // Test 2: Own vehicle without approval should warn and use mileage
  const claim2 = {
    journeyDetails: { segments: [{ mode: 'ownVehicle', distance: 100 }] },
    accommodation: { required: false },
    dailyAllowance: { required: false },
    localTravel: { required: false }
  };
  const res2 = calculateAdmissibleTA(claim2, 8);
  assert(res2.warnings.length >= 1, 'Expected warning for own vehicle approval');
  assert(approx(res2.totalAdmissible, 100 * 16), 'Mileage calculation mismatch');

  // Test 3: Daily allowance suppressed when food provided
  const claim3 = {
    journeyDetails: { segments: [] },
    accommodation: { required: false },
    dailyAllowance: { required: true, days: 2, absenceHours: 10, foodProvided: true },
    localTravel: { required: false }
  };
  const res3 = calculateAdmissibleTA(claim3, 9);
  assert(res3.warnings.some(w => w.toLowerCase().includes('daily allowance')), 'Expected DA warning when food provided');

  // Test 4: Hotel admissible + GST cap
  const claim4 = {
    journeyDetails: { segments: [] },
    accommodation: { required: true, nights: 2, actualRoomCharges: 20000, gstRate: 12 },
    dailyAllowance: { required: false },
    localTravel: { required: false }
  };
  const res4 = calculateAdmissibleTA(claim4, 14); // level14+ high ceiling
  // admissible per night for level14plus is defined; ensure total <= actual
  assert(res4.totalAdmissible <= 20000 + 2400, 'Hotel admissible exceeds actual+GST');

  console.log('All TA policy tests passed.');
  process.exit(0);
} catch (err) {
  console.error('Tests failed:', err.message || err);
  console.error(err.stack);
  process.exit(1);
}
