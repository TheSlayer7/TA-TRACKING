require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { roles, rolePermissions, permissions, normalizeRole } = require('../src/lib/rbac');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432
});

async function seed() {
  const users = [
    { name: 'Ravi TA', email: 'ta@siteimade.local', pay_level: 8, role: 'TA', department: 'Computer Science' },
    { name: 'Anita Faculty', email: 'faculty@siteimade.local', pay_level: 11, role: 'Faculty', department: 'Computer Science' },
    { name: 'Admin User', email: 'admin@siteimade.local', pay_level: 14, role: 'Admin', department: 'Administration' }
  ];

  try {
    const client = await pool.connect();

    await client.query('ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_id_key;');

    for (const role of roles) {
      await client.query(
        `INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING;`,
        [role, `${role} role`]
      );
    }

    for (const permission of permissions) {
      await client.query(
        `INSERT INTO permissions (code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING;`,
        [permission.code, permission.description]
      );
    }

    for (const [roleName, permissionCodes] of Object.entries(rolePermissions)) {
      const roleResult = await client.query('SELECT id FROM roles WHERE name = $1', [roleName]);
      if (roleResult.rowCount === 0) continue;

      for (const permissionCode of permissionCodes) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = $2 ON CONFLICT DO NOTHING;`,
          [roleResult.rows[0].id, permissionCode]
        );
      }
    }

    for (const u of users) {
      const plain = process.env.SEED_PASSWORD || 'Password123!';
      const hash = await bcrypt.hash(plain, 10);
      const role = normalizeRole(u.role);

      const query = `
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
      `;

      const result = await client.query(query, [u.name, u.email.toLowerCase(), hash, u.pay_level, role, u.department]);

      await client.query(
        `
          INSERT INTO user_roles (user_id, role_id)
          SELECT $1, id FROM roles WHERE name = $2
          ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, assigned_at = NOW();
        `,
        [result.rows[0].id, role]
      );

      console.log(`Seeded user: ${u.email}`);
    }

    client.release();
    console.log('Seeding complete.');
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
