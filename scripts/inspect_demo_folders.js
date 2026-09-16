const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) {
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[match[1]] = val;
  }
}

const client = new Client({
  host: process.env.SUPABASE_DB_HOST || 'db.ethrdeaeemkjgolmkrmq.supabase.co',
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432', 10),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.SUPABASE_DB_USER || 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD || process.env.APP_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  await client.connect();
  const resOrgs = await client.query('SELECT id, name FROM organizations');
  console.log('Orgs:', resOrgs.rows);

  const resFolders = await client.query('SELECT organization_id, folder_uid, name FROM organization_folders');
  console.log('Total organization_folders:', resFolders.rows.length);
  for (const f of resFolders.rows) {
    console.log('  Org:', f.organization_id, 'folder_uid:', f.folder_uid, 'name:', f.name);
  }

  const resWs = await client.query('SELECT user_id, revision, updated_at FROM user_workspaces');
  console.log('Workspaces:', resWs.rows);

  for (const w of resWs.rows) {
    const resState = await client.query('SELECT state FROM user_workspaces WHERE user_id = $1', [w.user_id]);
    const state = resState.rows[0]?.state;
    console.log('Workspace for user', w.user_id, 'folders count:', state?.folders?.length);
    console.log('  Folders in workspace:', state?.folders?.map(f => `${f.id}: ${f.name}`));
  }

  const resDocs = await client.query('SELECT * FROM documents_index WHERE organization_id = $1', ['47d3f2d7-9879-4c12-8f94-6edafcf2e672']);
  console.log('documents_index for CORN UNI:', resDocs.rows.length, resDocs.rows);

  const resAcl = await client.query('SELECT * FROM folder_acl_entries WHERE organization_id = $1', ['47d3f2d7-9879-4c12-8f94-6edafcf2e672']);
  console.log('ACL entries for CORN UNI:', resAcl.rows.length, resAcl.rows.map(r => `${r.folder_uid}: ${r.principal_type} - ${r.role}`));

  await client.end();
})();
