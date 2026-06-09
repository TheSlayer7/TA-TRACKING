// Shared TA policy (frontend) — used for client-side estimates
export const taRates = {
  dailyAllowance: {
    level1to5: 625,
    level6to8: 1000,
    level9to11: 1125,
    level12to13: 1250,
    level14plus: 1500
  },
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
  mileageRate: { ownVehicle: 16 }
};

export const getEmployeeClass = (level) => {
  if (level <= 5) return 'level1to5';
  if (level <= 8) return 'level6to8';
  if (level <= 11) return 'level9to11';
  if (level <= 13) return 'level12to13';
  return 'level14plus';
};

export const getJourneyEntitlements = {
  level14plus: { air: ['business', 'club'], rail: ['ac1'] },
  level12to13: { air: ['economy'], rail: ['ac1'] },
  level6to8: { air: ['economy'], rail: ['ac2'] },
  level9to11: { air: ['economy'], rail: ['ac2'] },
  level1to5: { air: ['special-approval'], rail: ['first', 'ac3', 'ac-chair-car'] }
};

export const normalizeTravelClass = (value) => String(value || '').trim().toLowerCase();

export const getDailyAllowanceFactor = (absenceHours) => {
  if (absenceHours < 6) return 0.3;
  if (absenceHours <= 12) return 0.7;
  return 1;
};

export function estimateClaim(payload, payLevel) {
  const employeeClass = getEmployeeClass(Number(payLevel || 0));
  const journeyEnts = getJourneyEntitlements[employeeClass];
  const warnings = [];
  let total = 0;

  (payload.journeyDetails?.segments || []).forEach((segment) => {
    const claimedFare = Number(segment.fare || 0);
    let segmentAmount = 0;
    const segmentMode = String(segment.mode || '').trim().toLowerCase();
    const segmentClass = normalizeTravelClass(segment.travelClass || segment.classType || segment.ticketClass || '');

    if (segmentMode === 'taxi' || segmentMode === 'road') {
      if (segment.location === 'calicutAirport') {
        segmentAmount = Math.min(claimedFare, taRates.taxiCeilings.calicutAirport);
      } else if (segment.location === 'calicutRailway') {
        segmentAmount = Math.min(claimedFare, taRates.taxiCeilings.calicutRailway);
      } else {
        const distance = Number(segment.distance || 0);
        const isKerala = segment.state === 'kerala';
        const isAuto = segment.vehicleType === 'auto';
        let rate = taRates.taxiCeilings.otherStatesPerKm;
        if (isKerala) rate = isAuto ? taRates.taxiCeilings.keralaAutoPerKm : taRates.taxiCeilings.keralaPerKm;
        segmentAmount = Math.min(claimedFare, distance * rate);
      }
    } else if (segmentMode === 'ownvehicle') {
      const distance = Number(segment.distance || 0);
      segmentAmount = distance * taRates.mileageRate.ownVehicle;
      if (!segment.approved && !segment.priorApproval && !payload.approvals?.ownVehicleApproved) {
        warnings.push('Own vehicle travel requires prior approval from the competent authority.');
      }
    } else {
      if (segmentMode === 'air' && segmentClass && !journeyEnts.air.includes(segmentClass)) {
        warnings.push(`Selected air travel class '${segment.travelClass || segment.classType || segment.ticketClass}' is outside the entitlement for this pay level.`);
      }
      if (segmentMode === 'air' && !segment.approved && !segment.specialApproval && !payload.approvals?.airTravelApproved) {
        warnings.push('Air travel for this pay level requires special approval.');
      }
      if (segmentMode === 'rail' && segmentClass && !journeyEnts.rail.includes(segmentClass)) {
        warnings.push(`Selected rail travel class '${segment.travelClass || segment.classType || segment.ticketClass}' is outside the entitlement for this pay level.`);
      }
      segmentAmount = claimedFare;
    }

    total += segmentAmount;
  });

  if (payload.accommodation?.required) {
    const nights = Number(payload.accommodation.nights || 0);
    const actualCharges = Number(payload.accommodation.actualRoomCharges || 0);
    const gstRate = Number(payload.accommodation.gstRate || 0);
    const eligibleTotal = nights * taRates.hotelCeiling[getEmployeeClass(payLevel)];
    const admissibleRoom = Math.min(actualCharges, eligibleTotal);
    const admissibleGst = (admissibleRoom * gstRate) / 100;
    total += admissibleRoom + admissibleGst;
  }

  if (payload.dailyAllowance?.required) {
    const days = Number(payload.dailyAllowance.days || 1);
    const absenceHours = Number(payload.dailyAllowance.absenceHours || 0);
    const foodProvided = Boolean(payload.dailyAllowance.foodProvided);
    const daFactor = getDailyAllowanceFactor(absenceHours);
    if (foodProvided) warnings.push('No daily allowance is admissible for days where food is provided.'); else total += days * (taRates.dailyAllowance[getEmployeeClass(payLevel)] || 0) * daFactor;
  }

  if (payload.localTravel?.required) {
    const days = Number(payload.localTravel.days || 0);
    const actualCharges = Number(payload.localTravel.actualCharges || 0);
    const kilometers = Number(payload.localTravel.kilometers || 0);
    if (payLevel <= 11) total += days * taRates.localTravel[getEmployeeClass(payLevel)]; else if (payLevel <= 13) total += kilometers > 50 ? (actualCharges / kilometers) * 50 : actualCharges; else total += actualCharges;
  }

  return { totalAdmissible: Number(total.toFixed(2)), warnings };
}

export default estimateClaim;
