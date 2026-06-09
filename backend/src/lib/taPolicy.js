// Shared TA policy (backend) — implements 7th CPC rules and warnings
const taRates = {
    dailyAllowance: {
        'level1to5': 625,
        'level6to8': 1000,
        'level9to11': 1125,
        'level12to13': 1250,
        'level14plus': 1500
    },
    hotelCeiling: {
        'level1to5': 563,
        'level6to8': 938,
        'level9to11': 2813,
        'level12to13': 5625,
        'level14plus': 9375
    },
    localTravel: {
        'level1to5': 141,
        'level6to8': 281,
        'level9to11': 423
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

const getEmployeeClass = (payLevel) => {
    if (payLevel <= 5) return 'level1to5';
    if (payLevel <= 8) return 'level6to8';
    if (payLevel <= 11) return 'level9to11';
    if (payLevel <= 13) return 'level12to13';
    return 'level14plus';
};

const getJourneyEntitlements = (empClass) => {
    if (empClass === 'level14plus') {
        return { air: ['business', 'club'], rail: ['ac1'] };
    }

    if (empClass === 'level12to13') {
        return { air: ['economy'], rail: ['ac1'] };
    }

    if (empClass === 'level6to8' || empClass === 'level9to11') {
        return { air: ['economy'], rail: ['ac2'] };
    }

    return { air: ['special-approval'], rail: ['first', 'ac3', 'ac-chair-car'] };
};

const normalizeTravelClass = (value) => String(value || '').trim().toLowerCase();

const getDailyAllowanceFactor = (absenceHours) => {
    if (absenceHours < 6) return 0.3;
    if (absenceHours <= 12) return 0.7;
    return 1;
};

function calculateAdmissibleTA(claimData, userPayLevel) {
    let totalAdmissible = 0;
    const warnings = [];
    const empClass = getEmployeeClass(userPayLevel);
    const journeyEntitlements = getJourneyEntitlements(empClass);

    if (claimData.journeyDetails && claimData.journeyDetails.segments) {
        claimData.journeyDetails.segments.forEach(segment => {
            let segmentAdmissible = 0;
            const claimedFare = parseFloat(segment.fare) || 0;
            const segmentMode = String(segment.mode || '').trim().toLowerCase();
            const segmentClass = normalizeTravelClass(segment.travelClass || segment.classType || segment.ticketClass);

            if (segmentMode === 'taxi' || segmentMode === 'road') {
                if (segment.location === 'calicutAirport') {
                    segmentAdmissible = Math.min(claimedFare, taRates.taxiCeilings.calicutAirport);
                } else if (segment.location === 'calicutRailway') {
                    segmentAdmissible = Math.min(claimedFare, taRates.taxiCeilings.calicutRailway);
                } else {
                    const distance = parseFloat(segment.distance) || 0;
                    const isKerala = segment.state === 'kerala';
                    const isAuto = segment.vehicleType === 'auto';
                    let rate = taRates.taxiCeilings.otherStatesPerKm;
                    if (isKerala) {
                        rate = isAuto ? taRates.taxiCeilings.keralaAutoPerKm : taRates.taxiCeilings.keralaPerKm;
                    }
                    segmentAdmissible = Math.min(claimedFare, distance * rate);
                }
            } else if (segmentMode === 'ownvehicle') {
                const distance = parseFloat(segment.distance) || 0;
                segmentAdmissible = distance * taRates.mileageRate.ownVehicle;
                if (!segment.approved && !segment.priorApproval && !claimData.approvals?.ownVehicleApproved) {
                    warnings.push('Own vehicle travel requires prior approval from the competent authority.');
                }
            } else {
                if (segmentMode === 'air') {
                    if (segmentClass && !journeyEntitlements.air.includes(segmentClass)) {
                        warnings.push(`Selected air travel class '${segment.travelClass || segment.classType || segment.ticketClass}' is outside the entitlement for pay level ${userPayLevel}.`);
                    }

                    if (!segment.approved && !segment.specialApproval && !claimData.approvals?.airTravelApproved) {
                        warnings.push('Air travel for this pay level requires special approval.');
                    }
                }

                if (segmentMode === 'rail' && segmentClass && !journeyEntitlements.rail.includes(segmentClass)) {
                    warnings.push(`Selected rail travel class '${segment.travelClass || segment.classType || segment.ticketClass}' is outside the entitlement for pay level ${userPayLevel}.`);
                }

                segmentAdmissible = claimedFare;
            }

            totalAdmissible += segmentAdmissible;
        });
    }

    if (claimData.accommodation && claimData.accommodation.required) {
        const nights = parseInt(claimData.accommodation.nights) || 0;
        const actualCharges = parseFloat(claimData.accommodation.actualRoomCharges) || 0;
        const gstRate = parseFloat(claimData.accommodation.gstRate) || 0;
        const eligiblePerNight = taRates.hotelCeiling[empClass];
        const eligibleTotal = nights * eligiblePerNight;
        const admissibleRoom = Math.min(actualCharges, eligibleTotal);
        const admissibleGST = (admissibleRoom * gstRate) / 100;
        totalAdmissible += (admissibleRoom + admissibleGST);
    }

    if (claimData.dailyAllowance && claimData.dailyAllowance.required) {
        const days = parseInt(claimData.dailyAllowance.days) || 1;
        const absenceHours = parseFloat(claimData.dailyAllowance.absenceHours) || 0;
        const foodProvided = Boolean(claimData.dailyAllowance.foodProvided);
        const dailyRate = taRates.dailyAllowance[empClass] || 0;

        if (foodProvided) {
            warnings.push('No daily allowance is admissible for days where food is provided.');
        } else {
            const factor = getDailyAllowanceFactor(absenceHours);
            totalAdmissible += days * dailyRate * factor;
        }
    }

    if (claimData.localTravel && claimData.localTravel.required) {
        const days = parseInt(claimData.localTravel.days) || 0;
        const actualCharges = parseFloat(claimData.localTravel.actualCharges) || 0;
        const km = parseFloat(claimData.localTravel.kilometers) || 0;

        if (userPayLevel <= 11) {
            totalAdmissible += days * taRates.localTravel[empClass];
        } else if (userPayLevel <= 13) {
            totalAdmissible += km > 50 ? (actualCharges / km) * 50 : actualCharges;
        } else {
            totalAdmissible += actualCharges;
        }
    }

    return { totalAdmissible: parseFloat(totalAdmissible.toFixed(2)), warnings };
}

module.exports = { calculateAdmissibleTA, taRates, getEmployeeClass, getJourneyEntitlements, getDailyAllowanceFactor };
