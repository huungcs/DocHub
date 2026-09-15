const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match && !match[1].startsWith('#')) {
    env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

async function main() {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY
  };

  const rUsers = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', { headers });
  const users = await rUsers.json();
  console.log('Auth Users:', users?.users?.map(u => ({ id: u.id, email: u.email })));

  const rOrgs = await fetch(env.SUPABASE_URL + '/rest/v1/organizations?select=*', { headers });
  console.log('Orgs:', await rOrgs.json());

  const rMembers = await fetch(env.SUPABASE_URL + '/rest/v1/organization_members?select=*', { headers });
  console.log('Members:', await rMembers.json());

  const rWorkspaces = await fetch(env.SUPABASE_URL + '/rest/v1/user_workspaces?select=user_id,revision,updated_at', { headers });
  console.log('Workspaces:', await rWorkspaces.json());
}

main().catch(console.error);
