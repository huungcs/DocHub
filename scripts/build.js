const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const srcPath = path.join(projectRoot, 'src', 'app', 'index.template.html');
const distPath = path.join(projectRoot, 'dist');
const assetsPath = path.join(distPath, 'assets');
const destPath = path.join(distPath, 'index.html');

fs.mkdirSync(assetsPath, { recursive: true });

let html = fs.readFileSync(srcPath, 'utf8');

// 1. Inject High-Speed Preconnect in <head> and Cloud Bridge scripts before </head> to avoid blocking CSS
const preconnectTags = `
  <!-- High-Speed Preconnect & DNS-Prefetch -->
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="dns-prefetch" href="https://cdn.jsdelivr.net">
  <link rel="preconnect" href="https://ethrdeaeemkjgolmkrmq.supabase.co" crossorigin>
  <link rel="dns-prefetch" href="https://ethrdeaeemkjgolmkrmq.supabase.co">
  <script>
    try {
      if (localStorage.getItem('dochub.demo_mode') === 'true') {
        document.documentElement.classList.add('demo-mode-active');
      }
    } catch(_) {}
  </script>
`;

const bridgeScripts = `
  <!-- Supabase JS & DocHub Cloud Integrations (Loaded after inline CSS to prevent render-blocking) -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="./assets/client-config.js"></script>
  <script src="./assets/search-engine.js"></script>
  <script src="./assets/google-drive-client.js"></script>
  <script src="./assets/supabase-cloud-bridge.js"></script>
`;

html = html.replace('<head>', '<head>' + preconnectTags);
html = html.replace('</head>', bridgeScripts + '</head>');

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
          const isDemo = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('dochub.demo_mode') === 'true';
          const usrRole = isConnected ? 'Tài khoản đám mây (Supabase + Google Drive)' : isDemo ? 'Bản trải nghiệm Demo (Dữ liệu mẫu)' : 'Tài khoản mẫu cục bộ';
          
          let menuHtml = \`<p class="menu-label">\${e(usrName)} · \${e(usrRole)}</p>\`;
          if(isConnected) menuHtml += menuItem('switch-workspace','Chuyển không gian','building');
          if (!isConnected) {
            menuHtml += menuItem('google-auth', 'Đăng nhập Google & Kết nối Drive', 'sparkles');
          } else if (api?.organization?.role === 'owner' || !api?.organization) {
            menuHtml += menuItem('google-reconnect', 'Kết nối lại Google Drive', 'sparkles');
          }
          menuHtml += menuItem('settings', 'Cài đặt & phân quyền', 'settings', '', 'data-section="general"');
          menuHtml += menuItem('backup-all', 'Xuất bản sao lưu (ZIP)', 'download');
          menuHtml += menuItem('settings', 'Giao diện hiển thị', 'sun', '', 'data-section="appearance"');
          menuHtml += menuItem('help', 'Giới thiệu bản mẫu', 'info');
          
          if (isConnected) {
            menuHtml += \`<div class="menu-divider"></div>\`;
            menuHtml += menuItem('google-logout', 'Đăng xuất tài khoản', 'trash');
          } else if (isDemo) {
            menuHtml += \`<div class="menu-divider"></div>\`;
            menuHtml += menuItem('exit-demo', 'Thoát bản Demo (Quay lại đăng nhập)', 'close');
          }
          showMenu(target, menuHtml);
          break;
        }
        case 'exit-demo':
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('dochub.demo_mode');
          }
          location.reload();
          break;
        case 'google-auth':
          if (window.DocHubAPI?.loginWithGoogle) {
            try {
              await window.DocHubAPI.loginWithGoogle();
            } catch (error) {
              toast(error?.message || 'Không thể bắt đầu đăng nhập Google.', 'error');
            }
          }
          break;
        case 'google-reconnect':
          if (window.DocHubAPI?.loginWithGoogle) {
            try {
              await window.DocHubAPI.loginWithGoogle({ reconnectDrive: true });
            } catch (error) {
              toast(error?.message || 'Không thể kết nối lại Google Drive.', 'error');
            }
          }
          break;
        case 'google-logout':
          if (window.DocHubAPI?.logout) {
            try {
              if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('dochub.demo_mode');
              if (typeof localStorage !== 'undefined') localStorage.removeItem('dochub.demo_mode');
              document.documentElement.classList.remove('demo-mode-active');
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
    const api = window.DocHubAPI;
    const dot = document.getElementById('cloudStatusDot');
    const statusText = document.getElementById('cloudStatusText');
    const statusBadge = document.getElementById('cloudStatusBadge');
    const profileBtn = document.querySelector('.profile-button');
    const authScreen = document.getElementById('authScreen');
    const loginButton = document.getElementById('loginGoogleButton');
    const loginButtonText = document.getElementById('loginGoogleText');
    const loginStatus = document.getElementById('loginStatus');
    const app = document.getElementById('app');

    function lockWorkspace(locked) {
      document.body.classList.toggle('auth-locked', locked);
      if (authScreen) authScreen.hidden = !locked;
      if (app) {
        app.inert = locked;
        if (locked) app.setAttribute('aria-hidden', 'true');
        else app.removeAttribute('aria-hidden');
      }
    }

    function renderAuthUi() {
      if (!api) {
        lockWorkspace(true);
        if (authScreen) authScreen.setAttribute('aria-busy', 'false');
        if (loginButton) loginButton.disabled = true;
        if (loginButtonText) loginButtonText.textContent = 'Không thể kết nối dịch vụ đăng nhập';
        if (loginStatus) {
          loginStatus.textContent = 'Hãy kiểm tra kết nối mạng và tải lại trang.';
          loginStatus.classList.add('is-error');
        }
        return;
      }

      const connected = api.connected && api.user;
      const driveConnected = connected && api.isDriveConnected;
      const hasStoredSession = typeof localStorage !== 'undefined' && Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      const busy = ['redirecting', 'connecting_drive', 'signing_out'].includes(api.authStatus) || (api.authStatus === 'checking' && hasStoredSession);
      const needsConfig = api.authStatus === 'configuration_required' || api.googleProviderEnabled === false;

      const isDemo = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('dochub.demo_mode') === 'true') ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('dochub.demo_mode') === 'true');
      if (isDemo && !connected) {
        lockWorkspace(false);
      } else {
        lockWorkspace(!connected);
      }
      if (authScreen) authScreen.setAttribute('aria-busy', busy ? 'true' : 'false');
      if (loginButton) {
        loginButton.disabled = busy || needsConfig;
        loginButton.classList.toggle('is-busy', busy);
      }
      if (loginButtonText) {
        loginButtonText.textContent = api.authStatus === 'redirecting' ? 'Đang chuyển đến Google…' :
          api.authStatus === 'checking' && hasStoredSession ? 'Đang kiểm tra phiên đăng nhập…' :
          api.authStatus === 'signing_out' ? 'Đang đăng xuất…' :
          needsConfig ? 'Google OAuth chưa được cấu hình' :
          api.authStatus === 'error' || api.authStatus === 'unavailable' ? 'Thử đăng nhập lại với Google' :
          'Tiếp tục với Google';
      }
      if (loginStatus) {
        loginStatus.classList.toggle('is-error', needsConfig || api.authStatus === 'error' || api.authStatus === 'unavailable');
        loginStatus.textContent = busy ? 'Vui lòng chờ trong giây lát.' :
          needsConfig ? 'Quản trị viên cần bật Google Provider trong Supabase.' :
          api.authError || 'Dùng tài khoản Google đã được tổ chức của bạn cho phép.';
      }

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
          const fallback = String(name || 'U').split(/\\s+/).filter(Boolean).map(part => part[0]).slice(-2).join('').toUpperCase();
          if (avatarUrl) {
            av.dataset.avatarUrl = avatarUrl;
            av.style.backgroundImage = 'url(' + JSON.stringify(avatarUrl) + ')';
            av.style.backgroundSize = 'cover';
            av.style.backgroundPosition = 'center';
            av.textContent = '';
            const image = new Image();
            image.onerror = () => {
              if (av.dataset.avatarUrl !== avatarUrl) return;
              av.style.backgroundImage = '';
              av.textContent = fallback;
            };
            image.src = avatarUrl;
          } else {
            delete av.dataset.avatarUrl;
            av.style.backgroundImage = '';
            av.textContent = fallback;
          }
        }
      }
    }

    if (loginButton) {
      loginButton.addEventListener('click', async () => {
        if (!api?.loginWithGoogle) return;
        try {
          loginButton.disabled = true;
          loginButton.classList.add('is-busy');
          if (loginButtonText) loginButtonText.textContent = 'Đang chuyển đến Google…';
          if (loginStatus) {
            loginStatus.textContent = 'Một cửa sổ đăng nhập an toàn sắp được mở.';
            loginStatus.classList.remove('is-error');
          }
          await api.loginWithGoogle();
        } catch (error) {
          if (loginStatus) {
            loginStatus.textContent = error?.message || 'Không thể bắt đầu đăng nhập Google.';
            loginStatus.classList.add('is-error');
          }
          renderAuthUi();
        }
      });
    }

    const demoButton = document.getElementById('btnEnterDemo');
    if (demoButton) {
      demoButton.addEventListener('click', () => {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('dochub.demo_mode', 'true');
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('dochub.demo_mode', 'true');
        }
        document.documentElement.classList.add('demo-mode-active');
        lockWorkspace(false);
        if (statusBadge) statusBadge.style.display = '';
        if (statusText) statusText.textContent = 'Bản trải nghiệm (Dữ liệu mẫu)';
        if (dot) dot.style.background = 'var(--amber)';
      });
    }

    document.addEventListener('dochub:auth', renderAuthUi);
    renderAuthUi();
    if (!api) return;
    await api.ready;
    renderAuthUi();
  })();
`;

html = html.replace('</body>', `<script>${authUiScript}</script></body>`);

const browserAssets = [
  ['src/app/search-engine.js', 'search-engine.js'],
  ['src/app/sample-data.js', 'sample-data.js'],
  ['src/app/jszip.min.js', 'jszip.min.js'],
  ['src/config/client-config.js', 'client-config.js'],
  ['src/integrations/google-drive/client.js', 'google-drive-client.js'],
  ['src/integrations/supabase/cloud-bridge.js', 'supabase-cloud-bridge.js']
];

for (const [source, output] of browserAssets) {
  fs.copyFileSync(path.join(projectRoot, source), path.join(assetsPath, output));
}

// Must live at the site root so it can intercept the virtual media URLs.
fs.copyFileSync(
  path.join(projectRoot, 'src', 'integrations', 'google-drive', 'stream-worker.js'),
  path.join(distPath, 'drive-stream-sw.js')
);

// Static SEO & Open Graph assets
const staticSeoFiles = [
  ['robots.txt', path.join(distPath, 'robots.txt')],
  ['sitemap.xml', path.join(distPath, 'sitemap.xml')],
  ['src/assets/og-image.png', path.join(assetsPath, 'og-image.png')],
  ['src/assets/og-image.svg', path.join(assetsPath, 'og-image.svg')]
];

for (const [src, dst] of staticSeoFiles) {
  const fullSrc = path.join(projectRoot, src);
  if (fs.existsSync(fullSrc)) {
    fs.copyFileSync(fullSrc, dst);
  }
}

fs.writeFileSync(destPath, html, 'utf8');
fs.writeFileSync(path.join(projectRoot, 'index.html'), html, 'utf8');
fs.copyFileSync(srcPath, path.join(projectRoot, 'DocHub-v2.2.html'));
console.log('Successfully built dist/index.html and synced root index.html!');
