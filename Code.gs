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
   case 'bootstrap':data={version:'5.0.0',settings:settings_(),conversations:listConversations_(owner)};break;
   case 'fetch':data=fetchAPI_(payload.url);break;
   case 'saveTurn':data=saveTurn_(owner,payload);break;
   case 'listConversations':data=listConversations_(owner);break;
   case 'getConversation':data=getConversation_(owner,payload.id);break;
  }
  return {ok:true,data:data};
 }catch(e){return Object.assign({ok:false,error:safeError_(e)},Number.isFinite(e.retryAt)?{retryAt:e.retryAt}:{});}
}
function hash_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function safeError_(e){const m=String(e.message||'処理できませんでした。');return m.length>180?'GASの処理に失敗しました。管理者にご確認ください。':m.replace(/https?:\/\/\S+/g,'[接続先]');}
function database_(){if(typeof DATABASE_ID==='undefined'||!DATABASE_ID)throw Error('データベースが未設定です。');return SpreadsheetApp.openById(DATABASE_ID);}
function sheet_(name){const s=database_().getSheetByName(name);if(!s)throw Error('データベースの初期設定が必要です。');const headers=s.getRange(1,1,1,SCHEMA[name].length).getValues()[0];if(headers.join('|')!==SCHEMA[name].join('|'))throw Error('データベースの列構成が一致しません。');return s;}
function rows_(name){const s=sheet_(name),last=s.getLastRow();if(last>20000)throw Error('データベースの行数上限に達しました。管理者による整理が必要です。');return last>1?s.getRange(2,1,last-1,SCHEMA[name].length).getValues():[];}
function textCell_(value){const s=String(value??'');return /^[\s\u0000-\u001f]*[=+@-]/.test(s)?"'"+s:s;}
function append_(sheet,values){const end=sheet.getLastRow()+values.length;if(end>20000)throw Error('保存上限に達しました。');if(end>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),end-sheet.getMaxRows());sheet.getRange(sheet.getLastRow()+1,1,values.length,values[0].length).setNumberFormat('@').setValues(values.map(row=>row.map(textCell_)));}
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
 const host=m[1].toLowerCase(),path=m[2],params=Object.create(null);String(m[3]||'').split('&').filter(Boolean).forEach(pair=>{const n=pair.indexOf('='),k=decodeURIComponent(n<0?pair:pair.slice(0,n)),v=decodeURIComponent((n<0?'':pair.slice(n+1)).replace(/\+/g,' '));if(Object.prototype.hasOwnProperty.call(params,k))throw Error('重複した検索条件です。');params[k]=v;});
 let provider,allowed,expected={};
 if(host==='api.met.no'&&['/weatherapi/locationforecast/2.0/compact','/weatherapi/sunrise/3.0/sun'].includes(path)){
  provider='weather';allowed=path.includes('/sunrise/')?['lat','lon','date','offset']:['lat','lon'];
  if(!/^-?\d{1,3}(\.\d{1,4})?$/.test(params.lat||'')||Math.abs(Number(params.lat))>90||!Number.isFinite(Number(params.lon))||Math.abs(Number(params.lon))>180||!/^-?\d{1,3}(\.\d{1,4})?$/.test(params.lon||''))throw Error('天気の座標が無効です。');
  if(path.includes('/sunrise/')&&(!/^20\d{2}-\d{2}-\d{2}$/.test(params.date||'')||!/^[-+]\d{2}:\d{2}$/.test(params.offset||'')))throw Error('天文の検索条件が無効です。');
 }else if(host==='api.frankfurter.dev'&&/^\/v2\/rate\/(usd|eur|jpy|gbp|cny|krw|aud|cad|chf)\/(usd|eur|jpy|gbp|cny|krw|aud|cad|chf)$/.test(path)){provider='currency';allowed=['date'];
  if(Object.prototype.hasOwnProperty.call(params,'date')){const value=params.date,date=new Date(value+'T00:00:00Z'),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||value<'1948-01-01'||value>today)throw Error('為替の日付が無効です。');}
 }else if(host==='ja.wikipedia.org'&&path==='/w/api.php'&&params.list==='geosearch'){
  provider='knowledge';allowed=['action','format','origin','list','gscoord','gsradius','gslimit','gsnamespace','gsprimary'];expected={action:'query',format:'json',origin:'*',list:'geosearch',gslimit:'20',gsnamespace:'0',gsprimary:'primary'};
  const coordinates=(params.gscoord||'').split('|');if(coordinates.length!==2||coordinates.some(n=>! /^-?\d{1,3}(\.\d{1,4})?$/.test(n))||Math.abs(Number(coordinates[0]))>90||Math.abs(Number(coordinates[1]))>180||! /^(?:[1-9]\d{2,3}|10000)$/.test(params.gsradius||''))throw Error('周辺記事の座標・半径が無効です。');
 }else if(host==='ja.wikipedia.org'&&path==='/w/api.php'){
  provider='knowledge';expected={action:'query',format:'json',origin:'*',generator:'search',gsrlimit:'3'};
  if(params.prop==='coordinates'){allowed=['action','format','origin','generator','gsrsearch','gsrlimit','prop','colimit'];expected.prop='coordinates';expected.colimit='1';}
  else {allowed=['action','format','origin','generator','gsrsearch','gsrlimit','prop','explaintext','exintro','exchars','inprop','redirects'];Object.assign(expected,{prop:'extracts|info',explaintext:'1',exintro:'1',inprop:'url',redirects:'1'});if(!['550','1800'].includes(params.exchars))throw Error('抜粋の長さが無効です。');}
  if(!params.gsrsearch||params.gsrsearch.length>100)throw Error('知識検索の条件が無効です。');
 }else if(host==='holidays-jp.github.io'&&path==='/api/v1/date.json'){provider='holiday';allowed=[];
 }else if(host==='api.crossref.org'&&path==='/works'){
  provider='crossref';expected.select='DOI,title,author,published,container-title,type';
  if(Object.prototype.hasOwnProperty.call(params,'query.bibliographic')){allowed=['query.bibliographic','rows','offset','select'];expected.rows='3';if(!params['query.bibliographic'].trim()||params['query.bibliographic'].length>100||/[\u0000-\u001f]/.test(params['query.bibliographic'])||! /^(0|3|6|9|12)$/.test(params.offset||''))throw Error('学術検索の条件が無効です。');}
  else{allowed=['filter','rows','select'];expected.rows='1';const doi=(params.filter||'').slice(4);if(!(params.filter||'').startsWith('doi:')||!/^10\.\d{4,9}\/[A-Za-z0-9._;()/:+\-]{1,180}$/.test(doi)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(doi))throw Error('DOIの検索条件が無効です。');}
 }else if(host==='openlibrary.org'&&path==='/search.json'){
  provider='books';allowed=['q','limit','page','fields'];expected={limit:'5',fields:'key,title,author_name,first_publish_year'};if(!params.q||params.q.length>80||!/^[1-5]$/.test(params.page||''))throw Error('書籍の検索条件が無効です。');
 }else if(host==='www.ebi.ac.uk'&&path==='/europepmc/webservices/rest/search'){
  provider='papers';allowed=['query','format','pageSize','resultType','cursorMark'];expected={format:'json',pageSize:'5',resultType:'lite'};if(!params.query||params.query.length>80||!/^[A-Za-z0-9+/=*]{1,256}$/.test(params.cursorMark||''))throw Error('文献の検索条件が無効です。');
 }else if(host==='www.gov.uk'&&path==='/bank-holidays.json'){provider='ukHoliday';allowed=[];
 }else if(host==='earthquake.usgs.gov'&&path==='/earthquakes/feed/v1.0/summary/significant_week.geojson'){provider='quakes';allowed=[];
 }else if(host==='api.worldbank.org'&&/^\/v2\/country\/[A-Z]{3}(\/indicator\/(SP\.POP\.TOTL|NY\.GDP\.MKTP\.CD|NY\.GDP\.PCAP\.CD|SP\.DYN\.LE00\.IN))?$/.test(path)){
  provider='country';
  if(!path.includes('/indicator/')){allowed=['format'];expected={format:'json'};}
  else if(path.endsWith('/SP.POP.TOTL')&&params.mrv==='1'&&!params.source){allowed=['format','mrv','per_page'];expected={format:'json',mrv:'1',per_page:'1'};}
  else {allowed=['format','source','mrnev','date','per_page'];expected={format:'json',source:'2',per_page:'1'};if(Object.prototype.hasOwnProperty.call(params,'date')){const maxYear=new Date(Date.now()+9*3600000).getUTCFullYear();if(params.mrnev!==undefined||!/^\d{4}$/.test(params.date)||Number(params.date)<1960||Number(params.date)>maxYear)throw Error('国統計の年が無効です。');}else expected.mrnev='1';}
 }else if(host==='hacker-news.firebaseio.com'&&/^\/v0\/(topstories|item\/[0-9]{1,12})\.json$/.test(path)){provider='news';allowed=[];
 }else if(host==='jp-postal-code-api.ttskch.com'&&/^\/api\/v1\/\d{7}\.json$/.test(path)){provider='postal';allowed=[];
 }else if(host==='api.openbd.jp'&&path==='/v1/get'){
  provider='isbn';allowed=['isbn'];if(!/^(978|979)\d{10}$/.test(params.isbn||'')||Array.from(params.isbn).reduce((sum,d,i)=>sum+Number(d)*(i%2?3:1),0)%10!==0)throw Error('ISBNの検索条件が無効です。');
 }else if(host==='freedictionaryapi.com'&&/^\/api\/v1\/entries\/en\/[a-z][a-z'%\-]{0,119}$/.test(path)){
  provider='dictionary';allowed=[];const word=decodeURIComponent(path.slice('/api/v1/entries/en/'.length));if(!/^[a-z][a-z'-]{0,39}$/.test(word)||encodeURIComponent(word)!==path.slice('/api/v1/entries/en/'.length))throw Error('辞書の検索条件が無効です。');
 }else throw Error('許可されていない接続先です。');
 if(Object.keys(params).some(k=>!allowed.includes(k))||Object.keys(expected).some(k=>params[k]!==expected[k]))throw Error('許可されていない検索条件です。');
 return provider;
}
function fetchAPI_(url){
 const provider=validateAPI_(url);const enabled=rows_('Providers').find(r=>r[0]===provider);if(!enabled||String(enabled[2]).toLowerCase()==='false')throw Error('このAPIは管理者が停止しています。');
 const cache=CacheService.getScriptCache(),key='api:'+hash_(url),hit=cache.get(key);if(hit)return Object.assign(JSON.parse(hit),{cache:true});
 const providerProps=PropertiesService.getScriptProperties(),cooldown=Number(providerProps.getProperty('COOLDOWN_'+provider)||0);if(cooldown>Date.now())throw Object.assign(Error(cooldownMessage_(cooldown)),{retryAt:cooldown});
 const crossrefLease=provider==='crossref'?reserveCrossref_():null;try{
 const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('混み合っています。');try{const props=PropertiesService.getScriptProperties(),today=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'),day=props.getProperty('FETCH_DAY'),count=day===today?Number(props.getProperty('FETCH_COUNT')||0):0;if(count>=1000)throw Error('本日のAPI取得上限です。');props.setProperties({FETCH_DAY:today,FETCH_COUNT:String(count+1)});}finally{lock.releaseLock();}
 if(provider==='books'){const serial=LockService.getScriptLock();if(!serial.tryLock(5000))throw Error('書籍検索が混み合っています。');try{const props=PropertiesService.getScriptProperties(),delay=1100-(Date.now()-Number(props.getProperty('LAST_BOOK_FETCH')||0));if(delay>0)Utilities.sleep(Math.min(delay,1100));props.setProperties({LAST_BOOK_FETCH:String(Date.now())});}finally{serial.releaseLock();}}
 const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:provider==='weather',headers:{'User-Agent':'ZERO-API-Assistant/3.0 github.com/hiroakiaa/zero-api-assistant'}}),status=response.getResponseCode(),responseHeaders=response.getHeaders?response.getHeaders():{};
 if([429,503].includes(status)){const key=Object.keys(responseHeaders).find(k=>k.toLowerCase()==='retry-after');let until=retryDeadline_(provider,key?responseHeaders[key]:null,Date.now(),status);const waitLock=LockService.getScriptLock();if(!waitLock.tryLock(5000))throw Error('混み合っています。');try{until=Math.max(Number(providerProps.getProperty('COOLDOWN_'+provider)||0),until);providerProps.setProperties({['COOLDOWN_'+provider]:String(until)});}finally{waitLock.releaseLock();}throw Object.assign(Error(cooldownMessage_(until)),{retryAt:until});}
 if(status<200||status>=300)throw Error('提供元がHTTP '+status+'を返しました。時間を置いてお試しください。');
 const text=response.getContentText();if(text.length>150000)throw Error('APIの応答が大きすぎます。');let data;try{data=JSON.parse(text);}catch{throw Error('APIの応答形式が正しくありません。');}if(data.error)throw Error('APIが検索条件を受け付けませんでした。');
 const expires=responseHeaders.Expires||responseHeaders.expires;
 const result={data:data,at:new Date().toISOString(),cache:false,expires:expires||null},serialized=JSON.stringify(result),ttl=['isbn','postal','ukHoliday'].includes(provider)?3600:Math.min(21600,Math.max(provider==='quakes'?300:provider==='weather'?1800:3600,Math.ceil((Date.parse(expires)-Date.now())/1000)||0));if(serialized.length<75000)cache.put(key,serialized,ttl);return result;
 }finally{if(crossrefLease)releaseCrossref_(crossrefLease);}
}
function reserveCrossref_(){const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('学術検索が混み合っています。');try{const props=PropertiesService.getScriptProperties();if(Number(props.getProperty('CROSSREF_BUSY_UNTIL')||0)>Date.now())throw Error('学術検索は別の照会中です。少し待って試してください。');const delay=1100-(Date.now()-Number(props.getProperty('CROSSREF_LAST_END')||0));if(delay>0)Utilities.sleep(Math.min(delay,1100));const lease=Utilities.getUuid();props.setProperties({CROSSREF_LEASE:lease,CROSSREF_BUSY_UNTIL:String(Date.now()+360000)});return lease;}finally{lock.releaseLock();}}
function releaseCrossref_(lease){const lock=LockService.getScriptLock();if(!lock.tryLock(5000))return;try{const props=PropertiesService.getScriptProperties();if(props.getProperty('CROSSREF_LEASE')===lease)props.setProperties({CROSSREF_LEASE:'',CROSSREF_BUSY_UNTIL:'0',CROSSREF_LAST_END:String(Date.now())});}finally{lock.releaseLock();}}
function retryDeadline_(provider,retryAfter,now,status){const value=String(retryAfter??'').trim();let deadline;if(/^\d+$/.test(value)&&Number.isFinite(Number(value)*1000))deadline=now+Number(value)*1000;else if(value)deadline=Date.parse(value);if(Number.isFinite(deadline)&&deadline>now&&deadline<=8640000000000000)return deadline;return provider==='dictionary'&&status===429?(Math.floor(now/3600000)+1)*3600000:now+60000;}
function cooldownMessage_(until){return '提供元への新しい照会を '+Utilities.formatDate(new Date(until),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss')+'（日本時間）まで停止しています。';}
