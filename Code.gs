/** ZERO: GitHub source + Apps Script + private Spreadsheet database. */
const SCHEMA = {
 Settings:['key','value','description'],
 Providers:['id','name','enabled','license','source_url'],
 Conversations:['id','owner_hash','title','created_at','updated_at','context_json'],
 Messages:['id','owner_hash','conversation_id','role','text','created_at','sources_json']
};
function doGet(){return HtmlService.createHtmlOutputFromFile('App').setTitle('ZERO').addMetaTag('viewport','width=device-width,initial-scale=1,viewport-fit=cover').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);}
function api(request){
 try{
  if(!request||!['bootstrap','fetch','saveTurn','listConversations','getConversation'].includes(request.action))throw Error('対応していない操作です。');
  if(!/^[a-f0-9]{64}$/.test(request.token||''))throw Error('ブラウザの識別情報が無効です。');
  const owner=hash_(request.token),payload=request.payload||{};rateLimit_(owner);
  let data;
  switch(request.action){
   case 'bootstrap':data={version:'2.0.0',settings:settings_(),conversations:listConversations_(owner)};break;
   case 'fetch':data=fetchAPI_(payload.url);break;
   case 'saveTurn':data=saveTurn_(owner,payload);break;
   case 'listConversations':data=listConversations_(owner);break;
   case 'getConversation':data=getConversation_(owner,payload.id);break;
  }
  return {ok:true,data:data};
 }catch(e){return {ok:false,error:safeError_(e)};}
}
function hash_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function safeError_(e){const m=String(e.message||'処理できませんでした。');return m.length>180?'GASの処理に失敗しました。管理者にご確認ください。':m.replace(/https?:\/\/\S+/g,'[接続先]');}
function database_(){if(typeof DATABASE_ID==='undefined'||!DATABASE_ID)throw Error('データベースが未設定です。');return SpreadsheetApp.openById(DATABASE_ID);}
function sheet_(name){const s=database_().getSheetByName(name);if(!s)throw Error('データベースの初期設定が必要です。');const headers=s.getRange(1,1,1,SCHEMA[name].length).getValues()[0];if(headers.join('|')!==SCHEMA[name].join('|'))throw Error('データベースの列構成が一致しません。');return s;}
function rows_(name){const s=sheet_(name),last=s.getLastRow();if(last>20000)throw Error('データベースの行数上限に達しました。管理者による整理が必要です。');return last>1?s.getRange(2,1,last-1,SCHEMA[name].length).getValues():[];}
function textCell_(value){const s=String(value??'');return /^[\s\u0000-\u001f]*[=+@-]/.test(s)?"'"+s:s;}
function append_(sheet,values){if(sheet.getLastRow()+values.length>20000)throw Error('保存上限に達しました。');sheet.getRange(sheet.getLastRow()+1,1,values.length,values[0].length).setNumberFormat('@').setValues(values.map(row=>row.map(textCell_)));}
function settings_(){const values={};rows_('Settings').forEach(r=>{if(['app_name','greeting','history_enabled'].includes(String(r[0])))values[r[0]]=String(r[1]);});return values;}
function rateLimit_(owner){const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('混み合っています。少し待ってお試しください。');try{const cache=CacheService.getScriptCache(),key='rate:'+owner+':'+Math.floor(Date.now()/3600000),count=Number(cache.get(key)||0);if(count>=120)throw Error('1時間の利用上限です。時間を置いてお試しください。');cache.put(key,String(count+1),3600);}finally{lock.releaseLock();}}
function listConversations_(owner){return rows_('Conversations').filter(r=>r[1]===owner).sort((a,b)=>String(b[4]).localeCompare(String(a[4]))).slice(0,30).map(r=>({id:r[0],title:r[2],createdAt:r[3],updatedAt:r[4]}));}
function getConversation_(owner,id){if(!/^[a-zA-Z0-9-]{20,60}$/.test(id||''))throw Error('会話IDが無効です。');const conversation=rows_('Conversations').find(r=>r[0]===id&&r[1]===owner);if(!conversation)throw Error('この会話は見つかりません。');const messages=rows_('Messages').filter(r=>r[1]===owner&&r[2]===id).slice(-100).map(r=>({role:r[3],text:r[4],sources:JSON.parse(r[6]||'[]')}));return {id:id,title:conversation[2],context:JSON.parse(conversation[5]||'{}'),messages:messages};}
function saveTurn_(owner,payload){
 if(settings_().history_enabled==='false')return {saved:false,reason:'管理者が履歴保存を停止しています。'};
 const id=payload.conversationId,requestId=payload.requestId;
 if(!/^[a-zA-Z0-9-]{20,60}$/.test(id||'')||!/^[a-zA-Z0-9-]{20,60}$/.test(requestId||''))throw Error('保存IDが無効です。');
 const question=String(payload.userText||''),answer=String(payload.assistantText||'');
 if(!question||question.length>500||!answer||answer.length>16000)throw Error('保存できる文章量を超えています。');
 const context=JSON.stringify(payload.context||{});if(context.length>8000)throw Error('会話条件が長すぎます。');
 const sources=JSON.stringify((payload.sources||[]).slice(0,12).filter(s=>s&&typeof s.title==='string'&&/^https:\/\//.test(s.url||'')).map(s=>({title:s.title.slice(0,150),url:s.url.slice(0,1200)})));
 const lock=LockService.getScriptLock();if(!lock.tryLock(8000))throw Error('保存が混み合っています。もう一度試してください。');
 try{
  const conversations=rows_('Conversations'),row=conversations.findIndex(r=>r[0]===id);
  if(row>=0&&conversations[row][1]!==owner)throw Error('この会話に保存できません。');
  const messages=rows_('Messages');if(messages.some(r=>r[0]===requestId+'-a'&&r[1]===owner))return {saved:true,duplicate:true};
  if(messages.filter(r=>r[2]===id).length>=100)throw Error('この会話の保存上限です。新しい会話を始めてください。');
  const now=new Date().toISOString(),sheet=sheet_('Conversations');
  if(row<0){if(conversations.filter(r=>r[1]===owner).length>=50)throw Error('会話数の保存上限です。');append_(sheet,[[id,owner,question.slice(0,40),now,now,context]]);}
  append_(sheet_('Messages'),[[requestId+'-u',owner,id,'user',question,now,'[]'],[requestId+'-a',owner,id,'assistant',answer,now,sources]]);
  if(row>=0)sheet.getRange(row+2,5,1,2).setNumberFormat('@').setValues([[now,textCell_(context)]]);
  return {saved:true,conversationId:id};
 }finally{lock.releaseLock();}
}
function validateAPI_(url){
 if(typeof url!=='string'||url.length>4000)throw Error('接続先が無効です。');
 const m=url.match(/^https:\/\/([a-z0-9.-]+)(\/[^?#]*)(?:\?([^#]*))?$/i);if(!m)throw Error('許可されていない接続先です。');
 const host=m[1].toLowerCase(),path=m[2],params={};String(m[3]||'').split('&').filter(Boolean).forEach(pair=>{const n=pair.indexOf('='),k=decodeURIComponent(n<0?pair:pair.slice(0,n)),v=decodeURIComponent((n<0?'':pair.slice(n+1)).replace(/\+/g,' '));if(Object.prototype.hasOwnProperty.call(params,k))throw Error('重複した検索条件です。');params[k]=v;});
 let provider,allowed,expected={};
 if(host==='api.open-meteo.com'&&path==='/v1/forecast'){
  provider='weather';allowed=['latitude','longitude','daily','timezone','forecast_days'];expected={daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:'7'};
  if(!Number.isFinite(Number(params.latitude))||Math.abs(Number(params.latitude))>90||!Number.isFinite(Number(params.longitude))||Math.abs(Number(params.longitude))>180||!/^[A-Za-z_+\-/]+$/.test(params.timezone||''))throw Error('天気の検索条件が無効です。');
 }else if(host==='geocoding-api.open-meteo.com'&&path==='/v1/search'){
  provider='weather';allowed=['name','count','language','format'];expected={count:'3',language:'ja',format:'json'};if(!params.name||params.name.length>60)throw Error('地名が無効です。');
 }else if(host==='api.frankfurter.dev'&&/^\/v2\/rate\/(usd|eur|jpy|gbp|cny|krw|aud|cad|chf)\/(usd|eur|jpy|gbp|cny|krw|aud|cad|chf)$/.test(path)){provider='currency';allowed=[];
 }else if(host==='ja.wikipedia.org'&&path==='/w/api.php'){
  provider='knowledge';allowed=['action','format','origin','generator','gsrsearch','gsrlimit','prop','explaintext','exintro','exchars','inprop','redirects'];expected={action:'query',format:'json',origin:'*',generator:'search',gsrlimit:'3',prop:'extracts|info',explaintext:'1',exintro:'1',inprop:'url',redirects:'1'};if(!params.gsrsearch||params.gsrsearch.length>100||!['550','1800'].includes(params.exchars))throw Error('知識検索の条件が無効です。');
 }else if(host==='holidays-jp.github.io'&&path==='/api/v1/date.json'){provider='holiday';allowed=[];
 }else throw Error('許可されていない接続先です。');
 if(Object.keys(params).some(k=>!allowed.includes(k))||Object.keys(expected).some(k=>params[k]!==expected[k]))throw Error('許可されていない検索条件です。');
 return provider;
}
function fetchAPI_(url){
 const provider=validateAPI_(url);const enabled=rows_('Providers').find(r=>r[0]===provider);if(!enabled||String(enabled[2]).toLowerCase()==='false')throw Error('このAPIは管理者が停止しています。');
 const cache=CacheService.getScriptCache(),key='api:'+hash_(url),hit=cache.get(key);if(hit)return Object.assign(JSON.parse(hit),{cache:true});
 const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('混み合っています。');try{const props=PropertiesService.getScriptProperties(),today=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'),day=props.getProperty('FETCH_DAY'),count=day===today?Number(props.getProperty('FETCH_COUNT')||0):0;if(count>=1000)throw Error('本日のAPI取得上限です。');props.setProperties({FETCH_DAY:today,FETCH_COUNT:String(count+1)});}finally{lock.releaseLock();}
 const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:false,headers:{'User-Agent':'ZERO-API-Assistant/2.0 (small noncommercial prototype)'}}),status=response.getResponseCode();if(status<200||status>=300)throw Error('提供元がHTTP '+status+'を返しました。時間を置いてお試しください。');
 const text=response.getContentText();if(text.length>150000)throw Error('APIの応答が大きすぎます。');let data;try{data=JSON.parse(text);}catch{throw Error('APIの応答形式が正しくありません。');}if(data.error)throw Error('APIが検索条件を受け付けませんでした。');
 const result={data:data,at:new Date().toISOString(),cache:false},serialized=JSON.stringify(result);if(serialized.length<75000)cache.put(key,serialized,provider==='weather'?900:3600);return result;
}
