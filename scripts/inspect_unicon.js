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

  const r = await fetch(env.SUPABASE_URL + '/rest/v1/user_workspaces?user_id=eq.524631f3-80ee-4748-963a-62436f4794e0&select=state', { headers });
  const data = await r.json();
  const state = data[0]?.state;
  console.log('Unicon users:', state?.users);
  console.log('Unicon folders count:', state?.folders?.length);
  console.log('Unicon documents count:', state?.documents?.length);
  console.log('Unicon acl count:', state?.acl?.length);
  console.log('Unicon acl rules:', state?.acl?.filter(a => a.principalId?.includes('user-c89c434c')));
}

main().catch(console.error);
