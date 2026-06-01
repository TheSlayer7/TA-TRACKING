// Hardcoded 7th CPC Rates (This is the un-hackable source of truth)
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

// Helper function to map exact pay level to the class group
const getEmployeeClass = (payLevel) => {
    if (payLevel <= 5) return 'level1to5';
    if (payLevel <= 8) return 'level6to8';
    if (payLevel <= 11) return 'level9to11';
    if (payLevel <= 13) return 'level12to13';
    return 'level14plus';
};

// Main Calculation Function
const calculateAdmissibleTA = (claimData, userPayLevel) => {
    let totalAdmissible = 0;
    const empClass = getEmployeeClass(userPayLevel);

    // 1. Calculate Journey Segments (Taxis, Trains, Flights)
    if (claimData.journeyDetails && claimData.journeyDetails.segments) {
        claimData.journeyDetails.segments.forEach(segment => {
            let segmentAdmissible = 0;
            const claimedFare = parseFloat(segment.fare) || 0;

            if (segment.mode === 'taxi' || segment.mode === 'road') {
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
            } else if (segment.mode === 'ownVehicle') {
                const distance = parseFloat(segment.distance) || 0;
                segmentAdmissible = distance * taRates.mileageRate.ownVehicle;
            } else {
                // For Rail and Air, we assume the fare is admissible here. 
                // Advanced logic would check if their travel class matches their pay level entitlement.
                segmentAdmissible = claimedFare; 
            }

            totalAdmissible += segmentAdmissible;
        });
    }

    // 2. Hotel Calculation
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

    // 3. Local Travel Calculation
    if (claimData.localTravel && claimData.localTravel.required) {
        const days = parseInt(claimData.localTravel.days) || 0;
        const actualCharges = parseFloat(claimData.localTravel.actualCharges) || 0;
        const km = parseFloat(claimData.localTravel.kilometers) || 0;
        
        if (userPayLevel <= 11) {
            totalAdmissible += days * taRates.localTravel[empClass];
        } else if (userPayLevel <= 13) {
            totalAdmissible += km > 50 ? (actualCharges / km) * 50 : actualCharges;
        } else {
            totalAdmissible += actualCharges; // Level 14+ gets actuals
        }
    }

    return parseFloat(totalAdmissible.toFixed(2));
};

module.exports = { calculateAdmissibleTA };