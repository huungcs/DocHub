/**
 * DocHub Cloud Bridge
 * Kết nối giao diện DocHub với Supabase Database & Google Drive API
 */
(() => {
  'use strict';

  const config = window.DOCHUB_CONFIG || {
    SUPABASE_URL: 'https://ethrdeaeemkjgolmkrmq.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_bnVc3KISKdPHUdKIHoKDzQ_XX0qf16K',
    GOOGLE_DRIVE_FOLDER_NAME: 'DocHub - Dữ liệu cá nhân',
    DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file'
  };

  // Khởi tạo Supabase Client
  let supabase = null;
  if (window.supabase?.createClient) {
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    window.DocHubSupabase = supabase;
  }

  let currentUser = null;
  let providerToken = null;
  let googleDriveFolderId = null;
  let revision = 1;
  let conflict = false;
  let timer = null;
  let pendingState = null;
  let saveQueue = Promise.resolve();

  // Khởi tạo IndexedDB cục bộ làm bộ đệm tốc độ cao
  const DB_NAME = 'dochub_cloud_cache_v1';
  function openCacheDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheSet(store, key, val) {
    try {
      const db = await openCacheDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
    } catch (_) {}
  }

  async function cacheGet(store, key) {
    try {
      const db = await openCacheDB();
      return await new Promise(res => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function cacheDelete(store, key) {
    try {
      const db = await openCacheDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
    } catch (_) {}
  }

  // Đối tượng API thay thế cho window.DocHubAPI
  const api = {
    get connected() {
      return !!currentUser;
    },
    get isDriveConnected() {
      return !!providerToken;
    },
    get user() {
      return currentUser;
    },
    get revision() {
      return revision;
    },
    get conflict() {
      return conflict;
    }
  };

  // Khởi tạo và kiểm tra phiên đăng nhập
  api.ready = (async () => {
    if (!supabase) {
      console.warn('DocHub: Chưa nạp thư viện Supabase JS.');
      return false;
    }

    try {
      // 1. Kiểm tra session hiện tại
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        currentUser = session.user;
        providerToken = session.provider_token || null;

        // Lưu hoặc lấy lại provider_token nếu đã lưu trước đó
        if (providerToken) {
          sessionStorage.setItem('dochub_google_token', providerToken);
        } else {
          providerToken = sessionStorage.getItem('dochub_google_token');
        }

        // Lấy thư mục gốc trên Google Drive nếu có token
        if (providerToken && window.DocHubDrive) {
          try {
            googleDriveFolderId = await window.DocHubDrive.getOrCreateAppFolder(providerToken, config.GOOGLE_DRIVE_FOLDER_NAME);
            console.log('DocHub: Đã kết nối thư mục Google Drive ID:', googleDriveFolderId);
          } catch (driveErr) {
            console.warn('DocHub: Lỗi kết nối Google Drive (Token có thể đã hết hạn):', driveErr);
          }
        }
        return true;
      }
      return false;
    } catch (err) {
      console.warn('DocHub Cloud Init Error:', err);
      return false;
    }
  })();

  /**
   * Đọc trạng thái không gian làm việc của người dùng từ Supabase
   */
  api.loadState = async () => {
    await api.ready;
    if (!currentUser || !supabase) return null;

    try {
      const { data, error } = await supabase
        .from('user_workspaces')
        .select('state, revision')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (error) {
        console.warn('Lỗi đọc dữ liệu từ Supabase:', error);
        return null;
      }

      if (data && data.state) {
        revision = data.revision || 1;
        console.log(`DocHub: Đã tải không gian làm việc từ Supabase (Revision ${revision})`);
        return data.state;
      }

      // Người dùng mới: Chưa có workspace trong DB -> sẽ trả về null để app khởi tạo seed ban đầu
      return null;
    } catch (err) {
      console.error('DocHub loadState failed:', err);
      return null;
    }
  };

  /**
   * Lập lịch lưu trạng thái (Debounce 350ms) lên Supabase
   */
  api.scheduleState = (state) => {
    if (!currentUser || conflict || !supabase) return;
    pendingState = JSON.parse(JSON.stringify(state));
    clearTimeout(timer);
    timer = setTimeout(() => api.flush(), 350);
  };

  /**
   * Đẩy ngay trạng thái đang chờ lên Supabase
   */
  api.flush = () => {
    clearTimeout(timer);
    if (!pendingState || conflict || !currentUser || !supabase) return saveQueue;

    const snapshot = pendingState;
    pendingState = null;

    saveQueue = saveQueue.then(async () => {
      try {
        const nextRevision = revision + 1;
        const { error } = await supabase
          .from('user_workspaces')
          .upsert({
            user_id: currentUser.id,
            state: snapshot,
            revision: nextRevision,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (error) throw error;
        revision = nextRevision;
        document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: true } }));
      } catch (err) {
        console.error('Lỗi lưu dữ liệu lên Supabase:', err);
        document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: false, error: err.message } }));
      }
    });

    return saveQueue;
  };

  /**
   * Lưu trữ tệp tài liệu: Đẩy lên Google Drive của khách hàng và lưu cache cục bộ
   */
  api.putAsset = async (id, blob) => {
    // 1. Luôn lưu cache cục bộ để xem trước tức thì
    await cacheSet('assets', id, blob);

    // 2. Nếu có kết nối Google Drive, tải lên Drive của khách
    if (providerToken && googleDriveFolderId && window.DocHubDrive) {
      try {
        const fileMeta = await window.DocHubDrive.uploadFile(
          providerToken,
          googleDriveFolderId,
          blob,
          id,
          blob.type || 'application/octet-stream'
        );
        // Lưu ánh xạ ID nội bộ -> Google Drive File ID
        await cacheSet('meta', id, { driveId: fileMeta.id, webViewLink: fileMeta.webViewLink });

        // Ghi nhận vào bảng documents_index của Supabase nếu đang đăng nhập
        if (currentUser && supabase) {
          await supabase.from('documents_index').upsert({
            user_id: currentUser.id,
            doc_uid: id,
            name: fileMeta.name || id,
            ext: (id.split('.').pop() || '').toLowerCase(),
            bytes: blob.size || 0,
            mime_type: blob.type,
            google_drive_file_id: fileMeta.id,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,doc_uid' });
        }
      } catch (driveErr) {
        console.warn('Lỗi tải tệp lên Google Drive:', driveErr);
      }
    }
  };

  /**
   * Lấy tệp tài liệu: Đọc từ cache trước, nếu không có thì tải từ Google Drive
   */
  api.getAsset = async (id) => {
    // 1. Kiểm tra cache IndexedDB
    const cached = await cacheGet('assets', id);
    if (cached) return cached;

    // 2. Nếu không có trong cache, tải từ Google Drive
    if (providerToken && window.DocHubDrive) {
      const meta = await cacheGet('meta', id);
      if (meta?.driveId) {
        try {
          const blob = await window.DocHubDrive.downloadFileBlob(providerToken, meta.driveId);
          if (blob) {
            await cacheSet('assets', id, blob);
            return blob;
          }
        } catch (e) {
          console.warn('Tải tệp từ Google Drive thất bại:', e);
        }
      }
    }
    return null;
  };

  /**
   * Xóa tệp tài liệu
   */
  api.removeAsset = async (id) => {
    await cacheDelete('assets', id);
    if (providerToken && window.DocHubDrive) {
      const meta = await cacheGet('meta', id);
      if (meta?.driveId) {
        await window.DocHubDrive.deleteFile(providerToken, meta.driveId);
        await cacheDelete('meta', id);
      }
    }
    if (currentUser && supabase) {
      await supabase.from('documents_index').delete().match({ user_id: currentUser.id, doc_uid: id });
    }
  };

  /**
   * Đăng nhập Google và cấp quyền Google Drive
   */
  api.loginWithGoogle = async () => {
    if (!supabase) return;
    const redirectUrl = window.location.href.split('#')[0];
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: `${config.DRIVE_SCOPE} email profile`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        },
        redirectTo: redirectUrl
      }
    });
    if (error) {
      alert('Đăng nhập Google thất bại: ' + error.message);
    }
  };

  /**
   * Đăng xuất tài khoản
   */
  api.logout = async () => {
    sessionStorage.removeItem('dochub_google_token');
    if (supabase) {
      await supabase.auth.signOut();
    }
    window.location.reload();
  };

  // Gán vào window
  window.DocHubAPI = api;
})();
