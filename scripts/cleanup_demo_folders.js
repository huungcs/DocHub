const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
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

const DEMO_FOLDER_UIDS = [
  'board','board-docs','executive','business','business-plan','customers',
  'admin','salary','salary-forms','allowance','discipline','administration',
  'finance','sales-policy','finance-reports','hr','recruitment','training',
  'employee-records','processes','production','admin-processes','archive','supplier-contracts'
];

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
  console.log('Connected to PostgreSQL.');

  // 1. Delete from organization_drive_folders
  const resDelDrive = await client.query(
    'DELETE FROM organization_drive_folders WHERE folder_uid = ANY($1) RETURNING *',
    [DEMO_FOLDER_UIDS]
  );
  console.log('Deleted demo organization_drive_folders:', resDelDrive.rows.length);

  // 2. Delete demo ACL entries
  const resDelAcl = await client.query(
    'DELETE FROM folder_acl_entries WHERE folder_uid = ANY($1) RETURNING *',
    [DEMO_FOLDER_UIDS]
  );
  console.log('Deleted demo folder_acl_entries:', resDelAcl.rows.length);

  // 3. Delete demo documents in documents_index if any
  const resDelDocs = await client.query(
    'DELETE FROM documents_index WHERE parent_folder_id = ANY($1) RETURNING *',
    [DEMO_FOLDER_UIDS]
  );
  console.log('Deleted demo documents_index:', resDelDocs.rows.length);

  // 4. Delete demo folders from organization_folders
  const resDelFolders = await client.query(
    'DELETE FROM organization_folders WHERE folder_uid = ANY($1) RETURNING *',
    [DEMO_FOLDER_UIDS]
  );
  console.log('Deleted demo organization_folders:', resDelFolders.rows.length);

  // 3. Clean user_workspaces state
  const resWs = await client.query('SELECT user_id, state FROM user_workspaces');
  for (const row of resWs.rows) {
    if (!row.state) continue;
    let modified = false;
    if (Array.isArray(row.state.folders)) {
      const origLen = row.state.folders.length;
      row.state.folders = row.state.folders.filter(f => !DEMO_FOLDER_UIDS.includes(f.id));
      if (row.state.folders.length !== origLen) modified = true;
    }
    if (Array.isArray(row.state.documents)) {
      const origLen = row.state.documents.length;
      row.state.documents = row.state.documents.filter(d => !d.sample && d.source !== 'sample' && d.source !== 'bundled' && !DEMO_FOLDER_UIDS.includes(d.parentId));
      if (row.state.documents.length !== origLen) modified = true;
    }
    if (Array.isArray(row.state.acl)) {
      const origLen = row.state.acl.length;
      row.state.acl = row.state.acl.filter(a => !DEMO_FOLDER_UIDS.includes(a.resourceId));
      if (row.state.acl.length !== origLen) modified = true;
    }

    if (modified) {
      await client.query(
        'UPDATE user_workspaces SET state = $1, updated_at = NOW() WHERE user_id = $2',
        [row.state, row.user_id]
      );
      console.log('Cleaned demo folders from user_workspaces for user:', row.user_id);
    }
  }

  // 4. Verify remaining folders for all organizations
  const checkFolders = await client.query('SELECT organization_id, folder_uid, name FROM organization_folders');
  console.log('Remaining organization_folders in DB:', checkFolders.rows.length);
  for (const f of checkFolders.rows) {
    console.log('  Org:', f.organization_id, 'folder_uid:', f.folder_uid, 'name:', f.name);
  }

  await client.end();
})();
