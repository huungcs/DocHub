const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..', '..');
const worker = fs.readFileSync(
  path.join(projectRoot, 'src', 'integrations', 'google-drive', 'stream-worker.js'),
  'utf8'
);
const bridge = fs.readFileSync(
  path.join(projectRoot, 'src', 'integrations', 'supabase', 'cloud-bridge.js'),
  'utf8'
);
const template = fs.readFileSync(path.join(projectRoot, 'src', 'app', 'index.template.html'), 'utf8');

test('Drive stream forwards browser byte ranges without putting OAuth tokens in URLs', () => {
  assert.match(worker, /request\.headers\.get\('Range'\)/);
  assert.match(worker, /headers\.set\('Range', range\)/);
  assert.match(worker, /alt=media/);
  assert.match(worker, /Authorization: `Bearer \$\{stream\.googleToken\}`/);
  assert.doesNotMatch(worker, /searchParams\.set\([^\n]*token/i);
});

test('Drive stream tokens are memory-only and stream sessions expire', () => {
  assert.match(worker, /const streams = new Map\(\)/);
  assert.match(worker, /expiresAt: Date\.now\(\) \+ 55 \* 60 \* 1000/);
  assert.match(worker, /DOCHUB_STREAM_RELEASE/);
  assert.doesNotMatch(worker, /localStorage|sessionStorage|indexedDB/);
});

test('Media studio prefers Drive streaming and keeps Blob fallback', () => {
  assert.match(bridge, /api\.getAssetStream = async/);
  assert.match(bridge, /api\.requirePermission\(parentFolderId, 'read'\)/);
  assert.match(template, /session\.stream\?null:await bridge\.blob\(item\)/);
  assert.match(template, /s\.stream\?\.url\|\|url\(s\.blob\)/);
});
