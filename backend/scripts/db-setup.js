require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { roles, rolePermissions, permissions, normalizeRole } = require('../src/lib/rbac');

const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ta_calculator'
};

const users = [
  { name: 'Ravi TA', email: 'ta@siteimade.local', pay_level: 8, role: 'TA', department: 'Computer Science' },
  { name: 'Anita Faculty', email: 'faculty@siteimade.local', pay_level: 11, role: 'Faculty', department: 'Computer Science' },
  { name: 'Admin User', email: 'admin@siteimade.local', pay_level: 14, role: 'Admin', department: 'Administration' }
];

const splitSqlStatements = (sql) => {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDollarQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextTwo = sql.slice(index, index + 2);

    if (!inDollarQuote && char === "'" && sql[index - 1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && nextTwo === '$$') {
      inDollarQuote = !inDollarQuote;
      current += nextTwo;
      index += 1;
      continue;
    }

    if (char === ';' && !inSingleQuote && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
};

const createClient = (database) => new Client({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database
});

const escapeIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

async function ensureDatabase() {
  const adminClient = createClient('postgres');
  await adminClient.connect();

  try {
    const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbConfig.database]);

    if (exists.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE ${escapeIdentifier(dbConfig.database)}`);
      console.log(`Created database: ${dbConfig.database}`);
    } else {
      console.log(`Database already exists: ${dbConfig.database}`);
    }
  } finally {
    await adminClient.end();
  }
}

async function applySchema() {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSqlStatements(schemaSql);
  const client = createClient(dbConfig.database);

  await client.connect();

  try {
    for (const statement of statements) {
      await client.query(statement);
    }

    await client.query('ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_id_key;');
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';");
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();');

    console.log(`Applied schema from ${schemaPath}`);
  } finally {
    await client.end();
  }
}

async function seedRoles(client) {
  for (const role of roles) {
    await client.query(
      `
        INSERT INTO roles (name, description)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;
      `,
      [role, `${role} role`]
    );
  }

  for (const permission of permissions) {
    await client.query(
      `
        INSERT INTO permissions (code, description)
        VALUES ($1, $2)
        ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
      `,
      [permission.code, permission.description]
    );
  }

  for (const [roleName, permissionCodes] of Object.entries(rolePermissions)) {
    const roleResult = await client.query('SELECT id FROM roles WHERE name = $1', [roleName]);
    if (roleResult.rowCount === 0) {
      continue;
    }

    for (const permissionCode of permissionCodes) {
      await client.query(
        `
          INSERT INTO role_permissions (role_id, permission_id)
          SELECT $1, id FROM permissions WHERE code = $2
          ON CONFLICT DO NOTHING;
        `,
        [roleResult.rows[0].id, permissionCode]
      );
    }
  }
}

async function seedUsers() {
  const client = createClient(dbConfig.database);
  await client.connect();

  try {
    await seedRoles(client);

    for (const user of users) {
      const plain = process.env.SEED_PASSWORD || 'Password123!';
      const hash = await bcrypt.hash(plain, 10);
      const role = normalizeRole(user.role);

      const userResult = await client.query(
        `
          INSERT INTO users (name, email, password_hash, pay_level, role, department)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (email) DO UPDATE SET
            name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            pay_level = EXCLUDED.pay_level,
            role = EXCLUDED.role,
            department = EXCLUDED.department,
            updated_at = NOW()
          RETURNING id;
        `,
        [user.name, user.email.toLowerCase(), hash, user.pay_level, role, user.department]
      );

      await client.query(
        `
          INSERT INTO user_roles (user_id, role_id)
          SELECT $1, id FROM roles WHERE name = $2
          ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_at = NOW();
        `,
        [userResult.rows[0].id, role]
      );

      console.log(`Seeded user: ${user.email}`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    console.log(`Using database: ${dbConfig.database}`);
    await ensureDatabase();
    await applySchema();
    await seedUsers();
    console.log('Database bootstrap complete.');
  } catch (error) {
    console.error('Database bootstrap failed:', error.message);
    process.exitCode = 1;
  }
}

main();