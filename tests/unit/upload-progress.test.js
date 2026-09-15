const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const driveClient = fs.readFileSync(path.join(root, 'src', 'integrations', 'google-drive', 'client.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src', 'integrations', 'supabase', 'cloud-bridge.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app', 'index.template.html'), 'utf8');

test('Drive uploads use resumable sessions and byte-aligned chunks', () => {
  assert.match(driveClient, /uploadType=resumable/);
  assert.match(driveClient, /UPLOAD_CHUNK_SIZE = 8 \* 1024 \* 1024/);
  assert.match(driveClient, /Content-Range/);
  assert.match(driveClient, /xhr\.upload\.onprogress/);
});

test('Upload progress flows from Drive through the cloud bridge', () => {
  assert.match(bridge, /const \{ onProgress, signal \} = options/);
  assert.match(bridge, /\{ onProgress, signal \}/);
  assert.match(bridge, /phase: 'local'/);
});

test('Upload center exposes progress, cancellation and retry controls', () => {
  assert.match(app, /id="uploadCenter"/);
  assert.match(app, /role="progressbar"/);
  assert.match(app, /case 'cancel-upload'/);
  assert.match(app, /case 'retry-upload'/);
  assert.match(app, /controller\?\.abort\(\)/);
});

test('Finished upload panels auto-dismiss without hiding active or failed jobs', () => {
  assert.match(app, /clearTimeout\(uploadHideTimer\)/);
  assert.match(app, /!active\.length/);
  assert.match(app, /!jobs\.some\(j=>j\.running\)/);
  assert.match(app, /!jobs\.some\(j=>j\.status==='error'\)/);
  assert.match(app, /12000:3500/);
  assert.match(app, /if\(progress\.error\)job\.error=progress\.error/);
});

test('Toast text has explicit foreground and missing Drive connection explains local storage', () => {
  assert.match(app, /\.toast\{color:var\(--ink\)\}/);
  assert.match(bridge, /!providerToken \? 'Chưa kết nối Google Drive/);
  assert.match(driveClient, /if\(xhr\.status===401\)/);
});
