/** Optional self-hosted inference. Disabled until the owner sets all three properties. */
function cloudAIConfiguration_(){
 const props=PropertiesService.getScriptProperties();if(props.getProperty('ZERO_AI_ENABLED')!=='true')return null;
 const url=props.getProperty('ZERO_AI_URL')||'',secret=props.getProperty('ZERO_AI_SECRET')||'',host=url.match(/^https:\/\/([a-z0-9.-]+)\/zero\/chat$/i)?.[1];
 if(!host||host.length>253||!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(host)||/(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)$/i.test(host)||!(/^[A-Za-z0-9_-]{32,128}$/).test(secret))return null;
 return {url:url,secret:secret};
}
function cloudAIEnabled_(){return !!cloudAIConfiguration_();}
function generateCloudAI_(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['prompt','kind','history'].includes(k))||typeof payload.prompt!=='string'||!payload.prompt.trim()||payload.prompt.length>2000||!['general','文章','翻訳','要約','コード'].includes(payload.kind)||!Array.isArray(payload.history)||payload.history.length>4||payload.history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>800||Object.keys(m).some(k=>!['role','text'].includes(k)))||payload.history.reduce((n,m)=>n+m.text.length,0)>700)throw Error('クラウドAIの入力形式を確認できません。');
 const config=cloudAIConfiguration_();if(!config)throw Error('クラウドAIはまだ接続されていません。管理者によるサーバー設定が必要です。');
 const props=PropertiesService.getScriptProperties(),lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('クラウドAIが混み合っています。');const lease=Utilities.getUuid();
 try{const now=Date.now();if(Number(props.getProperty('ZERO_AI_BUSY_UNTIL')||0)>now)throw Error('クラウドAIは別の回答を生成中です。少し待って送信してください。');const day=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'),count=props.getProperty('ZERO_AI_DAY')===day?Number(props.getProperty('ZERO_AI_COUNT')||0):0;if(!Number.isSafeInteger(count)||count<0)throw Error('クラウドAIの生成回数設定を確認してください。');if(count>=100)throw Error('本日のクラウドAI生成上限です。明日もう一度お試しください。');props.setProperties({ZERO_AI_BUSY_UNTIL:String(now+85000),ZERO_AI_LEASE:lease,ZERO_AI_DAY:day,ZERO_AI_COUNT:String(count+1)});}finally{lock.releaseLock();}
 try{
  let response;try{response=UrlFetchApp.fetch(config.url,{method:'post',contentType:'application/json',payload:JSON.stringify(payload),headers:{Authorization:'Bearer '+config.secret},followRedirects:false,muteHttpExceptions:true});}catch{throw Error('クラウドAIサーバーへ接続できませんでした。モデルのダウンロードは開始しません。');}
  const status=response.getResponseCode();if(status===429)throw Error('クラウドAIサーバーは使用中です。少し待って送信してください。');
  const headers=response.getHeaders(),key=Object.keys(headers).find(k=>k.toLowerCase()==='x-zero-ai');if(!key||headers[key]!=='self-hosted-v1')throw Error('自前クラウドAIサーバーの応答を確認できませんでした。');
  if(status===502){const failure=response.getContentText();let errorCode;try{if(failure.length<=512)errorCode=JSON.parse(failure)?.error;}catch{}if(errorCode==='format_not_satisfied')throw Error('指定された文数に整えられませんでした。文章や条件を変えて、もう一度送信してください。');}
  if(status!==200)throw Error('クラウドAIサーバーが回答を生成できませんでした。管理者が稼働状況を確認する必要があります。');
  const raw=response.getContentText();if(raw.length>50000)throw Error('クラウドAIの応答が大きすぎます。');let data;try{data=JSON.parse(raw);}catch{throw Error('クラウドAIの応答を読み取れませんでした。');}if(!data||typeof data.text!=='string'||!data.text.trim()||data.text.length>8000||!['stop','length','unknown'].includes(data.finishReason))throw Error('クラウドAIの回答形式を確認できませんでした。');
  return {text:data.text,finishReason:data.finishReason};
 }finally{const endLock=LockService.getScriptLock();if(endLock.tryLock(5000)){try{if(props.getProperty('ZERO_AI_LEASE')===lease)props.setProperties({ZERO_AI_BUSY_UNTIL:'0',ZERO_AI_LEASE:''});}finally{endLock.releaseLock();}}}
}
