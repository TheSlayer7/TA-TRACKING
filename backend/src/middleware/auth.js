const jwt = require('jsonwebtoken');
const { roleHasAtLeast, roleHasPermission, normalizeRole } = require('../lib/rbac');
require('dotenv').config();

// 1. Check if the user is logged in (has a valid token)
const verifyToken = (req, res, next) => {
    // We expect the token to be sent in the headers as "Bearer <token>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: "Access Denied. No token provided." });
    }

    try {
        // Decode the token using the secret key from your .env file
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Attach the user's data (id, name, pay_level, role) to the request
        req.user = decoded; 
        
        // Pass them through to the next step
        next(); 
    } catch (err) {
        return res.status(403).json({ error: "Invalid or expired token." });
    }
};

// 2. Check if the user has the required Role (RBAC)
const requireRole = (required) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ error: 'Forbidden: authentication required.' });
        }

        const userRole = normalizeRole(req.user.role);

        if (Array.isArray(required)) {
            const allowedRoles = required.map(normalizeRole);
            if (!allowedRoles.includes(userRole)) {
                return res.status(403).json({ error: `Forbidden: this action requires one of [${required.join(', ')}].` });
            }
            return next();
        }

        if (!roleHasAtLeast(userRole, normalizeRole(required))) {
            return res.status(403).json({ error: `Forbidden: this action requires role '${required}' or higher.` });
        }

        next();
    };
};

const requirePermission = (requiredPermission) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ error: 'Forbidden: authentication required.' });
        }

        const permissionList = Array.isArray(req.user.permissions) ? req.user.permissions : [];

        if (!roleHasPermission(normalizeRole(req.user.role), requiredPermission) && !permissionList.includes(requiredPermission)) {
            return res.status(403).json({ error: `Forbidden: missing permission '${requiredPermission}'.` });
        }

        next();
    };
};

module.exports = { verifyToken, requireRole, requirePermission };