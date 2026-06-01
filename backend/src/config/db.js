const { Pool } = require('pg');
require('dotenv').config();

// Create a new PostgreSQL connection pool
const poolConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
};

if (process.env.DB_PASSWORD && String(process.env.DB_PASSWORD).trim()) {
    poolConfig.password = String(process.env.DB_PASSWORD);
}

const pool = new Pool(poolConfig);

// Test the connection
pool.on('connect', () => {
    console.log('🔗 Connected to the PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle database client', err);
    process.exit(-1);
});

module.exports = {
    pool,
    query: pool.query.bind(pool),
    connect: pool.connect.bind(pool),
    end: pool.end.bind(pool)
};