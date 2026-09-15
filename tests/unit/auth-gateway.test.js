const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..', '..');
const template = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'index.template.html'), 'utf8');
const buildScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build.js'), 'utf8');

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
