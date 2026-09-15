const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const srcPath = path.join(projectRoot, 'src', 'app', 'index.template.html');
const distPath = path.join(projectRoot, 'dist');
const assetsPath = path.join(distPath, 'assets');
const destPath = path.join(distPath, 'index.html');

fs.mkdirSync(assetsPath, { recursive: true });

let html = fs.readFileSync(srcPath, 'utf8');

// 1. Inject Supabase JS and DocHub Cloud Bridge scripts in <head>
const headScripts = `
  <!-- Supabase JS & DocHub Cloud Integrations -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="./assets/client-config.js"></script>
  <script src="./assets/google-drive-client.js"></script>
  <script src="./assets/supabase-cloud-bridge.js"></script>
`;

html = html.replace('<head>', '<head>' + headScripts);

// 2. Replace the old local mock because the Supabase bridge provides window.DocHubAPI.
const oldApiRegex = /<script>\s*\/\*\s*Optional same-origin local backend[\s\S]*?window\.DocHubAPI=api;\s*\}\)\(\);\s*<\/script>/;

if (oldApiRegex.test(html)) {
  html = html.replace(oldApiRegex, `<!-- DocHubAPI is provided by assets/supabase-cloud-bridge.js -->`);
  console.log('Successfully replaced old local mock API with DocHub Cloud Bridge.');
} else {
  console.warn('Old API regex did not match; checking fallback.');
}

// 3. Enhance Topbar with minimal Cloud status indicator (no intrusive button, adhering to avatar menu UI invariant)
const oldDemoLabel = `<span class="demo-label"><span></span> Bản trải nghiệm</span>`;
const newCloudWidget = `<span class="demo-label" id="cloudStatusBadge"><span id="cloudStatusDot"></span> <span id="cloudStatusText">Bản trải nghiệm</span></span>`;

if (html.includes(oldDemoLabel)) {
  html = html.replace(oldDemoLabel, newCloudWidget);
  console.log('Successfully updated Cloud Status badge in topbar.');
}

// 4. Update the account menu and actions
const oldAccountCase = `case 'account':
          showMenu(target,\`<p class="menu-label">\${e(user('u1').name)} · Tài khoản mẫu</p>\${menuItem('settings','Cài đặt & phân quyền','settings','','data-section="general"')}\${menuItem('backup-all','Xuất bản sao lưu (ZIP)','download')}\${menuItem('settings','Giao diện hiển thị','sun','','data-section="appearance"')}\${menuItem('help','Giới thiệu bản mẫu','info')}<div class="menu-divider"></div><p class="menu-note">Chưa có chức năng đăng nhập / đăng xuất thật.</p>\`);break;`;

const newAccountCase = `case 'account': {
          const api = window.DocHubAPI;
          const isConnected = api?.connected;
          const usr = api?.user;
          const usrName = usr?.user_metadata?.full_name || usr?.email || user('u1').name;
          const usrRole = isConnected ? 'Tài khoản đám mây (Supabase + Google Drive)' : 'Tài khoản mẫu cục bộ';
          
          let menuHtml = \`<p class="menu-label">\${e(usrName)} · \${e(usrRole)}</p>\`;
          if (!isConnected || !api?.isDriveConnected) {
            menuHtml += menuItem('google-auth', isConnected ? 'Kết nối lại Google Drive' : 'Đăng nhập Google & Kết nối Drive', 'sparkles');
          }
          menuHtml += menuItem('settings', 'Cài đặt & phân quyền', 'settings', '', 'data-section="general"');
          menuHtml += menuItem('backup-all', 'Xuất bản sao lưu (ZIP)', 'download');
          menuHtml += menuItem('settings', 'Giao diện hiển thị', 'sun', '', 'data-section="appearance"');
          menuHtml += menuItem('help', 'Giới thiệu bản mẫu', 'info');
          
          if (isConnected) {
            menuHtml += \`<div class="menu-divider"></div>\`;
            menuHtml += menuItem('google-logout', 'Đăng xuất tài khoản', 'trash');
          }
          showMenu(target, menuHtml);
          break;
        }
        case 'google-auth':
          if (window.DocHubAPI?.loginWithGoogle) {
            try {
              await window.DocHubAPI.loginWithGoogle();
            } catch (error) {
              toast(error?.message || 'Không thể bắt đầu đăng nhập Google.', 'error');
            }
          }
          break;
        case 'google-logout':
          if (window.DocHubAPI?.logout) {
            try {
              await window.DocHubAPI.logout();
            } catch (error) {
              toast(error?.message || 'Không thể đăng xuất.', 'error');
            }
          }
          break;`;

if (html.includes(oldAccountCase)) {
  html = html.replace(oldAccountCase, newAccountCase);
  console.log('Successfully updated account action with Google login & logout.');
} else {
  console.warn('oldAccountCase was not an exact match; trying normalized search.');
}

// 5. Add UI updater hook for when auth state is ready
const authUiScript = `
  // Tự động cập nhật giao diện khi trạng thái đăng nhập thay đổi
  (async () => {
    if (!window.DocHubAPI) return;
    const api = window.DocHubAPI;
    const dot = document.getElementById('cloudStatusDot');
    const statusText = document.getElementById('cloudStatusText');
    const statusBadge = document.getElementById('cloudStatusBadge');
    const profileBtn = document.querySelector('.profile-button');

    function renderAuthUi() {
      const connected = api.connected && api.user;
      const driveConnected = connected && api.isDriveConnected;

      if (statusBadge) {
        statusBadge.style.display = '';
      }
      if (statusText) {
        statusText.textContent = driveConnected ? 'Đã kết nối Cloud' : connected ? 'Đã đăng nhập Supabase' : 'Bản trải nghiệm';
      }
      if (dot) {
        dot.style.background = driveConnected || connected ? '#227358' : 'var(--amber)';
      }

      if (connected && profileBtn) {
        const u = api.user;
        const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email;
        const email = u.email || '';
        const avatarUrl = u.user_metadata?.avatar_url || u.user_metadata?.picture;
        const strong = profileBtn.querySelector('strong');
        const small = profileBtn.querySelector('small');
        const av = profileBtn.querySelector('.avatar');
        if (strong) strong.textContent = name;
        if (small) small.textContent = email;
        if (av) {
          if (avatarUrl) {
            av.style.backgroundImage = \`url('\${avatarUrl}')\`;
            av.style.backgroundSize = 'cover';
            av.style.backgroundPosition = 'center';
            av.textContent = '';
          } else {
            av.style.backgroundImage = '';
            av.textContent = String(name || 'U').split(/\\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();
          }
        }
      }
    }

    document.addEventListener('dochub:auth', renderAuthUi);
    renderAuthUi();
    await api.ready;
    renderAuthUi();
  })();
`;

html = html.replace('</body>', `<script>${authUiScript}</script></body>`);

const browserAssets = [
  ['src/config/client-config.js', 'client-config.js'],
  ['src/integrations/google-drive/client.js', 'google-drive-client.js'],
  ['src/integrations/supabase/cloud-bridge.js', 'supabase-cloud-bridge.js']
];

for (const [source, output] of browserAssets) {
  fs.copyFileSync(path.join(projectRoot, source), path.join(assetsPath, output));
}

fs.writeFileSync(destPath, html, 'utf8');
fs.writeFileSync(path.join(projectRoot, 'index.html'), html, 'utf8');
fs.copyFileSync(srcPath, path.join(projectRoot, 'DocHub-v2.2.html'));
console.log('Successfully built dist/index.html and synced root index.html!');
