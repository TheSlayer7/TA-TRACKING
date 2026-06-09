const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const db = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { normalizeRole } = require('../lib/rbac');

const router = express.Router();

const buildUserPayload = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  pay_level: user.pay_level,
  role: normalizeRole(user.role),
  department: user.department || '',
  department_id: user.department_id ?? null,
  manager_user_id: user.manager_user_id ?? null,
  active: Boolean(user.active ?? true),
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  two_factor_enabled: Boolean(user.two_factor_enabled)
});

const signToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      pay_level: user.pay_level,
      role: normalizeRole(user.role),
      department: user.department || '',
      department_id: user.department_id ?? null,
      manager_user_id: user.manager_user_id ?? null,
      active: Boolean(user.active ?? true),
      permissions: Array.isArray(user.permissions) ? user.permissions : [],
      two_factor_enabled: Boolean(user.two_factor_enabled)
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
};

const signTwoFactorChallenge = (user) => {
  return jwt.sign(
    {
      id: user.id,
      purpose: 'two-factor-login'
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
};

const normalizeCode = (value) => String(value || '').replace(/\s+/g, '');

const loginUserQuery = `
  SELECT u.id, u.name, u.email, u.password_hash, u.pay_level, u.role, u.department,
    u.active, u.two_factor_enabled, u.two_factor_secret,
    COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions,
    (u.password_hash = crypt($2, u.password_hash)) AS crypt_match
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  LEFT JOIN permissions p ON p.id = rp.permission_id
  WHERE u.email = $1
  GROUP BY u.id
  LIMIT 1;
`;

const profileUserQuery = `
  SELECT u.id, u.name, u.email, u.pay_level, u.role, u.department, u.active,
    u.two_factor_enabled, u.two_factor_secret,
    COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  LEFT JOIN permissions p ON p.id = rp.permission_id
  WHERE u.id = $1
  GROUP BY u.id
  LIMIT 1;
`;

const storeUserRole = async (client, userId, roleName, assignedBy = null) => {
  const role = normalizeRole(roleName);
  await client.query(
    `
      INSERT INTO user_roles (user_id, role_id, assigned_by)
      SELECT $1, id, $3
      FROM roles
      WHERE name = $2
      ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW();
    `,
    [userId, role, assignedBy]
  );

  await client.query('UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1', [userId, role]);
};

const loadUserProfileByEmail = async (email, password) => {
  return db.query(loginUserQuery, [email, password]);
};

const loadUserProfileById = async (userId) => {
  return db.query(profileUserQuery, [userId]);
};

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.error('Email and password are required.', 400);
    }

    const result = await loadUserProfileByEmail(String(email).trim().toLowerCase(), password);

    if (result.rowCount === 0) {
      return res.error('Invalid email or password.', 401);
    }

    const user = result.rows[0];
    let passwordMatches = false;

    try {
      passwordMatches = await bcrypt.compare(password, user.password_hash);
    } catch (_) {
      passwordMatches = false;
    }

    // If bcrypt check failed, try Postgres crypt() comparison (for seeded crypt hashes)
    if (!passwordMatches && (user.crypt_match === true || user.crypt_match === 't')) {
      passwordMatches = true;
    }

    if (!passwordMatches) {
      return res.error('Invalid email or password.', 401);
    }

    if (!user.active) {
      return res.error('This account is disabled.', 403);
    }

    if (user.two_factor_enabled && user.two_factor_secret) {
      const challengeToken = signTwoFactorChallenge(user);

      return res.success({
        message: 'Password verified. Enter your authentication code to finish signing in.',
        requiresTwoFactor: true,
        challengeToken,
        user: buildUserPayload(user)
      });
    }

    const token = signToken(user);

    return res.success({
      message: 'Login successful.',
      token,
      user: buildUserPayload(user)
    });
  } catch (error) {
    console.error('Login Error:', error);
    if (error.code === 'ECONNREFUSED') {
      return res.error('Database connection failed. Start PostgreSQL on port 5432 and try again.', 503);
    }

    return res.error('Server error during login.', 500);
  }
});

// Simple self-registration endpoint (creates TA users only)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, pay_level, department, role: requestedRole } = req.body;

    if (!name || !email || !password) {
      return res.error('Name, email, and password are required.', 400);
    }

    const lowerEmail = String(email).trim().toLowerCase();

    const role = normalizeRole(requestedRole || 'TA');

    if (requestedRole && role !== 'TA') {
      return res.error('Self-registration is limited to TA accounts. Ask an Admin to create Faculty or Admin users.', 403);
    }

    const hash = await bcrypt.hash(password, 10);

    const pl = Number(pay_level) || 8;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
          INSERT INTO users (name, email, password_hash, pay_level, role, department)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name, email, pay_level, role, department, active, two_factor_enabled;
        `,
        [name, lowerEmail, hash, pl, role, department || '']
      );

      await storeUserRole(client, result.rows[0].id, role);

      const profile = await loadUserProfileById(result.rows[0].id);

      await client.query('COMMIT');

      res.status(201);
      return res.success({ message: 'Registration complete.', user: buildUserPayload(profile.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Register Error:', error);
    if (error.code === '23505') { // unique_violation
      return res.error('An account with that email already exists.', 409);
    }

    return res.error('Server error during registration.', 500);
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await loadUserProfileById(req.user.id);

    if (result.rowCount === 0) {
      return res.error('User not found.', 404);
    }

    return res.success({ user: buildUserPayload(result.rows[0]) });
  } catch (error) {
    console.error('Profile refresh error:', error);
    return res.error('Unable to load the current user profile.', 500);
  }
});

router.post('/verify-2fa', async (req, res) => {
  try {
    const { challengeToken, code } = req.body;

    if (!challengeToken || !code) {
      return res.error('Challenge token and authentication code are required.', 400);
    }

    let challengePayload;
    try {
      challengePayload = jwt.verify(challengeToken, process.env.JWT_SECRET);
    } catch {
      return res.error('Two-factor challenge expired. Please sign in again.', 401);
    }

    if (challengePayload.purpose !== 'two-factor-login') {
      return res.error('Invalid two-factor challenge.', 401);
    }

    const result = await loadUserProfileById(challengePayload.id);

    if (result.rowCount === 0) {
      return res.error('User not found.', 404);
    }

    const user = result.rows[0];

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      return res.error('Two-factor authentication is not enabled for this account.', 400);
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: normalizeCode(code),
      window: 1
    });

    if (!verified) {
      return res.error('Invalid authentication code.', 401);
    }

    const token = signToken(user);

    const freshProfile = await loadUserProfileById(user.id);

    return res.success({
      message: 'Two-factor authentication complete.',
      token,
      user: buildUserPayload(freshProfile.rows[0])
    });
  } catch (error) {
    console.error('2FA verify error:', error);
    return res.error('Server error during two-factor verification.', 500);
  }
});

router.get('/2fa/setup', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT id, name, email, two_factor_enabled
        FROM users
        WHERE id = $1
        LIMIT 1;
      `,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.error('User not found.', 404);
    }

    const user = result.rows[0];

    if (user.two_factor_enabled) {
      return res.success({
        enabled: true,
        message: 'Two-factor authentication is already enabled.'
      });
    }

    const secret = speakeasy.generateSecret({
      name: `Siteimade TA Portal (${user.email})`,
      issuer: 'Siteimade TA Portal'
    });

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url, {
      margin: 1,
      width: 220,
      color: {
        dark: '#102033',
        light: '#ffffff'
      }
    });

    return res.success({
      enabled: false,
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrCodeDataUrl,
      label: user.email
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    return res.error('Unable to create a two-factor setup secret.', 500);
  }
});

router.post('/2fa/enable', verifyToken, async (req, res) => {
  try {
    const { secret, code } = req.body;

    if (!secret || !code) {
      return res.error('Secret and authentication code are required.', 400);
    }

    const verified = speakeasy.totp.verify({
      secret: String(secret),
      encoding: 'base32',
      token: normalizeCode(code),
      window: 1
    });

    if (!verified) {
      return res.error('Invalid authentication code.', 401);
    }

    const updateResult = await db.query(
      `
        UPDATE users
        SET two_factor_enabled = TRUE,
            two_factor_secret = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, email, pay_level, role, department, active, two_factor_enabled;
      `,
      [req.user.id, String(secret)]
    );

    const freshProfile = await loadUserProfileById(req.user.id);

    return res.success({
      message: 'Two-factor authentication enabled.',
      user: buildUserPayload(freshProfile.rows[0])
    });
  } catch (error) {
    console.error('2FA enable error:', error);
    return res.error('Unable to enable two-factor authentication.', 500);
  }
});

router.post('/2fa/disable', verifyToken, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.error('Password is required to disable two-factor authentication.', 400);
    }

    const result = await db.query(
      `
        SELECT id, name, email, password_hash, pay_level, role, department, active
        FROM users
        WHERE id = $1
        LIMIT 1;
      `,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.error('User not found.', 404);
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.error('Password verification failed.', 401);
    }

    const updateResult = await db.query(
      `
        UPDATE users
        SET two_factor_enabled = FALSE,
            two_factor_secret = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, email, pay_level, role, department, active, two_factor_enabled;
      `,
      [req.user.id]
    );

    const freshProfile = await loadUserProfileById(req.user.id);

    return res.success({
      message: 'Two-factor authentication disabled.',
      user: buildUserPayload(freshProfile.rows[0])
    });
  } catch (error) {
    console.error('2FA disable error:', error);
    return res.error('Unable to disable two-factor authentication.', 500);
  }
});

module.exports = router;
