'use strict';
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const fail=(status,message)=>Object.assign(new Error(message),{status});
function seal(value,key,context){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(key).digest(),iv);
 cipher.setAAD(Buffer.from(context));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
function unseal(value,key,context){
 const data=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(key).digest(),data.subarray(0,12));
 cipher.setAAD(Buffer.from(context));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString();
}
async function body(req){
 if(req.body){if(typeof req.body==='object')return req.body;return JSON.parse(req.body);}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw fail(413,'Yêu cầu quá lớn.');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw fail(400,'Dữ liệu không hợp lệ.');}
}
function createApi(env=process.env,fetcher=fetch,logger=console){
 const base=env.SUPABASE_URL?.trim().replace(/\/$/,''),service=env.SUPABASE_SERVICE_ROLE_KEY?.trim(),key=env.DOCHUB_TOKEN_KEY||service;
 async function jsonFetch(url,options){
  const stage=url.includes('/auth/v1/')?'supabase-auth':url.includes('/rest/v1/')?'supabase-database':url.includes('oauth2.googleapis.com')?'google-token':'google-api';
  let r;
  try{r=await fetcher(url,{...options,signal:AbortSignal.timeout(30000)});}
  catch(cause){const timeout=['TimeoutError','AbortError'].includes(cause.name);throw Object.assign(fail(timeout?504:502,timeout?'Dịch vụ lưu trữ phản hồi quá chậm.':'Không kết nối được dịch vụ lưu trữ.'),{diagnostic:{stage,code:timeout?'UPSTREAM_TIMEOUT':'UPSTREAM_CONNECTION_FAILED'}});}
  if(!r.ok){let payload;try{payload=await r.json();}catch{}const known=new Set(['42P01','42501','PGRST205','PGRST301','PGRST302','invalid_grant','invalid_client']);const upstreamCode=payload?.code||payload?.error;
   throw Object.assign(fail(r.status===401?401:502,'Dịch vụ lưu trữ chưa sẵn sàng ('+r.status+').'),{diagnostic:{stage,code:known.has(upstreamCode)?upstreamCode:'UPSTREAM_HTTP_ERROR',upstreamStatus:r.status}});
  }
  if(r.status===204)return null;
  try{return await r.json();}catch{throw Object.assign(fail(502,'Dịch vụ lưu trữ trả về dữ liệu không hợp lệ.'),{diagnostic:{stage,code:'UPSTREAM_INVALID_JSON'}});}
 }
 const db=(path,options={},token=service)=>jsonFetch(`${base}/rest/v1/${path}`,{...options,headers:{apikey:service,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}});
 const rpc=(name,args,token)=>db('rpc/'+name,{method:'POST',body:JSON.stringify(args)},token);
 async function authenticate(req,url){
  if(!base||!service)throw fail(503,'Máy chủ chưa cấu hình kết nối tổ chức.');
  try{const target=new URL(base);if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error();}catch{throw Object.assign(fail(503,'SUPABASE_URL trên máy chủ không hợp lệ.'),{diagnostic:{stage:'configuration',code:'INVALID_SUPABASE_URL'}});}
  const bearer=/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];if(!bearer)throw fail(401,'Vui lòng đăng nhập.');
  const user=await jsonFetch(`${base}/auth/v1/user`,{headers:{apikey:service,Authorization:`Bearer ${bearer}`}});
  const org=url.searchParams.get('organization');if(!/^[0-9a-f-]{36}$/i.test(org||''))throw fail(400,'Thiếu tổ chức hợp lệ.');
  const members=await db(`organization_members?organization_id=eq.${org}&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=*`);
  if(members.length!==1)throw fail(403,'Bạn không thuộc không gian này.');
  const organizations=await db(`organizations?id=eq.${org}&select=*`);if(!organizations[0])throw fail(404,'Không tìm thấy tổ chức.');
  return {org,user,bearer,member:members[0],organization:organizations[0]};
 }
 async function allowed(c,folder,action){if(!await rpc('dochub_can_folder_action',{p_organization_id:c.org,p_folder_uid:folder,p_action:action,p_user_id:c.user.id},c.bearer))throw fail(403,'Bạn không có quyền thực hiện thao tác trong thư mục này.');}
 async function refresh(refreshToken){return jsonFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET})});}
 async function ownerToken(c){const rows=await db(`organization_drive_connections?organization_id=eq.${c.org}&select=*`);if(!rows[0]||rows[0].owner_id!==c.organization.owner_id)throw fail(409,'Chủ sở hữu cần kết nối kho Drive doanh nghiệp.');return (await refresh(unseal(rows[0].encrypted_refresh_token,key,c.org))).access_token;}
 async function document(c,id,action){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||''))throw fail(400,'Tệp không hợp lệ.');
  const rows=await db(`documents_index?organization_id=eq.${c.org}&doc_uid=eq.${id}&select=*`);
  if(rows.length!==1||rows[0].deleted_at)throw fail(404,'Không tìm thấy tài liệu.');
  await allowed(c,rows[0].parent_folder_id,action);return rows[0];
 }
 async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'http://localhost'),c=await authenticate(req,url),action=url.searchParams.get('action');let result;
   if(action==='status'&&req.method==='GET'){
    const rows=await db(`organization_drive_connections?organization_id=eq.${c.org}&select=owner_id`);result={connected:rows[0]?.owner_id===c.organization.owner_id};
   }else if(action==='connect'&&req.method==='POST'){
    if(c.user.id!==c.organization.owner_id)throw fail(403,'Chỉ chủ sở hữu được kết nối kho Drive.');
    const input=await body(req);if(typeof input.refreshToken!=='string'||input.refreshToken.length>8192)throw fail(400,'Cần đăng nhập Google lại để cấp kết nối dài hạn.');
    const token=await refresh(input.refreshToken);
    const identity=await jsonFetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`}});
    if(!identity.email_verified||identity.email?.toLowerCase()!==c.user.email?.toLowerCase())throw fail(403,'Tài khoản Drive phải là chủ sở hữu đã đăng nhập.');
    await db('organization_drive_connections?on_conflict=organization_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({organization_id:c.org,owner_id:c.user.id,encrypted_refresh_token:seal(input.refreshToken,key,c.org),updated_at:new Date().toISOString()})});result={connected:true};
   }else if(action==='workspace'&&req.method==='GET'){
    const rows=await db(`user_workspaces?user_id=eq.${c.organization.owner_id}&select=state,revision`);const state=rows[0]?.state;
    if(!state){result={state:null};}else{
     const visible=await db(`organization_folders?organization_id=eq.${c.org}&select=folder_uid`,{},c.bearer),ids=new Set(visible.map(f=>f.folder_uid));
     const output=structuredClone(state),folders=state.folders||[],ancestors=new Set(['all']);
     for(const f of folders.filter(f=>ids.has(f.id))){let cursor=f,seen=new Set();while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);ancestors.add(cursor.id);cursor=folders.find(p=>p.id===cursor.parentId);}}
     output.folders=folders.filter(f=>ancestors.has(f.id)).map(f=>ids.has(f.id)?f:{id:f.id,parentId:f.parentId,name:f.name,kind:'folder',inherit:false,deletedAt:null});
     const docs=await db(`documents_index?organization_id=eq.${c.org}&select=*`,{},c.bearer);
     // Account snapshots are legacy data shared by multiple organizations.
     // Only the organization-scoped, RLS-filtered index can establish file membership.
     // Never infer membership from a matching folder ID or filename.
     output.documents=[];
     for(const d of docs){output.documents.push({id:d.doc_uid,parentId:d.parent_folder_id,name:d.name,description:d.description||'',ext:d.ext,bytes:d.bytes,mime:d.mime_type,kind:'file',ownerId:'u1',source:'upload',assetStorage:'server',createdAt:d.created_at,updatedAt:d.updated_at,deletedAt:d.deleted_at||null});}
     if(!['owner','admin'].includes(c.member.organization_role)){output.logs=[];output.acl=[];output.groups=[];output.users=[{id:'u1',name:c.user.user_metadata?.full_name||c.user.email,email:c.user.email,groupIds:[],active:true}];}
     output.preferences={...output.preferences,driveSharingEnabled:false};result={state:output,revision:rows[0].revision};
    }
   }else if(action==='document-update'&&req.method==='POST'){
    const input=await body(req),doc=await document(c,input.id,input.trash||input.deletedAt?'delete':'edit');
    if(input.trash){
      const token=await ownerToken(c);await jsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({trashed:true})});
      await db(`documents_index?id=eq.${doc.id}`,{method:'PATCH',body:JSON.stringify({deleted_at:new Date().toISOString()})});result={ok:true};
    }else{
      if(typeof input.name!=='string'||!input.name.trim()||input.name.length>200||typeof input.description!=='string'||input.description.length>5000)throw fail(400,'Thông tin tài liệu không hợp lệ.');
      const token=await ownerToken(c);let query='';
      if(input.parentId!==doc.parent_folder_id){
        await allowed(c,doc.parent_folder_id,'move');await allowed(c,input.parentId,'create');
        const mapping=await db(`organization_drive_folders?organization_id=eq.${c.org}&folder_uid=eq.${encodeURIComponent(input.parentId)}&select=drive_folder_id`);if(!mapping[0])throw fail(409,'Thư mục đích chưa được đồng bộ vào Drive.');
        const original=await jsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}?fields=parents`,{headers:{Authorization:`Bearer ${token}`}});
        query='?'+new URLSearchParams({addParents:mapping[0].drive_folder_id,...(original.parents?.length?{removeParents:original.parents.join(',')}:{})});
      }
      await jsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}${query}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:input.name+(doc.ext?'.'+doc.ext:''),description:input.description})});
      await db(`documents_index?id=eq.${doc.id}`,{method:'PATCH',body:JSON.stringify({name:input.name,description:input.description,parent_folder_id:input.parentId,deleted_at:input.deletedAt?new Date().toISOString():null,updated_at:new Date().toISOString()})});result={ok:true};
    }
   }else if(action==='upload-start'&&req.method==='POST'){
    const input=await body(req);
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id||'')||typeof input.name!=='string'||!input.name.trim()||input.name.length>200||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>250*1024*1024)throw fail(400,'Thông tin tệp không hợp lệ (tối đa 250 MB).');
    await allowed(c,input.folder,'create');
    const existing=await db(`documents_index?organization_id=eq.${c.org}&doc_uid=eq.${input.id}&select=id`);if(existing.length)throw fail(409,'Tệp đã tồn tại.');
    const mappings=await db(`organization_drive_folders?organization_id=eq.${c.org}&folder_uid=eq.${encodeURIComponent(input.folder)}&select=drive_folder_id`);
    if(!mappings[0])throw fail(409,'Chủ sở hữu cần đồng bộ thư mục này vào kho Drive.');
    const token=await ownerToken(c),mime=typeof input.mime==='string'&&input.mime.length<150?input.mime:'application/octet-stream';
    const response=await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Upload-Content-Length':String(input.bytes),'X-Upload-Content-Type':mime},body:JSON.stringify({name:input.name,mimeType:mime,parents:[mappings[0].drive_folder_id]}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw fail(502,'Không tạo được phiên tải vào kho Drive.');
    const location=response.headers.get('location');if(!location||new URL(location).hostname!=='www.googleapis.com')throw fail(502,'Phiên tải Drive không hợp lệ.');
    const id=crypto.randomUUID();await db('organization_uploads',{method:'POST',body:JSON.stringify({id,organization_id:c.org,user_id:c.user.id,doc_uid:input.id,folder_uid:input.folder,name:input.name,ext:String(input.ext||'').slice(0,24),mime,bytes:input.bytes,encrypted_url:seal(location,key,id)})});result={id,chunkSize:2*1024*1024};
   }else if(action==='upload-chunk'&&req.method==='PUT'){
    const id=url.searchParams.get('upload');if(!/^[0-9a-f-]{36}$/i.test(id||''))throw fail(400,'Phiên tải không hợp lệ.');
    const sessions=await db(`organization_uploads?id=eq.${id}&organization_id=eq.${c.org}&user_id=eq.${c.user.id}&select=*`),s=sessions[0];
    if(!s||Date.parse(s.expires_at)<Date.now())throw fail(410,'Phiên tải đã hết hạn.');
    await allowed(c,s.folder_uid,'create');
    const parts=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range']||'');
    if(!parts||Number(parts[3])!==Number(s.bytes)||Number(parts[2])>=Number(s.bytes)||Number(parts[2])<Number(parts[1])||Number(parts[1])%262144!==0)throw fail(400,'Khoảng tải không hợp lệ.');
    let payload;if(Buffer.isBuffer(req.body))payload=req.body;else{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw fail(413,'Khối tải vượt 2 MB.');chunks.push(chunk);}payload=Buffer.concat(chunks);}
    if(payload.length>2*1024*1024||payload.length!==Number(parts[2])-Number(parts[1])+1)throw fail(400,'Kích thước khối tải không hợp lệ.');
    const token=await ownerToken(c),uploadUrl=unseal(s.encrypted_url,key,id);
    const response=await fetcher(uploadUrl,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':s.mime,'Content-Range':req.headers['content-range']},body:payload,signal:AbortSignal.timeout(60000)});
    if(response.status===308){result={complete:false};}
    else if(response.ok){const metadata=await response.json();if(!metadata.id)throw fail(502,'Drive chưa xác nhận tệp.');
     await db('documents_index?on_conflict=user_id,doc_uid',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({organization_id:c.org,user_id:c.user.id,doc_uid:s.doc_uid,parent_folder_id:s.folder_uid,name:s.name.replace(new RegExp('\\.'+s.ext.replace(/[^a-z0-9]/gi,'')+'$','i'),''),ext:s.ext,bytes:s.bytes,mime_type:s.mime,google_drive_file_id:metadata.id})});
     await db(`organization_uploads?id=eq.${id}`,{method:'DELETE'});result={complete:true};
    }else throw fail(502,'Drive chưa nhận khối tải. Vui lòng thử tải lại.');
   }else if(action==='asset'&&['GET','HEAD'].includes(req.method)){
    const doc=await document(c,url.searchParams.get('id'),'read'),token=await ownerToken(c);
    const range=req.headers.range;if(range&&!/^bytes=\d*-\d*$/.test(range))throw fail(416,'Khoảng dữ liệu không hợp lệ.');
    const response=await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}?alt=media`,{headers:{Authorization:`Bearer ${token}`,...(range?{Range:range}:{})},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw fail(response.status===404?404:502,'Không đọc được tệp từ kho doanh nghiệp.');
    res.statusCode=response.status;for(const h of ['content-type','content-length','content-range','accept-ranges'])if(response.headers.get(h))res.setHeader(h,response.headers.get(h));
    res.setHeader('Content-Disposition','attachment');if(req.method==='HEAD'){response.body?.cancel();res.end();return;}await pipeline(Readable.fromWeb(response.body),res);return;
   }else{throw fail(404,'Chức năng chưa được cung cấp.');}
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
  }catch(error){const requestId=crypto.randomUUID();const status=error.status||500;
   if(status>=500||error.diagnostic)logger.error('DocHub organization API',JSON.stringify({requestId,status,...(error.diagnostic||{stage:'handler',code:'INTERNAL_ERROR'})}));
   if(res.headersSent){res.destroy();return;}res.statusCode=status;res.setHeader('X-DocHub-Request-Id',requestId);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.status?error.message:'Không xử lý được yêu cầu. Vui lòng thử lại.',requestId}));}
 }
 return handler;
}
module.exports={createApi,seal,unseal};
