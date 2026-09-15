const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'DocHub-v2.2.html');
const destPath = path.join(__dirname, '..', 'index.html');

let html = fs.readFileSync(srcPath, 'utf8');

// 1. Inject Supabase JS and DocHub Cloud Bridge scripts in <head>
const headScripts = `
  <!-- Supabase JS & DocHub Cloud Integrations -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="./src/config.js"></script>
  <script src="./src/google-drive.js"></script>
  <script src="./src/dochub-cloud-bridge.js"></script>
`;

html = html.replace('<head>', '<head>' + headScripts);

// 2. Replace the old local python server DocHubAPI mock with a comment since dochub-cloud-bridge.js handles window.DocHubAPI
const oldApiRegex = /<script>\s*\/\*\s*Optional same-origin local backend[\s\S]*?window\.DocHubAPI=api;\s*\}\)\(\);\s*<\/script>/;

if (oldApiRegex.test(html)) {
  html = html.replace(oldApiRegex, `<!-- DocHubAPI is provided by src/dochub-cloud-bridge.js -->`);
  console.log('Successfully replaced old local mock API with DocHub Cloud Bridge.');
} else {
  console.warn('Old API regex did not match; checking fallback.');
}

// 3. Enhance Topbar with Google Sign-in / Cloud status button
const oldDemoLabel = `<span class="demo-label"><span></span> Bản trải nghiệm</span>`;
const newCloudWidget = `
      <div id="cloudAuthBar" style="display:flex;align-items:center;gap:10px;">
        <button id="btnGoogleAuth" class="btn sm" data-action="google-auth" style="background:#fff;color:#3c4043;border:1px solid #dadce0;box-shadow:0 1px 2px #3c404326;font-size:12px;font-weight:600;padding:5px 12px;border-radius:6px;display:inline-flex;align-items:center;gap:8px;">
          <svg style="width:16px;height:16px;" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
          <span id="btnGoogleAuthText">Đăng nhập Google & Drive</span>
        </button>
        <span class="demo-label" id="cloudStatusBadge" style="margin:0;"><span id="cloudStatusDot"></span> <span id="cloudStatusText">Chế độ xem trước</span></span>
      </div>
`;

if (html.includes(oldDemoLabel)) {
  html = html.replace(oldDemoLabel, newCloudWidget);
  console.log('Successfully added Cloud Auth button to topbar.');
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
          if (!isConnected) {
            menuHtml += menuItem('google-auth', 'Đăng nhập Google & Kết nối Drive', 'sparkles');
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
            await window.DocHubAPI.loginWithGoogle();
          }
          break;
        case 'google-logout':
          if (window.DocHubAPI?.logout) {
            await window.DocHubAPI.logout();
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
    await window.DocHubAPI.ready;
    const api = window.DocHubAPI;
    const btn = document.getElementById('btnGoogleAuth');
    const btnText = document.getElementById('btnGoogleAuthText');
    const dot = document.getElementById('cloudStatusDot');
    const statusText = document.getElementById('cloudStatusText');
    const profileBtn = document.querySelector('.profile-button');

    if (api.connected && api.user) {
      const u = api.user;
      const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email;
      const email = u.email;
      const avatarUrl = u.user_metadata?.avatar_url || u.user_metadata?.picture;

      if (btn) btn.style.display = 'none';
      if (statusText) statusText.textContent = api.isDriveConnected ? 'Đã kết nối Google Drive' : 'Đã đăng nhập Supabase';
      if (dot) dot.style.background = '#227358';

      // Cập nhật Profile button
      if (profileBtn) {
        const strong = profileBtn.querySelector('strong');
        const small = profileBtn.querySelector('small');
        const av = profileBtn.querySelector('.avatar');
        if (strong) strong.textContent = name;
        if (small) small.textContent = email;
        if (av && avatarUrl) {
          av.style.backgroundImage = \`url('\${avatarUrl}')\`;
          av.style.backgroundSize = 'cover';
          av.textContent = '';
        }
      }
    } else {
      if (btn) btn.style.display = 'inline-flex';
      if (statusText) statusText.textContent = 'Chế độ xem trước';
    }
  })();
`;

html = html.replace('</body>', `<script>${authUiScript}</script></body>`);

fs.writeFileSync(destPath, html, 'utf8');
console.log('Successfully built index.html! File size:', fs.statSync(destPath).size);
