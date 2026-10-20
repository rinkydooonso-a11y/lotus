import http from 'node:http'; import Redis from 'ioredis';
const r = new Redis();
http.createServer((q,s)=>{let b='';q.on('data',d=>b+=d);q.on('end',async()=>{
 s.setHeader('content-type','application/json');
 try{const j=JSON.parse(b);
  if(q.url.startsWith('/pipeline')||q.url.startsWith('/multi-exec')){
    const out=[];for(const c of j){try{out.push({result:await r.call(...c.map(String))})}catch(e){out.push({error:e.message})}}
    return s.end(JSON.stringify(out));}
  s.end(JSON.stringify({result:await r.call(...j.map(String))}));
 }catch(e){s.statusCode=400;s.end(JSON.stringify({error:String(e.message)}))}})}).listen(8079);
