CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pay_level INTEGER NOT NULL CHECK (pay_level BETWEEN 1 AND 18),
  role TEXT NOT NULL DEFAULT 'TA' CHECK (role IN ('Admin', 'Faculty', 'TA')),
  department TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name IN ('Admin', 'Faculty', 'TA')),
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT 'Current',
  faculty_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_tas (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  ta_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, ta_user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_ta_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Assigned' CHECK (status IN ('Assigned', 'In Progress', 'Submitted', 'Approved', 'Rejected')),
  completion_pct INTEGER NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_logs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ta_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Approved', 'Rejected')),
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_notes TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_ta_status ON tasks (assigned_ta_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_course_status ON tasks (course_id, status);
CREATE INDEX IF NOT EXISTS idx_work_logs_ta_status ON work_logs (ta_user_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at ON audit_logs (actor_user_id, created_at DESC);

INSERT INTO roles (name, description)
VALUES
  ('Admin', 'System administrator with full access'),
  ('Faculty', 'Faculty member who assigns and reviews TA work'),
  ('TA', 'Teaching assistant who completes work and submits logs')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO permissions (code, description)
VALUES
  ('users:create', 'Create new users'),
  ('users:update', 'Update user profiles'),
  ('users:delete', 'Delete users'),
  ('roles:assign', 'Assign roles to users'),
  ('courses:manage', 'Create and manage courses'),
  ('courses:view', 'View course lists and details'),
  ('tasks:assign', 'Assign tasks to teaching assistants'),
  ('tasks:view:assigned', 'View assigned tasks'),
  ('tasks:update', 'Update task status'),
  ('submissions:view', 'View task submissions and work logs'),
  ('worklogs:submit', 'Submit work logs'),
  ('worklogs:review', 'Approve or reject work logs'),
  ('activity:view:own', 'View personal activity history'),
  ('reports:view:own', 'View personal workload reports'),
  ('reports:view:faculty', 'View faculty course reports'),
  ('reports:view:all', 'View all system reports')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_id_key;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users
SET role = CASE
  WHEN role IS NULL OR trim(role) = '' THEN 'TA'
  WHEN lower(trim(role)) IN ('accounts', 'account', 'accounts department', 'accounts dept') THEN 'Faculty'
  WHEN lower(trim(role)) IN ('administrator', 'admin') THEN 'Admin'
  WHEN lower(trim(role)) IN ('employee', 'employees', 'emp') THEN 'TA'
  WHEN lower(trim(role)) IN ('faculty', 'professor', 'lecturer') THEN 'Faculty'
  ELSE role
END
WHERE role IS NULL OR trim(role) = '' OR role NOT IN ('Admin', 'Faculty', 'TA');

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Admin', 'Faculty', 'TA'));

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = ANY (CASE r.name
  WHEN 'Admin' THEN ARRAY['users:create', 'users:update', 'users:delete', 'roles:assign', 'courses:manage', 'courses:view', 'tasks:assign', 'tasks:view:assigned', 'tasks:update', 'submissions:view', 'worklogs:submit', 'worklogs:review', 'activity:view:own', 'reports:view:own', 'reports:view:faculty', 'reports:view:all']
  WHEN 'Faculty' THEN ARRAY['courses:view', 'tasks:assign', 'tasks:view:assigned', 'tasks:update', 'submissions:view', 'worklogs:review', 'activity:view:own', 'reports:view:own', 'reports:view:faculty']
  ELSE ARRAY['courses:view', 'tasks:view:assigned', 'tasks:update', 'worklogs:submit', 'activity:view:own', 'reports:view:own']
END)
ON CONFLICT DO NOTHING;

WITH normalized_users AS (
  SELECT
    id,
    CASE
      WHEN role IS NULL OR trim(role) = '' THEN 'TA'
      WHEN lower(trim(role)) IN ('accounts', 'account', 'accounts department', 'accounts dept') THEN 'Faculty'
      WHEN lower(trim(role)) IN ('administrator', 'admin') THEN 'Admin'
      WHEN lower(trim(role)) IN ('employee', 'employees', 'emp') THEN 'TA'
      WHEN lower(trim(role)) IN ('faculty', 'professor', 'lecturer') THEN 'Faculty'
      ELSE role
    END AS normalized_role
  FROM users
)
INSERT INTO user_roles (user_id, role_id)
SELECT normalized_users.id, roles.id
FROM normalized_users
JOIN roles ON roles.name = normalized_users.normalized_role
ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id;

CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_type TEXT NOT NULL,
  claimed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  admissible_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  claim_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  claim_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTE: seeding of initial users is handled by `backend/scripts/seed.js`
-- Run `npm run seed` from the `backend/` folder after creating the database.
