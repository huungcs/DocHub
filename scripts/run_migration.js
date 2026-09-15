const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '001_initial_schema.sql'), 'utf8');

  const client = new Client({
    host: 'db.ethrdeaeemkjgolmkrmq.supabase.co',
    port: 5432,
    user: 'postgres',
    password: 'oqna cdjv lkvs oysz',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  console.log('Connecting to PostgreSQL...');
  await client.connect();
  console.log('Connected! Executing migration...');

  try {
    await client.query(sql);
    console.log('Migration 001_initial_schema.sql executed SUCCESSFULLY!');

    // Verify tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Public tables created:', res.rows.map(r => r.table_name));

    // Reload PostgREST schema cache
    await client.query('NOTIFY pgrst, \'reload schema\';');
    console.log('Notified PostgREST to reload schema cache.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate().catch(console.error);
