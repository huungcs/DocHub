const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..', '..');
const template = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'index.template.html'), 'utf8');
const buildScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build.js'), 'utf8');
const cloudBridge = fs.readFileSync(path.join(projectRoot, 'src', 'integrations', 'supabase', 'cloud-bridge.js'), 'utf8');

test('Auth gateway is the initial accessible surface', () => {
  assert.match(template, /<body class="auth-locked">/);
  assert.match(template, /id="authScreen"[^>]*aria-labelledby="authTitle"/);
  assert.match(template, /id="loginGoogleButton"/);
  assert.match(template, /id="loginStatus"[^>]*aria-live="polite"/);
});

test('Workspace remains inaccessible until Supabase authenticates the user', () => {
  assert.match(buildScript, /lockWorkspace\(!connected\)/);
  assert.match(buildScript, /app\.inert = locked/);
  assert.match(buildScript, /authScreen\.hidden = !locked/);
});

test('Google login button delegates to the cloud authentication bridge', () => {
  assert.match(buildScript, /loginButton\.addEventListener\('click'/);
  assert.match(buildScript, /await api\.loginWithGoogle\(\)/);
});

test('Workspace persistence is isolated by authenticated account', () => {
  assert.match(template, /STORAGE_KEY_BASE = 'dochub\.workspace\.v2'/);
  assert.match(template, /window\.DocHubAPI\?\.user\?\.id/);
  assert.match(template, /cloudAccount\?createCloudWorkspace\(cloudAccount\):createSeed\(\)/);
  assert.doesNotMatch(template, /localStorage\.getItem\(STORAGE_KEY\)/);
});

test('A new cloud account starts with a clean workspace', () => {
  assert.match(template, /function createCloudWorkspace\(account\)/);
  assert.match(template, /folders:\[root\],documents:\[\]/);
  assert.match(template, /lastFolder:'all'/);
});

test('IndexedDB file cache is namespaced by Supabase user id', () => {
  assert.match(cloudBridge, /function userCacheKey\(key\)/);
  assert.match(cloudBridge, /currentUser\?\.id \|\| 'guest'/);
  assert.match(cloudBridge, /cacheSet\('assets', userCacheKey\(id\), blob\)/);
  assert.match(cloudBridge, /cacheGet\('meta', userCacheKey\(id\)\)/);
});

test('Auth gateway includes a button to enter demo mode with pre-existing sample data', () => {
  assert.match(template, /id="btnEnterDemo"/);
  assert.match(buildScript, /sessionStorage\.setItem\('dochub\.demo_mode', 'true'\)/);
  assert.match(buildScript, /btnEnterDemo/);
});
