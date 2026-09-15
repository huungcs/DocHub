const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createApi,seal,unseal,documentExtension}=require('../../src/server/organization-api');
test('Invalid legacy extensions never become document IDs in the workspace',()=>{
 assert.equal(documentExtension('doc-c4493418-dda8-4dee-9bbe-b714bc6a0e22','image/jpeg'),'jpg');
 assert.equal(documentExtension(' JPG ','image/jpeg'),'jpg');
 assert.equal(documentExtension(null,'unknown','report.xlsx'),'xlsx');
 assert.equal(documentExtension('invalid-id','unknown','filename'),'');
 assert.equal(documentExtension('x'.repeat(25),'application/pdf'),'pdf');
});
const org='11111111-1111-1111-1111-111111111111';
test('Workspace excludes stale account files and returns only organization-indexed files',async()=>{
 const snapshot={folders:[{id:'all',parentId:null}],documents:[{id:'stale-id',parentId:'all',name:'same-name',assetStorage:'server'}],preferences:{}};
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async url=>{
  let data;
  if(url.includes('/auth/'))data={id:'owner'};
  else if(url.includes('organization_members'))data=[{organization_role:'owner'}];
  else if(url.includes('/organizations?'))data=[{owner_id:'owner'}];
  else if(url.includes('user_workspaces'))data=[{state:snapshot,revision:1}];
  else if(url.includes('organization_folders'))data=[{folder_uid:'all'}];
  else if(url.includes('documents_index')){assert.ok(url.includes('organization_id=eq.'+org));data=[{doc_uid:'indexed-id',parent_folder_id:'all',name:'same-name',ext:'doc-invalid-legacy-extension-longer-than-24',mime_type:'image/jpeg'}];}
  else assert.fail('Unexpected request');
  return {ok:true,status:200,json:async()=>data};
 });
 const res=response();await api(request('/api/organization?action=workspace&organization='+org,{authorization:'Bearer jwt'}),res);
 assert.deepEqual(res.data.state.documents.map(d=>d.id),['indexed-id']);
 assert.equal(res.data.state.documents[0].ext,'jpg');
 assert.equal(snapshot.documents[0].id,'stale-id','Original snapshot is preserved');
});
test('Network diagnostics correlate responses without leaking credentials',async()=>{
 const logs=[];const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'private-key'},async()=>{throw new Error('private-key Bearer secret-token');},{error:(...args)=>logs.push(args)});
 const res=response();await api(request('/api/organization?action=status&organization='+org,{authorization:'Bearer secret-token'}),res);
 assert.equal(res.statusCode,502);assert.equal(res.data.requestId,res.headers['X-DocHub-Request-Id']);
 assert.match(JSON.stringify(logs),/UPSTREAM_CONNECTION_FAILED/);
 assert.ok(!JSON.stringify([logs,res]).includes('private-key'));assert.ok(!JSON.stringify([logs,res]).includes('secret-token'));
});
test('Invalid server URL is rejected without attempting network access',async()=>{
 const api=createApi({SUPABASE_URL:'SUPABASE_URL=https://test',SUPABASE_SERVICE_ROLE_KEY:'key'},async()=>{assert.fail('Must not fetch');},{error:()=>{}});
 const res=response();await api(request('/api/organization?action=status&organization='+org,{authorization:'Bearer jwt'}),res);assert.equal(res.statusCode,503);
});
function request(url,headers={},method='GET',payload){const req=Readable.from([]);Object.assign(req,{url,headers,method,body:payload});return req;}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.data=JSON.parse(value);}};}
test('Owner credentials are authenticated encrypted and bound to one organization',()=>{
 const cipher=seal('secret-refresh-token','key',org);
 assert.equal(unseal(cipher,'key',org),'secret-refresh-token');
 assert.throws(()=>unseal(cipher,'key','another-org'));
 assert.throws(()=>unseal(cipher,'wrong-key',org));
 assert.ok(!cipher.includes('secret-refresh-token'));
});
test('API requires authentication before querying Drive',async()=>{
 let called=false;const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async()=>{called=true;throw Error();});
 const res=response();await api(request('/api/organization?action=asset&organization='+org),res);
 assert.equal(res.statusCode,401);assert.equal(called,false);
});
test('A nonmember cannot use the owner connection',async()=>{
 const urls=[];const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url)=>{urls.push(url);return {ok:true,status:200,json:async()=>url.includes('/auth/')?{id:'employee'}:[]};});
 const res=response();await api(request('/api/organization?action=status&organization='+org,{authorization:'Bearer jwt'}),res);
 assert.equal(res.statusCode,403);assert.equal(urls.length,2);
});
test('Denied folder reads never obtain the owner token or fetch bytes',async()=>{
 const urls=[];const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url)=>{
 urls.push(url);let data;
 if(url.includes('/auth/'))data={id:'employee'};
 else if(url.includes('organization_members'))data=[{organization_role:'member'}];
 else if(url.includes('/organizations?'))data=[{owner_id:'owner'}];
 else if(url.includes('documents_index'))data=[{parent_folder_id:'private',google_drive_file_id:'drive-id'}];
 else if(url.includes('rpc/'))data=false;
 else throw Error('Unexpected credential/Drive access');
 return {ok:true,status:200,json:async()=>data};});
 const res=response();await api(request('/api/organization?action=asset&organization='+org+'&id=doc-1',{authorization:'Bearer jwt'}),res);
 assert.equal(res.statusCode,403);assert.ok(!urls.some(u=>u.includes('connections')||u.includes('googleapis')));
});
