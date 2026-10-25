import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const models=new Set(['qwen2.5:7b-instruct']);
const guidance={文章:'指定された完成原稿を直接書いてください。',翻訳:'指定言語の翻訳文だけを出力し、内容を付け加えないでください。',要約:'与えられた文章だけを要約してください。',コード:'コードの説明や下書きを示し、実行したとは言わないでください。',general:'依頼に直接答えてください。'};
// Only unambiguous exact Japanese prose requests are checked. Never infer a
// constraint from conversation history, quoted source text, ranges or code.
export function sentenceConstraint(input){
 if(!['general','文章','要約'].includes(input.kind))return null;
 const prompt=input.prompt.normalize('NFKC');
 if(/[「」『』"`]|(?:英語|英文|翻訳|コード|文目|文ずつ|以内|以上|以下|程度|くらい|ほど|ないで|ではなく)|[〜～~]|[0-9]\s*[-–—]\s*[0-9]/u.test(prompt)||(prompt.match(/[0-9一二三四五六七八九十]+\s*文/gu)||[]).length!==1)return null;
 const matches=[...prompt.matchAll(/([1-8一二三四五六七八])\s*文(?:だけ|のみ)?(?:で|に|を|だけ|のみ)/gu)];
 if(matches.length!==1||/[0-9一二三四五六七八九十]\s*$/.test(prompt.slice(0,matches[0].index)))return null;
 const value=matches[0][1];return Number(value)||'一二三四五六七八'.indexOf(value)+1;
}
export function japaneseSentenceCount(text){return [...new Intl.Segmenter('ja',{granularity:'sentence'}).segment(text)].filter(part=>/[\p{L}\p{N}]/u.test(part.segment)).length;}
export function cloudMessages(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['prompt','kind','history'].includes(k))||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>2000||!Object.hasOwn(guidance,input.kind)||!Array.isArray(input.history)||input.history.length>4)throw Error('invalid_input');
 if(input.history.reduce((n,m)=>n+(typeof m?.text==='string'?m.text.length:0),0)>700||input.history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>800||Object.keys(m).some(k=>!['role','text'].includes(k))))throw Error('invalid_history');
 const history=input.history.map(m=>({role:m.role,content:m.text}));while(history.length&&history[0].role!=='user')history.shift();
 const business=['文章','general'].includes(input.kind)&&/メール|案内文|お知らせ|招待状|依頼文|通知文|ビジネス|手紙/.test(input.prompt)?'実務用の下書きでは指定されていない人名・日時・金額・事情を作らず、必要な未指定項目は空欄か差し替え用の表記にしてください。':'';
 return [{role:'system',content:'あなたは日本語のアシスタントです。'+guidance[input.kind]+business+'最新の依頼の言語・文数・形式を優先し、挨拶や説明を重複させないでください。文数の指定がある場合は句点（。）で終わる文の数を確認し、指定数に合わせてから完成文だけを出力してください。現在の天気・為替など未照会の事実を推測せず、データ照会を案内してください。外部APIやコードを実行したと偽らないでください。モデル名・ライセンス・出典の定型文は付けません。'},...history,{role:'user',content:input.prompt}];
}
function cloudRequestBody(req,timeoutMS){
 return new Promise((resolve,reject)=>{let size=0,settled=false;const chunks=[];
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);req.off('data',onData);req.off('end',onEnd);req.off('aborted',onAborted);req.off('error',onError);if(error){req.pause();reject(error);}else resolve(Buffer.concat(chunks));};
  const fail=(status,code)=>finish(Object.assign(Error(code),{status,code}));
  const onData=chunk=>{size+=chunk.length;if(size>16000)fail(413,'input_too_large');else chunks.push(chunk);},onEnd=()=>finish(),onAborted=()=>fail(400,'input_aborted'),onError=()=>fail(400,'input_aborted');
  const timer=setTimeout(()=>fail(408,'input_timeout'),timeoutMS);req.on('data',onData);req.once('end',onEnd);req.once('aborted',onAborted);req.once('error',onError);
 });
}
export function createCloudServer({token,model='qwen2.5:7b-instruct',fetchImpl=fetch,timeoutMS=70000,inputTimeoutMS=10000}={}){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw Error('ZERO_AI_SECRET must be 32–128 URL-safe characters');
 if(!models.has(model))throw Error('Use an approved local Qwen2.5-Instruct model; hosted/cloud tags are not allowed');
 if(!Number.isInteger(timeoutMS)||timeoutMS<1||timeoutMS>70000||!Number.isInteger(inputTimeoutMS)||inputTimeoutMS<1||inputTimeoutMS>10000)throw Error('Invalid timeout');let busy=false;
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data,close=false)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Zero-AI':'self-hosted-v1','X-Content-Type-Options':'nosniff',...(close?{Connection:'close'}:{})});res.end(JSON.stringify(data),close?()=>req.destroy():undefined);};
  // No CORS: only the server-to-server GAS connection is supported.
  const expected=Buffer.from('Bearer '+token),supplied=Buffer.from(String(req.headers.authorization||''));
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){req.resume();reply(401,{error:'unauthorized'});return;}
  if(req.method==='GET'&&req.url==='/zero/health'){reply(200,{service:'zero-self-hosted',model,readyToAccept:!busy});return;}
  if(req.method!=='POST'||req.url!=='/zero/chat'){req.resume();reply(404,{error:'not_found'});return;}
  if(busy){req.resume();reply(429,{error:'busy'});return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){req.resume();reply(415,{error:'json_required'});return;}
  if(Number(req.headers['content-length']||0)>16000){req.resume();reply(413,{error:'input_too_large'});return;}
  busy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMS);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   const raw=await cloudRequestBody(req,Math.min(inputTimeoutMS,timeoutMS));let input,messages;try{input=JSON.parse(raw.toString('utf8'));messages=cloudMessages(input);}catch{reply(400,{error:'invalid_input'});return;}
   const wanted=sentenceConstraint(input);
   for(let attempt=0;attempt<2;attempt++){
    const response=await fetchImpl('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:controller.signal,body:JSON.stringify({model,messages,stream:false,keep_alive:'5m',options:{num_ctx:4096,num_predict:256,temperature:0.3}})});
    if(!response.ok){reply(502,{error:'local_model_unavailable'});return;}const result=await response.json(),text=result?.message?.content;
    if(result?.done!==true||typeof text!=='string'||!text.trim()||text.length>8000){reply(502,{error:'invalid_model_response'});return;}
    if(wanted&&result.done_reason==='stop'&&japaneseSentenceCount(text.trim())!==wanted){
     if(attempt===1){reply(502,{error:'format_not_satisfied'});return;}
     messages=[...messages,{role:'assistant',content:text.trim()},{role:'user',content:`直前の回答は文数が違います。元の依頼の内容を保って、日本語のちょうど${wanted}文に書き直してください。各文は「。」で終え、前置き・番号・引用符・説明を付けず、完成文だけを返してください。`}];continue;
    }
    reply(200,{text:text.trim(),finishReason:['stop','length'].includes(result.done_reason)?result.done_reason:'unknown'});return;
   }
  }catch(error){if([400,408,413].includes(error?.status)){controller.abort();reply(error.status,{error:error.code},true);}else reply(controller.signal.aborted?504:502,{error:controller.signal.aborted?'timeout':'local_model_unavailable'});}finally{clearTimeout(timer);busy=false;}
 });
 server.requestTimeout=75000;server.headersTimeout=10000;server.maxHeadersCount=30;server.maxConnections=10;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const port=Number(process.env.ZERO_AI_PORT||8787);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');const server=createCloudServer({token:process.env.ZERO_AI_SECRET,model:process.env.ZERO_AI_MODEL||'qwen2.5:7b-instruct'});server.listen(port,'127.0.0.1',()=>process.stdout.write('ZERO inference bridge listening on 127.0.0.1:'+port+' (PID '+process.pid+').\n'));}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
