const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { calculateAdmissibleTA } = require('../controllers/taCalculator');
const db = require('../config/db'); // Database pool wrapper

// 1. Submit a new TA Claim (Any logged-in user)
router.post('/submit', verifyToken, async (req, res) => {
    try {
        const claimData = req.body;

        if (!claimData || Object.keys(claimData).length === 0) {
            return res.status(400).json({ error: 'Claim payload is required.' });
        }

        // SECURITY: Force the pay level from the verified JWT token, NOT the frontend
        const userPayLevel = req.user.pay_level;
        const userId = req.user.id;

        // Recalculate strict admissible amount on the server
        let calculation;
        try {
            calculation = calculateAdmissibleTA(claimData, userPayLevel);
        } catch (calcErr) {
            console.error('Admissible calculation error:', calcErr);
            return res.status(400).json({ error: 'Invalid claim data for admissible calculation.' });
        }

        // Insert into database
        const queryText = `
            INSERT INTO claims (user_id, journey_type, claimed_amount, admissible_amount, status, claim_data)
            VALUES ($1, $2, $3, $4, 'Pending', $5)
            RETURNING id, status, admissible_amount;
        `;

        // Simple fallback total claimed calc for the DB record
        const totalClaimed = (parseFloat(claimData.otherCharges?.amount) || 0) +
            (parseFloat(claimData.accommodation?.actualRoomCharges) || 0);

        const values = [userId, claimData.journeyDetails?.journeyType || 'tour', totalClaimed, calculation.totalAdmissible, JSON.stringify(claimData)];
        const dbResult = await db.query(queryText, values);

        res.status(201).json({
            message: "Claim submitted and securely validated.",
            claimId: dbResult.rows[0].id,
            admissibleAmount: dbResult.rows[0].admissible_amount,
            warnings: calculation.warnings
        });
    } catch (error) {
        console.error("Submission Error:", error.stack || error);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Database connection failed. Start PostgreSQL on port 5432 and try again.' });
        }

        // In development provide the error message to help debugging, otherwise return a generic message
        if (process.env.NODE_ENV !== 'production') {
            return res.status(500).json({ error: 'Server error during claim processing.', detail: error.message });
        }

        res.status(500).json({ error: "Server error during claim processing." });
    }
});

// 2. Get Pending Claims (FACULTY ROLE OR ABOVE)
router.get('/pending', verifyToken, requireRole('Faculty'), async (req, res) => {
    try {
        const queryText = `
            SELECT c.id, u.name, u.department, u.pay_level, c.journey_type, c.admissible_amount, c.status, c.claim_date
            FROM claims c
            JOIN users u ON c.user_id = u.id
            WHERE c.status = 'Pending'
            ORDER BY c.claim_date DESC;
        `;
        const result = await db.query(queryText);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Fetch Pending Error:", error);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Database connection failed. Start PostgreSQL on port 5432 and try again.' });
        }

        res.status(500).json({ error: "Failed to fetch pending claims." });
    }
});

// 3. Verify/Approve or Reject a Claim (FACULTY ROLE OR ABOVE)
router.post('/:id/verify', verifyToken, requireRole('Faculty'), async (req, res) => {
    try {
        const claimId = req.params.id;
        const { status, remarks } = req.body; // Expects 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ error: "Invalid status value." });
        }

        const queryText = `
            UPDATE claims 
            SET status = $1, claim_data = jsonb_set(claim_data, '{verification_remarks}', $2::jsonb)
            WHERE id = $3
            RETURNING id, status;
        `;
        const result = await db.query(queryText, [status, JSON.stringify(remarks || ""), claimId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Claim record not found." });
        }

        res.status(200).json({ message: `Claim has been successfully ${status.toLowerCase()}.` });
    } catch (error) {
        console.error("Verification Error:", error);
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Database connection failed. Start PostgreSQL on port 5432 and try again.' });
        }

        res.status(500).json({ error: "Failed to update claim verification status." });
    }
});

module.exports = router;

// 4. Get current user's claims summary and recent items
router.get('/mine', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const summaryQuery = `
            SELECT COUNT(*)::int AS total_claims,
                   COALESCE(SUM(claimed_amount),0)::numeric AS total_claimed,
                   COALESCE(SUM(admissible_amount),0)::numeric AS total_admissible
            FROM claims
            WHERE user_id = $1;
        `;

        const recentQuery = `
            SELECT id, journey_type, claimed_amount, admissible_amount, status, claim_date
            FROM claims
            WHERE user_id = $1
            ORDER BY claim_date DESC
            LIMIT 10;
        `;

        const [summaryRes, recentRes] = await Promise.all([
            db.query(summaryQuery, [userId]),
            db.query(recentQuery, [userId])
        ]);

        res.status(200).json({ summary: summaryRes.rows[0], recent: recentRes.rows });
    } catch (error) {
        console.error('Fetch Mine Error:', error);
        res.status(500).json({ error: 'Failed to fetch your claims.' });
    }
});