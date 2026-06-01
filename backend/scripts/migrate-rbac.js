require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationPath = path.join(__dirname, '..', 'sql', 'migrations', '001-rbac.sql');

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

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ta_calculator'
};

async function main() {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = splitSqlStatements(sql);

    for (const statement of statements) {
      await client.query(statement);
    }

    console.log('RBAC migration applied.');
  } catch (error) {
    console.error('RBAC migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();