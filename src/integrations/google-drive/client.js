/**
 * Google Drive API v3 Client
 * Xử lý các thao tác lưu trữ, đọc, xóa tài liệu trực tiếp trên Drive cá nhân của khách hàng
 */
window.DocHubDrive = (() => {
  'use strict';

  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

  async function request(url, token, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      let msg = `Lỗi Google Drive API (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson.error?.message) msg = errJson.error.message;
      } catch (_) {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /**
   * Tìm hoặc tự động tạo thư mục gốc của ứng dụng trên Drive khách hàng
   */
  async function getOrCreateAppFolder(token, folderName = 'DocHub - Dữ liệu cá nhân') {
    const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`);
    const searchRes = await request(`${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,name)`, token);
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Nếu chưa có, tạo mới
    const createRes = await request(`${DRIVE_API}/files`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Thư mục lưu trữ tự động của DocHub'
      })
    });
    const folder = await createRes.json();
    return folder.id;
  }

  /**
   * Tải tệp lên Google Drive (Dùng Multipart Upload)
   */
  async function uploadFile(token, folderId, fileBlob, fileName, mimeType = 'application/octet-stream') {
    const metadata = {
      name: fileName,
      mimeType: mimeType || 'application/octet-stream',
      parents: folderId ? [folderId] : []
    };

    const boundary = '-------DocHubUploadBoundary' + Math.random().toString(36).slice(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: binary\r\n\r\n';

    const metadataBlob = new Blob([metadataPart], { type: 'text/plain' });
    const closeBlob = new Blob([closeDelimiter], { type: 'text/plain' });
    const multipartBody = new Blob([metadataBlob, fileBlob, closeBlob]);

    const res = await request(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink`, token, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    });

    return await res.json();
  }

  /**
   * Đọc/tải nội dung nhị phân (Blob) của tệp từ Google Drive
   */
  async function downloadFileBlob(token, fileId) {
    const res = await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, token);
    return await res.blob();
  }

  /**
   * Xóa tệp trên Google Drive
   */
  async function deleteFile(token, fileId) {
    try {
      await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, token, { method: 'DELETE' });
      return true;
    } catch (e) {
      console.warn('Xóa file Drive thất bại:', e);
      return false;
    }
  }

  return {
    getOrCreateAppFolder,
    uploadFile,
    downloadFileBlob,
    deleteFile
  };
})();
