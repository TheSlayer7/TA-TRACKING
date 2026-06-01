const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { normalizeRole } = require('../lib/rbac');

const router = express.Router();

const escapeLike = (value) => String(value || '').replace(/[\\%_]/g, '\\$&');

const logAudit = async (client, actorUserId, action, entityType, entityId, details = {}) => {
  await client.query(
    `
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5::jsonb);
    `,
    [actorUserId, action, entityType, entityId || null, JSON.stringify(details)]
  );
};

const getRoleId = async (client, roleName) => {
  const result = await client.query('SELECT id FROM roles WHERE name = $1', [normalizeRole(roleName)]);
  return result.rowCount ? result.rows[0].id : null;
};

const getUserProfile = async (client, userId) => {
  const result = await client.query(
    `
      SELECT u.id, u.name, u.email, u.pay_level, u.department, u.active,
             u.two_factor_enabled, u.role,
             COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1
      GROUP BY u.id
      LIMIT 1;
    `,
    [userId]
  );

  return result.rowCount ? result.rows[0] : null;
};

const toUserSummary = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  pay_level: row.pay_level,
  department: row.department,
  active: row.active,
  two_factor_enabled: row.two_factor_enabled,
  role: normalizeRole(row.role),
  permissions: Array.isArray(row.permissions) ? row.permissions : []
});

const requireBodyFields = (res, body, fields) => {
  for (const field of fields) {
    if (!body?.[field] && body?.[field] !== 0) {
      res.status(400).json({ error: `${field} is required.` });
      return false;
    }
  }

  return true;
};

const ensureAdmin = requireRole('Admin');
const ensureFacultyOrAbove = requireRole(['Faculty', 'Admin']);

router.get('/admin/summary', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const [users, courses, tasks, logs, audit] = await Promise.all([
      db.query(`SELECT role, COUNT(*)::int AS total FROM users GROUP BY role ORDER BY role;`),
      db.query(`SELECT COUNT(*)::int AS total FROM courses;`),
      db.query(`SELECT status, COUNT(*)::int AS total FROM tasks GROUP BY status ORDER BY status;`),
      db.query(`SELECT status, COUNT(*)::int AS total FROM work_logs GROUP BY status ORDER BY status;`),
      db.query(`SELECT action, COUNT(*)::int AS total FROM audit_logs GROUP BY action ORDER BY total DESC LIMIT 10;`)
    ]);

    return res.status(200).json({
      userTotals: users.rows,
      courseTotal: courses.rows[0]?.total || 0,
      taskTotals: tasks.rows,
      workLogTotals: logs.rows,
      auditTotals: audit.rows
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    return res.status(500).json({ error: 'Unable to load admin summary.' });
  }
});

router.get('/admin/users', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT u.id, u.name, u.email, u.pay_level, u.department, u.active, u.two_factor_enabled,
               COALESCE(r.name, u.role, 'TA') AS role
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        ORDER BY u.created_at DESC, u.id DESC;
      `
    );

    return res.status(200).json(result.rows.map(toUserSummary));
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Unable to load users.' });
  }
});

router.post('/admin/users', verifyToken, ensureAdmin, async (req, res) => {
  const { name, email, password, pay_level, department, role } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required.' });
  }

  const normalizedRole = normalizeRole(role);
  const allowedRoles = ['Admin', 'Faculty', 'TA'];
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role requested.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(String(password), 10);
    const userResult = await client.query(
      `
        INSERT INTO users (name, email, password_hash, pay_level, role, department)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, email, pay_level, department, active, two_factor_enabled, role;
      `,
      [String(name).trim(), String(email).trim().toLowerCase(), hash, Number(pay_level) || 1, normalizedRole, department || '']
    );

    const roleId = await getRoleId(client, normalizedRole);
    await client.query(
      `
        INSERT INTO user_roles (user_id, role_id, assigned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW();
      `,
      [userResult.rows[0].id, roleId, req.user.id]
    );

    await logAudit(client, req.user.id, 'create_user', 'user', userResult.rows[0].id, { role: normalizedRole, email: userResult.rows[0].email });

    await client.query('COMMIT');
    return res.status(201).json({ user: toUserSummary(userResult.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create user error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    return res.status(500).json({ error: 'Unable to create user.' });
  } finally {
    client.release();
  }
});

router.put('/admin/users/:id', verifyToken, ensureAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { name, email, pay_level, department, active, role } = req.body || {};

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  const normalizedRole = role ? normalizeRole(role) : null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query('SELECT id, role FROM users WHERE id = $1 LIMIT 1;', [userId]);
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    const result = await client.query(
      `
        UPDATE users
        SET name = COALESCE($2, name),
            email = COALESCE($3, email),
            pay_level = COALESCE($4, pay_level),
            department = COALESCE($5, department),
            active = COALESCE($6, active),
            role = COALESCE($7, role),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, email, pay_level, department, active, two_factor_enabled, role;
      `,
      [userId, name || null, email ? String(email).trim().toLowerCase() : null, pay_level ?? null, department ?? null, typeof active === 'boolean' ? active : null, normalizedRole]
    );

    if (normalizedRole) {
      const roleId = await getRoleId(client, normalizedRole);
      await client.query(
        `
          INSERT INTO user_roles (user_id, role_id, assigned_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW();
        `,
        [userId, roleId, req.user.id]
      );
    }

    await logAudit(client, req.user.id, 'update_user', 'user', userId, { role: normalizedRole, email: email || undefined });
    await client.query('COMMIT');
    return res.status(200).json({ user: toUserSummary(result.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update user error:', error);
    return res.status(500).json({ error: 'Unable to update user.' });
  } finally {
    client.release();
  }
});

router.delete('/admin/users/:id', verifyToken, ensureAdmin, async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  if (req.user.id === userId) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING id, email;', [userId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    await logAudit(client, req.user.id, 'delete_user', 'user', userId, { email: result.rows[0].email });
    await client.query('COMMIT');
    return res.status(200).json({ message: 'User deleted.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete user error:', error);
    return res.status(500).json({ error: 'Unable to delete user.' });
  } finally {
    client.release();
  }
});

router.get('/admin/courses', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT c.id, c.code, c.title, c.term, c.active, c.faculty_user_id,
               COALESCE(u.name, '') AS faculty_name
        FROM courses c
        LEFT JOIN users u ON u.id = c.faculty_user_id
        ORDER BY c.created_at DESC, c.id DESC;
      `
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('List courses error:', error);
    return res.status(500).json({ error: 'Unable to load courses.' });
  }
});

router.post('/admin/courses', verifyToken, ensureAdmin, async (req, res) => {
  const { code, title, term, faculty_user_id } = req.body || {};
  if (!code || !title) {
    return res.status(400).json({ error: 'code and title are required.' });
  }

  try {
    const result = await db.query(
      `
        INSERT INTO courses (code, title, term, faculty_user_id)
        VALUES ($1, $2, COALESCE($3, 'Current'), $4)
        RETURNING id, code, title, term, active, faculty_user_id;
      `,
      [String(code).trim(), String(title).trim(), term || null, faculty_user_id || null]
    );

    return res.status(201).json({ course: result.rows[0] });
  } catch (error) {
    console.error('Create course error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Course code already exists.' });
    }
    return res.status(500).json({ error: 'Unable to create course.' });
  }
});

router.put('/admin/courses/:id', verifyToken, ensureAdmin, async (req, res) => {
  const courseId = Number(req.params.id);
  const { code, title, term, faculty_user_id, active } = req.body || {};

  if (!Number.isInteger(courseId)) {
    return res.status(400).json({ error: 'Invalid course id.' });
  }

  try {
    const result = await db.query(
      `
        UPDATE courses
        SET code = COALESCE($2, code),
            title = COALESCE($3, title),
            term = COALESCE($4, term),
            faculty_user_id = COALESCE($5, faculty_user_id),
            active = COALESCE($6, active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, code, title, term, active, faculty_user_id;
      `,
      [courseId, code || null, title || null, term || null, faculty_user_id ?? null, typeof active === 'boolean' ? active : null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    return res.status(200).json({ course: result.rows[0] });
  } catch (error) {
    console.error('Update course error:', error);
    return res.status(500).json({ error: 'Unable to update course.' });
  }
});

router.delete('/admin/courses/:id', verifyToken, ensureAdmin, async (req, res) => {
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId)) {
    return res.status(400).json({ error: 'Invalid course id.' });
  }

  try {
    const result = await db.query('DELETE FROM courses WHERE id = $1 RETURNING id;', [courseId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found.' });
    }
    return res.status(200).json({ message: 'Course deleted.' });
  } catch (error) {
    console.error('Delete course error:', error);
    return res.status(500).json({ error: 'Unable to delete course.' });
  }
});

router.get('/admin/reports', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const [userRoles, courseTotals, taskTotals, workLogTotals, recentTasks, recentAudit] = await Promise.all([
      db.query(`SELECT COALESCE(r.name, u.role, 'TA') AS role, COUNT(*)::int AS total FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id GROUP BY COALESCE(r.name, u.role, 'TA') ORDER BY role;`),
      db.query(`SELECT COUNT(*)::int AS total FROM courses;`),
      db.query(`SELECT status, COUNT(*)::int AS total FROM tasks GROUP BY status ORDER BY status;`),
      db.query(`SELECT status, COUNT(*)::int AS total FROM work_logs GROUP BY status ORDER BY status;`),
      db.query(`SELECT id, title, status, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 8;`),
      db.query(`SELECT id, action, entity_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 8;`)
    ]);

    return res.status(200).json({
      userRoles: userRoles.rows,
      courseTotal: courseTotals.rows[0]?.total || 0,
      taskTotals: taskTotals.rows,
      workLogTotals: workLogTotals.rows,
      recentTasks: recentTasks.rows,
      recentAudit: recentAudit.rows
    });
  } catch (error) {
    console.error('Admin reports error:', error);
    return res.status(500).json({ error: 'Unable to load reports.' });
  }
});

router.get('/faculty/dashboard', verifyToken, ensureFacultyOrAbove, async (req, res) => {
  try {
    const [courseSummary, taskSummary, pendingReviews, logs, recentTasks] = await Promise.all([
      db.query(
        `
          SELECT COUNT(DISTINCT c.id)::int AS course_count,
                 COUNT(DISTINCT ct.ta_user_id)::int AS ta_count
          FROM courses c
          LEFT JOIN course_tas ct ON ct.course_id = c.id
          WHERE c.faculty_user_id = $1;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT status, COUNT(*)::int AS total
          FROM tasks t
          JOIN courses c ON c.id = t.course_id
          WHERE c.faculty_user_id = $1
          GROUP BY status
          ORDER BY status;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT COUNT(*)::int AS total
          FROM work_logs wl
          JOIN tasks t ON t.id = wl.task_id
          JOIN courses c ON c.id = t.course_id
          WHERE c.faculty_user_id = $1 AND wl.status = 'Submitted';
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT COALESCE(SUM(wl.hours_worked), 0)::numeric AS hours_total
          FROM work_logs wl
          JOIN tasks t ON t.id = wl.task_id
          JOIN courses c ON c.id = t.course_id
          WHERE c.faculty_user_id = $1 AND wl.status = 'Approved';
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT t.id, t.title, t.status, t.completion_pct, u.name AS ta_name, c.code AS course_code
          FROM tasks t
          JOIN courses c ON c.id = t.course_id
          JOIN users u ON u.id = t.assigned_ta_id
          WHERE c.faculty_user_id = $1
          ORDER BY t.updated_at DESC
          LIMIT 8;
        `,
        [req.user.id]
      )
    ]);

    return res.status(200).json({
      courseSummary: courseSummary.rows[0] || { course_count: 0, ta_count: 0 },
      taskSummary: taskSummary.rows,
      pendingReviews: pendingReviews.rows[0]?.total || 0,
      approvedHours: logs.rows[0]?.hours_total || 0,
      recentTasks: recentTasks.rows
    });
  } catch (error) {
    console.error('Faculty dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load faculty dashboard.' });
  }
});

router.get('/faculty/tasks', verifyToken, ensureFacultyOrAbove, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT t.id, t.title, t.description, t.status, t.completion_pct, t.due_date,
               c.code AS course_code, c.title AS course_title,
               ta.name AS ta_name, ta.id AS ta_id
        FROM tasks t
        JOIN courses c ON c.id = t.course_id
        JOIN users ta ON ta.id = t.assigned_ta_id
        WHERE c.faculty_user_id = $1
        ORDER BY t.updated_at DESC, t.id DESC;
      `,
      [req.user.id]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Faculty tasks error:', error);
    return res.status(500).json({ error: 'Unable to load faculty tasks.' });
  }
});

router.post('/faculty/tasks', verifyToken, ensureFacultyOrAbove, async (req, res) => {
  const { course_id, assigned_ta_id, title, description, due_date } = req.body || {};

  if (!course_id || !assigned_ta_id || !title) {
    return res.status(400).json({ error: 'course_id, assigned_ta_id, and title are required.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const courseCheck = await client.query('SELECT id FROM courses WHERE id = $1 AND faculty_user_id = $2 LIMIT 1;', [course_id, req.user.id]);
    if (courseCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only assign tasks for your own courses.' });
    }

    const roleCheck = await client.query(
      `
        SELECT u.id
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE u.id = $1 AND r.name = 'TA' AND u.active = TRUE
        LIMIT 1;
      `,
      [assigned_ta_id]
    );

    if (roleCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Assigned user must be an active TA.' });
    }

    const result = await client.query(
      `
        INSERT INTO tasks (course_id, title, description, assigned_by_user_id, assigned_ta_id, due_date)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, course_id, title, description, assigned_ta_id, status, completion_pct, due_date, created_at;
      `,
      [course_id, String(title).trim(), description || '', req.user.id, assigned_ta_id, due_date || null]
    );

    await client.query(
      `
        INSERT INTO course_tas (course_id, ta_user_id, assigned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (course_id, ta_user_id) DO NOTHING;
      `,
      [course_id, assigned_ta_id, req.user.id]
    );

    await logAudit(client, req.user.id, 'create_task', 'task', result.rows[0].id, { course_id, assigned_ta_id });
    await client.query('COMMIT');
    return res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create task error:', error);
    return res.status(500).json({ error: 'Unable to create task.' });
  } finally {
    client.release();
  }
});

router.get('/faculty/submissions', verifyToken, ensureFacultyOrAbove, async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT wl.id, wl.summary, wl.hours_worked, wl.log_date, wl.status, wl.reviewer_notes,
               t.id AS task_id, t.title AS task_title, c.code AS course_code,
               ta.name AS ta_name
        FROM work_logs wl
        JOIN tasks t ON t.id = wl.task_id
        JOIN courses c ON c.id = t.course_id
        JOIN users ta ON ta.id = wl.ta_user_id
        WHERE c.faculty_user_id = $1
        ORDER BY wl.created_at DESC;
      `,
      [req.user.id]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Faculty submissions error:', error);
    return res.status(500).json({ error: 'Unable to load submissions.' });
  }
});

router.post('/faculty/work-logs/:id/review', verifyToken, ensureFacultyOrAbove, async (req, res) => {
  const logId = Number(req.params.id);
  const { status, reviewer_notes } = req.body || {};

  if (!Number.isInteger(logId) || !['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid review request.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const ownership = await client.query(
      `
        SELECT wl.id
        FROM work_logs wl
        JOIN tasks t ON t.id = wl.task_id
        JOIN courses c ON c.id = t.course_id
        WHERE wl.id = $1 AND c.faculty_user_id = $2
        LIMIT 1;
      `,
      [logId, req.user.id]
    );

    if (ownership.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only review logs from your own courses.' });
    }

    const result = await client.query(
      `
        UPDATE work_logs
        SET status = $2,
            reviewer_id = $3,
            reviewer_notes = COALESCE($4, reviewer_notes),
            reviewed_at = NOW()
        WHERE id = $1
        RETURNING id, task_id, ta_user_id, status;
      `,
      [logId, status, req.user.id, reviewer_notes || '']
    );

    await client.query(
      `
        UPDATE tasks
        SET status = CASE WHEN $2 = 'Approved' THEN 'Approved' ELSE 'Rejected' END,
            completion_pct = CASE WHEN $2 = 'Approved' THEN 100 ELSE completion_pct END,
            updated_at = NOW()
        WHERE id = $1;
      `,
      [result.rows[0].task_id, status]
    );

    await logAudit(client, req.user.id, 'review_work_log', 'work_log', logId, { status, reviewer_notes: reviewer_notes || '' });
    await client.query('COMMIT');
    return res.status(200).json({ message: `Work log ${status.toLowerCase()}.`, workLog: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Review log error:', error);
    return res.status(500).json({ error: 'Unable to review work log.' });
  } finally {
    client.release();
  }
});

router.get('/faculty/reports', verifyToken, ensureFacultyOrAbove, async (req, res) => {
  try {
    const [courseSummary, completionSummary, taSummary] = await Promise.all([
      db.query(
        `
          SELECT c.id, c.code, c.title,
                 COUNT(DISTINCT t.id)::int AS task_count,
                 COUNT(DISTINCT wl.id)::int AS submission_count,
                 COALESCE(SUM(CASE WHEN wl.status = 'Approved' THEN wl.hours_worked ELSE 0 END), 0)::numeric AS approved_hours
          FROM courses c
          LEFT JOIN tasks t ON t.course_id = c.id
          LEFT JOIN work_logs wl ON wl.task_id = t.id
          WHERE c.faculty_user_id = $1
          GROUP BY c.id
          ORDER BY c.title;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT status, COUNT(*)::int AS total
          FROM tasks t
          JOIN courses c ON c.id = t.course_id
          WHERE c.faculty_user_id = $1
          GROUP BY status
          ORDER BY status;
        `,
        [req.user.id]
      ),
      db.query(
        `
           SELECT ta.id AS ta_id,
             ta.name AS ta_name,
                 COUNT(t.id)::int AS assigned_tasks,
                 COUNT(wl.id)::int AS submitted_logs,
                 COALESCE(SUM(wl.hours_worked), 0)::numeric AS logged_hours
          FROM users ta
          JOIN course_tas ct ON ct.ta_user_id = ta.id
          JOIN courses c ON c.id = ct.course_id AND c.faculty_user_id = $1
          LEFT JOIN tasks t ON t.assigned_ta_id = ta.id AND t.course_id = c.id
          LEFT JOIN work_logs wl ON wl.task_id = t.id
          WHERE ta.active = TRUE
          GROUP BY ta.id
          ORDER BY ta.name;
        `,
        [req.user.id]
      )
    ]);

    return res.status(200).json({
      courseSummary: courseSummary.rows,
      taskSummary: completionSummary.rows,
      taSummary: taSummary.rows
    });
  } catch (error) {
    console.error('Faculty reports error:', error);
    return res.status(500).json({ error: 'Unable to load faculty reports.' });
  }
});

router.get('/ta/dashboard', verifyToken, requireRole('TA'), async (req, res) => {
  try {
    const [taskSummary, activity, logs] = await Promise.all([
      db.query(
        `
          SELECT status, COUNT(*)::int AS total
          FROM tasks
          WHERE assigned_ta_id = $1
          GROUP BY status
          ORDER BY status;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT COUNT(*)::int AS total_tasks,
                 COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0)::int AS approved_logs,
                 COALESCE(SUM(CASE WHEN status = 'Submitted' THEN 1 ELSE 0 END), 0)::int AS pending_logs
          FROM work_logs
          WHERE ta_user_id = $1;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT wl.id, wl.summary, wl.hours_worked, wl.status, wl.log_date,
                 t.title AS task_title, c.code AS course_code
          FROM work_logs wl
          JOIN tasks t ON t.id = wl.task_id
          JOIN courses c ON c.id = t.course_id
          WHERE wl.ta_user_id = $1
          ORDER BY wl.created_at DESC
          LIMIT 8;
        `,
        [req.user.id]
      )
    ]);

    return res.status(200).json({
      taskSummary: taskSummary.rows,
      activity: activity.rows[0] || { total_tasks: 0, approved_logs: 0, pending_logs: 0 },
      recentLogs: logs.rows
    });
  } catch (error) {
    console.error('TA dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load TA dashboard.' });
  }
});

router.get('/ta/tasks', verifyToken, requireRole('TA'), async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT t.id, t.title, t.description, t.status, t.completion_pct, t.due_date,
               c.code AS course_code, c.title AS course_title,
               u.name AS faculty_name
        FROM tasks t
        JOIN courses c ON c.id = t.course_id
        JOIN users u ON u.id = c.faculty_user_id
        WHERE t.assigned_ta_id = $1
        ORDER BY t.updated_at DESC, t.id DESC;
      `,
      [req.user.id]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('TA tasks error:', error);
    return res.status(500).json({ error: 'Unable to load tasks.' });
  }
});

router.patch('/ta/tasks/:id/status', verifyToken, requireRole('TA'), async (req, res) => {
  const taskId = Number(req.params.id);
  const { status, completion_pct } = req.body || {};

  if (!Number.isInteger(taskId) || !['Assigned', 'In Progress', 'Submitted'].includes(status)) {
    return res.status(400).json({ error: 'Invalid task update request.' });
  }

  const pct = Math.max(0, Math.min(100, Number(completion_pct ?? 0)));

  try {
    const result = await db.query(
      `
        UPDATE tasks
        SET status = $2,
            completion_pct = $3,
            updated_at = NOW()
        WHERE id = $1 AND assigned_ta_id = $4
        RETURNING id, title, status, completion_pct;
      `,
      [taskId, status, pct, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    return res.status(200).json({ task: result.rows[0] });
  } catch (error) {
    console.error('TA task status error:', error);
    return res.status(500).json({ error: 'Unable to update task status.' });
  }
});

router.post('/ta/tasks/:id/logs', verifyToken, requireRole('TA'), async (req, res) => {
  const taskId = Number(req.params.id);
  const { summary, hours_worked, log_date } = req.body || {};

  if (!Number.isInteger(taskId) || !summary) {
    return res.status(400).json({ error: 'task id and summary are required.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const taskCheck = await client.query('SELECT id FROM tasks WHERE id = $1 AND assigned_ta_id = $2 LIMIT 1;', [taskId, req.user.id]);
    if (taskCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Task not found.' });
    }

    const result = await client.query(
      `
        INSERT INTO work_logs (task_id, ta_user_id, summary, hours_worked, log_date, status)
        VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), 'Submitted')
        RETURNING id, task_id, ta_user_id, summary, hours_worked, log_date, status;
      `,
      [taskId, req.user.id, String(summary).trim(), Number(hours_worked) || 0, log_date || null]
    );

    await client.query(
      `
        UPDATE tasks
        SET status = 'Submitted',
            completion_pct = GREATEST(completion_pct, 50),
            updated_at = NOW()
        WHERE id = $1;
      `,
      [taskId]
    );

    await logAudit(client, req.user.id, 'submit_work_log', 'work_log', result.rows[0].id, { taskId });
    await client.query('COMMIT');

    return res.status(201).json({ workLog: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('TA submit log error:', error);
    return res.status(500).json({ error: 'Unable to submit work log.' });
  } finally {
    client.release();
  }
});

router.get('/ta/activity', verifyToken, requireRole('TA'), async (req, res) => {
  try {
    const [logs, tasks, reports] = await Promise.all([
      db.query(
        `
          SELECT wl.id, wl.summary, wl.hours_worked, wl.status, wl.log_date,
                 t.title AS task_title, c.code AS course_code
          FROM work_logs wl
          JOIN tasks t ON t.id = wl.task_id
          JOIN courses c ON c.id = t.course_id
          WHERE wl.ta_user_id = $1
          ORDER BY wl.created_at DESC;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT COUNT(*)::int AS task_count,
                 COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved_count,
                 COUNT(*) FILTER (WHERE status = 'Submitted')::int AS submitted_count
          FROM tasks
          WHERE assigned_ta_id = $1;
        `,
        [req.user.id]
      ),
      db.query(
        `
          SELECT COALESCE(SUM(hours_worked), 0)::numeric AS total_hours,
                 COUNT(*) FILTER (WHERE status = 'Approved')::int AS approved_logs
          FROM work_logs
          WHERE ta_user_id = $1;
        `,
        [req.user.id]
      )
    ]);

    return res.status(200).json({
      logs: logs.rows,
      taskStats: tasks.rows[0] || { task_count: 0, approved_count: 0, submitted_count: 0 },
      reportStats: reports.rows[0] || { total_hours: 0, approved_logs: 0 }
    });
  } catch (error) {
    console.error('TA activity error:', error);
    return res.status(500).json({ error: 'Unable to load activity history.' });
  }
});

module.exports = router;