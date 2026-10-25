import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const models=new Set(['qwen3:0.6b','qwen3:1.7b','qwen3:4b']);
const guidance={文章:'指定された完成原稿を直接書いてください。',翻訳:'指定言語の翻訳文だけを出力し、内容を付け加えないでください。',要約:'与えられた文章だけを要約してください。',コード:'コードの説明や下書きを示し、実行したとは言わないでください。',general:'依頼に直接答えてください。'};
export function cloudMessages(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['prompt','kind','history'].includes(k))||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>2000||!Object.hasOwn(guidance,input.kind)||!Array.isArray(input.history)||input.history.length>4)throw Error('invalid_input');
 if(input.history.reduce((n,m)=>n+(typeof m?.text==='string'?m.text.length:0),0)>700||input.history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>800||Object.keys(m).some(k=>!['role','text'].includes(k))))throw Error('invalid_history');
 const history=input.history.map(m=>({role:m.role,content:m.text}));while(history.length&&history[0].role!=='user')history.shift();
 return [{role:'system',content:'あなたは日本語のアシスタントです。'+guidance[input.kind]+'現在の天気・為替など未照会の事実を推測せず、データ照会を案内してください。外部APIやコードを実行したと偽らないでください。モデル名・ライセンス・出典の定型文は付けません。'},...history,{role:'user',content:input.prompt}];
}
export function createCloudServer({token,model='qwen3:1.7b',fetchImpl=fetch,timeoutMS=70000}={}){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw Error('ZERO_AI_SECRET must be 32–128 URL-safe characters');
 if(!models.has(model))throw Error('Use an approved local Qwen3 model; hosted/cloud tags are not allowed');
 if(!Number.isInteger(timeoutMS)||timeoutMS<1||timeoutMS>70000)throw Error('Invalid timeout');let busy=false;
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Zero-AI':'self-hosted-v1','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
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
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16000){reply(413,{error:'input_too_large'});return;}chunks.push(chunk);}
   let input,messages;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));messages=cloudMessages(input);}catch{reply(400,{error:'invalid_input'});return;}
   const response=await fetchImpl('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:controller.signal,body:JSON.stringify({model,messages,stream:false,think:false,keep_alive:'5m',options:{num_ctx:4096,num_predict:256,temperature:0.3}})});
   if(!response.ok){reply(502,{error:'local_model_unavailable'});return;}const result=await response.json(),text=result?.message?.content;
   if(result?.done!==true||typeof text!=='string'||!text.trim()||text.length>8000){reply(502,{error:'invalid_model_response'});return;}
   reply(200,{text:text.trim(),finishReason:['stop','length'].includes(result.done_reason)?result.done_reason:'unknown'});
  }catch{reply(controller.signal.aborted?504:502,{error:controller.signal.aborted?'timeout':'local_model_unavailable'});}finally{clearTimeout(timer);busy=false;}
 });
 server.requestTimeout=75000;server.headersTimeout=10000;server.maxHeadersCount=30;server.maxConnections=10;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const port=Number(process.env.ZERO_AI_PORT||8787);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');const server=createCloudServer({token:process.env.ZERO_AI_SECRET,model:process.env.ZERO_AI_MODEL||'qwen3:1.7b'});server.listen(port,'127.0.0.1',()=>process.stdout.write('ZERO inference bridge listening on loopback port '+port+'. No public exposure configured.\n'));}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
