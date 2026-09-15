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
  let driveSharingEnabled = false;
  let timer = null;
  let pendingState = null;
  let saveQueue = Promise.resolve();
  let authStatus = supabase ? 'checking' : 'unavailable';
  let authError = supabase ? null : 'Không tải được thư viện Supabase.';
  let authReadyResolve;
  let authReadySettled = false;
  let connectedDriveToken = null;
  let googleProviderEnabled = null;
  let workspaceLoadStatus = 'idle';
  let organization = null;
  let authorizationStatus = 'idle';

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

  async function getDriveMeta(id) {
    const key = userCacheKey(id);
    const cached = await cacheGet('meta', key);
    if (cached?.driveId) return cached;
    if (!currentUser || !supabase) return null;

    let query = supabase
      .from('documents_index')
      .select('google_drive_file_id,mime_type,name,parent_folder_id')
      .eq('doc_uid', id)
      .not('google_drive_file_id', 'is', null);
    query = organization?.id
      ? query.eq('organization_id', organization.id)
      : query.eq('user_id', currentUser.id);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new Error(`Không đọc được nguồn tệp Drive: ${error.message}`);
    if (!data?.google_drive_file_id) return null;
    const meta = {
      driveId: data.google_drive_file_id,
      mime: data.mime_type || 'application/octet-stream',
      name: data.name || id,
      parentFolderId: data.parent_folder_id || 'all'
    };
    await cacheSet('meta', key, meta);
    return meta;
  }

  async function postStreamWorker(message) {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
    const registration = await navigator.serviceWorker.register('/drive-stream-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller || registration.active;
    if (!worker) return false;
    return await new Promise(resolve => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(false), 3000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        resolve(event.data?.ok === true);
      };
      worker.postMessage(message, [channel.port2]);
    });
  }

  // Browser cache is namespaced by Supabase user to prevent cross-account data leaks.
  function userCacheKey(key) {
    return `${currentUser?.id || 'guest'}:${key}`;
  }

  // Đối tượng API thay thế cho window.DocHubAPI
  const api = {
    get connected() {
      return !!currentUser;
    },
    get isDriveConnected() {
      return !!providerToken && !!googleDriveFolderId;
    },
    get user() {
      return currentUser;
    },
    get revision() {
      return revision;
    },
    get conflict() {
      return conflict;
    },
    get authStatus() {
      return authStatus;
    },
    get authError() {
      return authError;
    },
    get googleProviderEnabled() {
      return googleProviderEnabled;
    },
    get workspaceLoadStatus() {
      return workspaceLoadStatus;
    },
    get organization() {
      return organization;
    },
    get authorizationStatus() {
      return authorizationStatus;
    }
  };

  async function ensureOrganization() {
    if (!supabase || !currentUser) return null;
    authorizationStatus = 'loading';
    const suggestedName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email;
    const { data, error } = await supabase.rpc('dochub_bootstrap_organization', {
      p_name: suggestedName ? `Không gian của ${suggestedName}` : null
    });
    if (error) {
      authorizationStatus = 'error';
      throw new Error(`Không khởi tạo được phân quyền máy chủ: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    organization = row ? { id: row.organization_id, role: row.organization_role } : null;
    authorizationStatus = organization ? 'ready' : 'error';
    return organization;
  }

  async function checkGoogleProvider() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${config.SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: config.SUPABASE_ANON_KEY },
        signal: controller.signal
      });
      if (!response.ok) return null;
      const settings = await response.json();
      googleProviderEnabled = settings?.external?.google === true;
      return googleProviderEnabled;
    } catch (_) {
      googleProviderEnabled = null;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  let folderMirrorQueue=Promise.resolve();
  function mirrorDriveFolders() {
    const task=folderMirrorQueue.catch(()=>{}).then(async()=>{
      if(organization?.role!=='owner')throw new Error('Kho Drive tổ chức phải được kết nối bởi chủ sở hữu.');
      if(!providerToken)throw new Error('Cần kết nối lại Google Drive.');
      const checked=result=>{if(result.error)throw result.error;return result.data||[];};
      const folders=checked(await supabase.from('organization_folders').select('folder_uid,parent_uid,name,deleted_at').eq('organization_id',organization.id));
      const maps=checked(await supabase.from('organization_drive_folders').select('folder_uid,drive_folder_id').eq('organization_id',organization.id));
      const ids=new Map(maps.map(row=>[row.folder_uid,row.drive_folder_id])),done=new Set(),visiting=new Set();
      async function ensure(uid){
        if(done.has(uid))return ids.get(uid);
        if(visiting.has(uid))throw new Error('Cây thư mục có vòng lặp.');
        const folder=folders.find(f=>f.folder_uid===uid&&!f.deleted_at);
        if(!folder)throw new Error('Không tìm thấy thư mục tổ chức: '+uid);
        visiting.add(uid);
        const parent=folder.parent_uid?await ensure(folder.parent_uid):null;
        const name=uid==='all'?`DocHub — ${currentUser.user_metadata?.full_name||currentUser.email}`:folder.name;
        let id=ids.get(uid);
        if(!id){
          const result=await window.DocHubDrive.getOrCreateMirroredFolder(providerToken,organization.id,uid,name,parent);
          id=result.id;
          checked(await supabase.from('organization_drive_folders').upsert({organization_id:organization.id,folder_uid:uid,drive_folder_id:id}));ids.set(uid,id);
        }
        await window.DocHubDrive.reconcileFolder(providerToken,id,name,parent);
        visiting.delete(uid);done.add(uid);return id;
      }
      for(const folder of folders.filter(f=>!f.deleted_at))await ensure(folder.folder_uid);
      googleDriveFolderId=ids.get('all');return ids;
    });
    folderMirrorQueue=task;return task;
  }

  function emitAuth(event = 'AUTH_STATE_CHANGED') {
    document.dispatchEvent(new CustomEvent('dochub:auth', {
      detail: {
        event,
        status: authStatus,
        error: authError,
        connected: !!currentUser,
        driveConnected: !!providerToken && !!googleDriveFolderId,
        user: currentUser
      }
    }));
  }

  function settleReady(value) {
    if (authReadySettled) return;
    authReadySettled = true;
    authReadyResolve(value);
  }

  async function applySession(session, event = 'INITIAL_SESSION') {
    authError = googleProviderEnabled === false ?
      'Google Provider chưa được bật trong Supabase Authentication.' : null;
    currentUser = session?.user || null;

    if (!currentUser) {
      organization = null;
      authorizationStatus = 'idle';
      providerToken = null;
      googleDriveFolderId = null;
      connectedDriveToken = null;
      sessionStorage.removeItem('dochub_google_token');
      authStatus = googleProviderEnabled === false ? 'configuration_required' : 'signed_out';
      emitAuth(event);
      return false;
    }

    providerToken = session.provider_token || sessionStorage.getItem('dochub_google_token') || null;
    if (session.provider_token) sessionStorage.setItem('dochub_google_token', session.provider_token);
    authStatus = providerToken ? 'connecting_drive' : 'authenticated';
    emitAuth(event);

    try {
      await ensureOrganization();
    } catch (authorizationError) {
      authStatus = 'authorization_error';
      authError = authorizationError.message;
      emitAuth('AUTHORIZATION_ERROR');
      return true;
    }

    if (providerToken && window.DocHubDrive && connectedDriveToken !== providerToken) {
      try {
        if(organization.role==='owner')await mirrorDriveFolders();
        else googleDriveFolderId=null;
        connectedDriveToken = providerToken;
        authStatus = 'ready';
        console.log('DocHub: Đã kết nối thư mục Google Drive ID:', googleDriveFolderId);
      } catch (driveErr) {
        googleDriveFolderId = null;
        connectedDriveToken = null;
        authStatus = 'drive_error';
        authError = driveErr?.message || 'Không thể kết nối Google Drive.';
        console.warn('DocHub: Lỗi kết nối Google Drive:', driveErr);
      }
    } else if (!providerToken) {
      authStatus = 'authenticated';
    }

    emitAuth(event);
    return true;
  }

  // Khởi tạo và kiểm tra phiên đăng nhập
  api.ready = new Promise(resolve => { authReadyResolve = resolve; });
  (async () => {
    if (!supabase) {
      console.warn('DocHub: Chưa nạp thư viện Supabase JS.');
      emitAuth('CLIENT_UNAVAILABLE');
      settleReady(false);
      return;
    }

    try {
      checkGoogleProvider().then(enabled => {
        if (!currentUser && enabled === false) {
          authStatus = 'configuration_required';
          authError = 'Google Provider chưa được bật trong Supabase Authentication.';
          emitAuth('CONFIGURATION_REQUIRED');
        }
      });
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const authenticated = await applySession(data?.session || null, 'INITIAL_SESSION');
      settleReady(authenticated);
    } catch (err) {
      authStatus = 'error';
      authError = err?.message || 'Không thể khôi phục phiên đăng nhập.';
      console.warn('DocHub Cloud Init Error:', err);
      emitAuth('INITIAL_SESSION_ERROR');
      settleReady(false);
    }
  })();

  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      // Defer async work so it does not block Supabase's internal auth callback.
      setTimeout(() => {
        applySession(session, event).catch(err => {
          authStatus = 'error';
          authError = err?.message || 'Không thể cập nhật phiên đăng nhập.';
          emitAuth('AUTH_STATE_ERROR');
        });
      }, 0);
    });
  }

  /**
   * Đọc trạng thái không gian làm việc của người dùng từ Supabase
   */
  api.loadState = async () => {
    await api.ready;
    if (!currentUser || !supabase) {
      workspaceLoadStatus = 'unavailable';
      return null;
    }

    workspaceLoadStatus = 'loading';
    try {
      const { data, error } = await supabase
        .from('user_workspaces')
        .select('state, revision')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (error) {
        workspaceLoadStatus = 'error';
        console.warn('Lỗi đọc dữ liệu từ Supabase:', error);
        return null;
      }

      if (data && data.state) {
        driveSharingEnabled = data.state.preferences?.driveSharingEnabled === true;
        workspaceLoadStatus = 'loaded';
        revision = data.revision || 1;
        console.log(`DocHub: Đã tải không gian làm việc từ Supabase (Revision ${revision})`);
        return data.state;
      }

      // Người dùng mới: Chưa có workspace trong DB -> sẽ trả về null để app khởi tạo seed ban đầu
      workspaceLoadStatus = 'not_found';
      return null;
    } catch (err) {
      workspaceLoadStatus = 'error';
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
        if (!organization) await ensureOrganization();
        if (organization && ['owner', 'admin'].includes(organization.role)) {
          const { error: authorizationError } = await supabase.rpc('dochub_sync_authorization_snapshot', {
            p_organization_id: organization.id,
            p_folders: snapshot.folders || [],
            p_users: snapshot.users || [],
            p_groups: snapshot.groups || [],
            p_acl: snapshot.acl || []
          });
          if (authorizationError) throw authorizationError;
        }
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
        if(organization?.role==='owner'&&providerToken)await mirrorDriveFolders();
        driveSharingEnabled = snapshot.preferences?.driveSharingEnabled === true;
        if (driveSharingEnabled && organization && ['owner','admin'].includes(organization.role)) await api.syncDrivePermissions();
        document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: true } }));
      } catch (err) {
        console.error('Lỗi lưu dữ liệu lên Supabase:', err);
        document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: false, error: err.message } }));
      }
    });

    return saveQueue;
  };

  /** Ask PostgreSQL for the effective permission of the authenticated user. */
  api.authorize = async (folderUid, action) => {
    await api.ready;
    if (!currentUser || !supabase) return false;
    if (!organization) await ensureOrganization();
    const { data, error } = await supabase.rpc('dochub_can_folder_action', {
      p_organization_id: organization.id,
      p_folder_uid: folderUid,
      p_action: action,
      p_user_id: currentUser.id
    });
    if (error) throw new Error(`Không kiểm tra được quyền trên máy chủ: ${error.message}`);
    return data === true;
  };

  api.requirePermission = async (folderUid, action) => {
    const allowed = await api.authorize(folderUid, action);
    if (!allowed) {
      const error = new Error('Bạn không có quyền thực hiện thao tác này trong thư mục đã chọn.');
      error.code = 'permission_denied';
      throw error;
    }
    return true;
  };

  /**
   * Lưu trữ tệp tài liệu: Đẩy lên Google Drive của khách hàng và lưu cache cục bộ
   */
  api.putAsset = async (id, blob, parentFolderId = 'all', options = {}) => {
    const { onProgress, signal } = options;
    await api.requirePermission(parentFolderId, 'create');
    if (signal?.aborted) {
      const error = new Error('Đã hủy tải tệp lên.');
      error.name = 'AbortError';
      throw error;
    }
    // 1. Luôn lưu cache cục bộ để xem trước tức thì
    onProgress?.({ phase: 'caching', loaded: 0, total: blob.size, percent: 0 });
    await cacheSet('assets', userCacheKey(id), blob);
    onProgress?.({ phase: 'connecting', loaded: 0, total: blob.size, percent: 0 });

    // 2. Nếu có kết nối Google Drive, tải lên Drive của khách
    let driveStored = false;
    if(organization?.role!=='owner'){
      onProgress?.({phase:'local',loaded:blob.size,total:blob.size,percent:100,error:'Chưa có kết nối ghi vào kho Drive chủ sở hữu. Tệp chỉ lưu trên thiết bị, không tải vào Drive cá nhân.'});
      return {driveStored:false,cached:true};
    }
    if (providerToken && googleDriveFolderId && window.DocHubDrive) {
      try {
        const folderIds=await mirrorDriveFolders();
        const destination=folderIds.get(parentFolderId);
        if(!destination)throw new Error('Chưa ánh xạ được thư mục Drive đích.');
        const fileMeta = await window.DocHubDrive.uploadFile(
          providerToken,
          destination,
          blob,
          id,
          blob.type || 'application/octet-stream',
          { onProgress, signal }
        );
        driveStored = true;
        // Lưu ánh xạ ID nội bộ -> Google Drive File ID
        await cacheSet('meta', userCacheKey(id), { driveId: fileMeta.id, webViewLink: fileMeta.webViewLink });

        // Ghi nhận vào bảng documents_index của Supabase nếu đang đăng nhập
        if (currentUser && supabase) {
          const { error: indexError } = await supabase.from('documents_index').upsert({
            user_id: currentUser.id,
            doc_uid: id,
            name: fileMeta.name || id,
            ext: (id.split('.').pop() || '').toLowerCase(),
            bytes: blob.size || 0,
            mime_type: blob.type,
            google_drive_file_id: fileMeta.id,
            organization_id: organization?.id || null,
            parent_folder_id: parentFolderId,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,doc_uid' });
          if(indexError)throw indexError;
          try { if(driveSharingEnabled)await api.syncDrivePermissions(fileMeta.id,parentFolderId); }
          catch(error){document.dispatchEvent(new CustomEvent('dochub:sync',{detail:{ok:false,error:'Tệp đã lên Drive nhưng chưa đồng bộ quyền: '+error.message}}));}
        }
      } catch (driveErr) {
        if (driveErr?.name === 'AbortError') {
          await cacheDelete('assets', userCacheKey(id));
          throw driveErr;
        }
        console.warn('Lỗi tải tệp lên Google Drive:', driveErr);
        onProgress?.({ phase: 'local', loaded: blob.size, total: blob.size, percent: 100, error: driveErr.message });
      }
    }
    if (!driveStored && (!providerToken || !googleDriveFolderId || !window.DocHubDrive)) {
      const reason = !providerToken ? 'Chưa kết nối Google Drive. Đăng nhập lại Google để cấp quyền Drive.' : authError || 'Không kết nối được thư mục Drive. Vui lòng kết nối lại Google Drive.';
      onProgress?.({ phase: 'local', loaded: blob.size, total: blob.size, percent: 100, error: reason });
    }
    return { driveStored, cached: true };
  };

  /**
   * Lấy tệp tài liệu: Đọc từ cache trước, nếu không có thì tải từ Google Drive
   */
  api.syncDrivePermissions = async (fileId=null,folderUid=null) => {
    if(!organization || !['owner','admin'].includes(organization.role))return;
    if(!providerToken)throw new Error('Đăng nhập lại Google để đồng bộ quyền Drive.');
    const checked=result=>{if(result.error)throw result.error;return result.data||[];};
    const files=fileId?[{google_drive_file_id:fileId,parent_folder_id:folderUid}]:checked(await supabase.from('documents_index').select('google_drive_file_id,parent_folder_id').eq('organization_id',organization.id).eq('user_id',currentUser.id).not('google_drive_file_id','is',null));
    for(const file of files){
      const driveId=file.google_drive_file_id;
      const desired=checked(await supabase.rpc('dochub_drive_recipients',{p_organization_id:organization.id,p_folder_uid:file.parent_folder_id}));
      const grants=checked(await supabase.from('drive_permission_links').select('*').eq('organization_id',organization.id).eq('drive_file_id',driveId));
      const live=await window.DocHubDrive.listPermissions(providerToken,driveId);
      const base=()=>supabase.from('drive_permission_links');
      for(const recipient of desired){
        if(recipient.email.toLowerCase()===currentUser.email?.toLowerCase())continue;
        const grant=grants.find(g=>g.email===recipient.email);
        const existing=live.find(p=>p.type==='user'&&p.emailAddress?.toLowerCase()===recipient.email);
        if(existing?.role==='owner')continue;
        if(existing&&!grant)throw new Error('Tệp có quyền Drive cấp ngoài DocHub cho '+recipient.email+'. Cần đối soát trước khi đồng bộ.');
        if(existing&&grant&&existing.id!==grant.permission_id)throw new Error('Quyền Drive đã thay đổi ngoài DocHub. Cần đối soát trước khi cập nhật.');
        const permission=await window.DocHubDrive.setUserPermission(providerToken,driveId,recipient.email,recipient.role,existing?.id||null);
        checked(await base().upsert({organization_id:organization.id,drive_file_id:driveId,email:recipient.email,permission_id:permission.id,role:recipient.role}));
      }
      for(const grant of grants){
        if(desired.some(r=>r.email===grant.email))continue;
        const existing=live.find(p=>p.id===grant.permission_id);
        if(existing && existing.role!=='owner')await window.DocHubDrive.removePermission(providerToken,driveId,grant.permission_id);
        checked(await base().delete().eq('organization_id',organization.id).eq('drive_file_id',driveId).eq('email',grant.email));
      }
    }
  };
  api.getAsset = async (id, parentFolderId = 'all') => {
    await api.requirePermission(parentFolderId, 'read');
    // 1. Kiểm tra cache IndexedDB
    const cached = await cacheGet('assets', userCacheKey(id));
    if (cached) return cached;

    // 2. Nếu không có trong cache, tải từ Google Drive
    if (providerToken && window.DocHubDrive) {
      const meta = await getDriveMeta(id);
      if (meta?.driveId) {
        try {
          const blob = await window.DocHubDrive.downloadFileBlob(providerToken, meta.driveId);
          if (blob) {
            await cacheSet('assets', userCacheKey(id), blob);
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
   * Tạo nguồn phát cùng miền cho video/audio Drive. Trình duyệt sẽ tự gửi các
   * yêu cầu Range; Service Worker chuyển tiếp chúng mà không tải toàn bộ tệp.
   */
  api.getAssetStream = async (id, parentFolderId = 'all', mime = 'application/octet-stream') => {
    await api.requirePermission(parentFolderId, 'read');
    if (!providerToken) return null;
    const meta = await getDriveMeta(id);
    if (!meta?.driveId) return null;
    const key = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registered = await postStreamWorker({
      type: 'DOCHUB_STREAM_REGISTER',
      key,
      fileId: meta.driveId,
      googleToken: providerToken,
      mime: mime || meta.mime
    });
    if (!registered) return null;
    return {
      key,
      url: `/__dochub_drive_stream__/${encodeURIComponent(key)}/${encodeURIComponent(meta.name || id)}`
    };
  };

  api.releaseAssetStream = async key => {
    if (!key) return;
    await postStreamWorker({ type: 'DOCHUB_STREAM_RELEASE', key }).catch(() => {});
  };

  /**
   * Xóa tệp tài liệu
   */
  api.removeAsset = async (id, parentFolderId = 'all') => {
    await api.requirePermission(parentFolderId, 'delete');
    await cacheDelete('assets', userCacheKey(id));
    if (providerToken && window.DocHubDrive) {
      const meta = await cacheGet('meta', userCacheKey(id));
      if (meta?.driveId) {
        await window.DocHubDrive.deleteFile(providerToken, meta.driveId);
        await cacheDelete('meta', userCacheKey(id));
      }
    }
    if (currentUser && supabase) {
      let deletion = supabase.from('documents_index').delete().eq('doc_uid', id);
      deletion = organization?.id ? deletion.eq('organization_id', organization.id) : deletion.eq('user_id', currentUser.id);
      const { error } = await deletion;
      if (error) throw error;
    }
  };

  /**
   * Đăng nhập Google và cấp quyền Google Drive
   */
  api.loginWithGoogle = async () => {
    if (!supabase) throw new Error('Supabase chưa sẵn sàng. Hãy kiểm tra kết nối mạng và cấu hình.');
    if (googleProviderEnabled === null) await checkGoogleProvider();
    if (googleProviderEnabled === false) {
      authStatus = 'configuration_required';
      authError = 'Hãy bật Google Provider và nhập OAuth Client ID/Secret trong Supabase Authentication trước.';
      emitAuth('CONFIGURATION_REQUIRED');
      throw new Error(authError);
    }
    authStatus = 'redirecting';
    authError = null;
    emitAuth('SIGN_IN_STARTED');
    const redirectUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: `${config.DRIVE_SCOPE} email profile`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent'
          },
          redirectTo: redirectUrl,
          skipBrowserRedirect: false
        }
      });
      if (error) throw error;
      return data;
    } catch (err) {
      authStatus = currentUser ? 'authenticated' : 'signed_out';
      authError = err?.message || 'Đăng nhập Google thất bại.';
      emitAuth('SIGN_IN_ERROR');
      throw err;
    }
  };

  /**
   * Đăng xuất tài khoản
   */
  api.logout = async () => {
    if (!supabase) return;
    authStatus = 'signing_out';
    authError = null;
    emitAuth('SIGN_OUT_STARTED');
    await api.flush();
    sessionStorage.removeItem('dochub_google_token');
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      authStatus = currentUser ? 'authenticated' : 'signed_out';
      authError = error.message || 'Đăng xuất thất bại.';
      emitAuth('SIGN_OUT_ERROR');
      throw error;
    }
    window.location.reload();
  };

  // Gán vào window
  window.DocHubAPI = api;
})();
