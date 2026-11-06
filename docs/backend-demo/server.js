'use strict';
/**
 * MEDIBRIDGE - MYSQL-ONLY, ISOLATED DEMO (Node >=20, MySQL 8)
 * ------------------------------------------------------------------
 * A functional public-web-demo adapter, NOT the converted production backend.
 * Frontend: backend-demo/public/* (plain HTML/CSS/JS, same origin).
 * All write operations are DEMO-only; no payment, real dispensing, or OCR.
 * Always use a separate database containing "demo" in its name.
 */
require('dotenv').config();
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

// 01. Environment / database pool
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
const SESSION_AGE = 24 * 60 * 60 * 1000;
const MAX_BODY = 100_000;
const loginAttempts = new Map();
const ts = () => new Date().toISOString();

function getDbConfig() {
  const name = process.env.DB_NAME || 'medibridge_demo';
  if (!/demo/i.test(name)) throw new Error('REFUSING to use database without "demo" in DB_NAME. Use a separate DEMO database.');
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('DB_NAME must contain only letters, digits and underscore.');
  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT is invalid.');
  const ssl = process.env.DB_SSL === 'true'
    ? (process.env.DB_SSL_CA_FILE
      ? {ca:fs.readFileSync(process.env.DB_SSL_CA_FILE,'utf8'),rejectUnauthorized:true}
      : {rejectUnauthorized:true})
    : undefined;
  return {
    host:process.env.DB_HOST || '127.0.0.1',port,
    user:process.env.DB_USER || 'medibridge_demo_user',
    password:process.env.DB_PASSWORD || '',database:name,
    charset:'utf8mb4',ssl,timezone:'Z',decimalNumbers:true,
    supportBigNumbers:true,bigNumberStrings:false
  };
}
function createDbPool() {
  return mysql.createPool({ ...getDbConfig(), waitForConnections:true,connectionLimit:5,queueLimit:20,
    enableKeepAlive:true,multipleStatements:false });
}
const queryAll = async(db,sql,args=[]) => (await db.execute(sql,args))[0];
const queryOne = async(db,sql,args=[]) => (await queryAll(db,sql,args))[0] || null;
const execute = async(db,sql,args=[]) => (await db.execute(sql,args))[0];
async function transaction(pool, work) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const result=await work(conn); await conn.commit(); return result; }
  catch(error) { try { await conn.rollback(); } catch(e) { console.error('[rollback error]',e.message); } throw error; }
  finally {conn.release();}
}

// 02. Input validation / errors / JSON
class HttpError extends Error {constructor(code,message){super(message);this.status=code;}}
function fail(code,message){throw new HttpError(code,message);}
function positiveInt(value,name,min=1,max=Number.MAX_SAFE_INTEGER) {
  const n=Number(value);if (!Number.isSafeInteger(n)||n<min||n>max) fail(400,`${name}: cần số nguyên từ ${min} đến ${max}.`);return n;
}
function stringField(value,name,max=200,required=true){
  if(value===undefined||value===null){if(!required)return '';fail(400,`${name}: bắt buộc.`);}
  if(typeof value!=='string')fail(400,`${name}: phải là chuỗi.`);
  const s=value.trim();if((required&&!s)||s.length>max)fail(400,`${name}: tối đa ${max} ký tự.`);return s;
}
const normalize = s => String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
function parseJsonBody(req){return new Promise((resolve,reject)=>{
  let size=0;const chunks=[];let tooLarge=false;
  req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){tooLarge=true;reject(new HttpError(413,'Request quá lớn.'));req.destroy();return;}chunks.push(chunk);});
  req.on('end',()=>{if(tooLarge)return;try{
    const body=Buffer.concat(chunks).toString('utf8');const value=body?JSON.parse(body):{};
    if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('object expected');
    resolve(value);
  }catch{reject(new HttpError(400,'JSON không hợp lệ.'));}});
  req.on('error',reject);
});}
function sendJson(res,code,body){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
function ok(res,data,code=200){sendJson(res,code,{success:true,data});}
function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){
  return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;
}
function passwordValid(password,stored){
  const [salt,hex]=String(stored||'').split(':');
  if(!salt||!/^[a-f\d]{128}$/i.test(hex||''))return false;
  return crypto.timingSafeEqual(crypto.scryptSync(password,salt,64),Buffer.from(hex,'hex'));
}
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

// 03. Optional schema setup and fictional seed. Never auto-run on production DB.
async function initializeSchema(){
  const conn=await mysql.createConnection({...getDbConfig(),multipleStatements:true});
  try{const sql=fs.readFileSync(path.join(ROOT,'db','schema.sql'),'utf8');await conn.query(sql);}
  finally{await conn.end();}
}
async function seedDemo(pool,{users=process.env.DEMO_SEED_USERS==='true'}={}){
  await transaction(pool,async db=>{
    // Lock the first table to avoid duplicate fixtures in ordinary single-instance demo deployments.
    const [[{n}]] = await db.query('SELECT COUNT(*) AS n FROM pharmacies');
    if(n>0)return;
    const p=[
      ['Nhà thuốc DEMO A','Địa chỉ giả lập A','Quận mẫu','0000000000','08:00','21:00','approved'],
      ['Nhà thuốc DEMO B','Địa chỉ giả lập B','Quận mẫu','0000000000','07:00','22:00','approved'],
      ['Nhà thuốc DEMO Chờ Duyệt','Địa chỉ giả lập C','Quận mẫu','0000000000','08:00','20:00','pending']
    ];
    const pids=[];
    for(const row of p){const r=await execute(db,`INSERT INTO pharmacies(name,address,district,phone,opening_time,closing_time,verification_status) VALUES(?,?,?,?,?,?,?)`,row);pids.push(r.insertId);}
    const ms=[['Sản phẩm mô phỏng A','Thành phần mô phỏng','—','Mẫu',0],
      ['Sản phẩm mô phỏng B','Thành phần mô phỏng','—','Mẫu',0],
      ['Sản phẩm mô phỏng cần xác nhận','Thành phần mô phỏng','—','Mẫu',1]];
    const mids=[];
    for(const row of ms){const r=await execute(db,`INSERT INTO medicines(name,ingredient,strength,category,is_prescription) VALUES(?,?,?,?,?)`,row);mids.push(r.insertId);}
    for(const [p,m,price,qty] of [[0,0,12000,100],[0,1,18000,30],[1,0,13000,50],[1,2,20000,20]]){
      await execute(db,'INSERT INTO inventory(pharmacy_id,medicine_id,price,quantity) VALUES(?,?,?,?)',[pids[p],mids[m],price,qty]);
    }
    if(users){
      const pw=process.env.DEMO_USER_PASSWORD;
      if(!pw||pw.length<14)throw new Error('To seed demo accounts, set DEMO_USER_PASSWORD (at least 14 chars); do not commit it.');
      const hash=passwordHash(pw);
      await execute(db,'INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',['Admin demo','admin@demo.local',hash,'admin']);
      await execute(db,'INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',['Customer demo','customer@demo.local',hash,'customer']);
      const owner=await execute(db,'INSERT INTO users(name,email,password_hash,role,pharmacy_id) VALUES(?,?,?,?,?)',['Pharmacy demo','pharmacy@demo.local',hash,'pharmacy',pids[0]]);
      await execute(db,'UPDATE pharmacies SET owner_user_id=? WHERE id=?',[owner.insertId,pids[0]]);
    }
  });
}

// 04. Cookie sessions, login, roles
function tokenInCookie(req){return String(req.headers.cookie||'').match(/(?:^|;\s*)demo_sid=([a-f\d]{64})(?:;|$)/)?.[1]||null;}
function cookieOptions(token,maxAge){
  const secure=(PUBLIC_ORIGIN.startsWith('https://')||process.env.NODE_ENV==='production')?'; Secure':'';
  return `demo_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
async function getCurrentUser(db,req){
  const token=tokenInCookie(req);if(!token)return null;
  return queryOne(db,`SELECT u.id,u.name,u.email,u.role,u.pharmacy_id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`,[hashToken(token),Date.now()]);
}
async function requireUser(db,req,roles=[]){
  const u=await getCurrentUser(db,req);if(!u)fail(401,'Vui lòng đăng nhập.');
  if(roles.length&&!roles.includes(u.role))fail(403,'Không đủ quyền.');return u;
}
async function register(db,body){
  const name=stringField(body.name,'Tên',80);
  const email=stringField(body.email,'Email',150).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Email không hợp lệ.');
  const password=stringField(body.password,'Mật khẩu',128);
  if(password.length<10)fail(400,'Mật khẩu tối thiểu 10 ký tự.');
  try{
    const r=await execute(db,'INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',[name,email,passwordHash(password),'customer']);
    return {id:r.insertId,name,email,role:'customer'};
  }catch(e){if(e.code==='ER_DUP_ENTRY')fail(409,'Email đã tồn tại.');throw e;}
}
async function login(db,req,res,body){
  const email=stringField(body.email,'Email',150).toLowerCase();
  const password=stringField(body.password,'Mật khẩu',128);
  const key=`${req.socket.remoteAddress||'unknown'}:${email}`;
  const recent=loginAttempts.get(key);
  if(recent&&recent.until>Date.now()&&recent.n>=10)fail(429,'Quá nhiều lần thử đăng nhập.');
  const user=await queryOne(db,'SELECT * FROM users WHERE email=?',[email]);
  if(!user||!passwordValid(password,user.password_hash)){
    loginAttempts.set(key,{n:recent&&recent.until>Date.now()?recent.n+1:1,until:Date.now()+15*60*1000});
    fail(401,'Sai email hoặc mật khẩu.');
  }
  loginAttempts.delete(key);
  const token=crypto.randomBytes(32).toString('hex');
  await execute(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',[hashToken(token),user.id,Date.now()+SESSION_AGE]);
  res.setHeader('Set-Cookie',cookieOptions(token,Math.floor(SESSION_AGE/1000)));
  return {id:user.id,name:user.name,email:user.email,role:user.role,pharmacy_id:user.pharmacy_id};
}

// 05. Catalog / inventory (fictional fixtures)
function isOpen(ph){
  if(!ph.opening_time&&!ph.closing_time)return true;
  if(!ph.opening_time||!ph.closing_time)return false;
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  if(ph.opening_time<ph.closing_time)return time>=ph.opening_time&&time<ph.closing_time;
  return time>=ph.opening_time||time<ph.closing_time;
}
async function pharmacies(db,q=''){
  const rows=await queryAll(db,"SELECT id,name,address,district,phone,lat,lng,opening_time,closing_time FROM pharmacies WHERE active=1 AND verification_status='approved' ORDER BY id LIMIT 200");
  const word=normalize(q.trim());return rows.filter(p=>!word||normalize(`${p.name} ${p.address} ${p.district}`).includes(word)).map(p=>({...p,is_open:isOpen(p)}));
}
async function medicines(db,q=''){
  const rows=await queryAll(db,'SELECT id,name,ingredient,strength,category,is_prescription FROM medicines WHERE active=1 ORDER BY id LIMIT 500');
  const word=normalize(q.trim());return rows.filter(p=>!word||normalize(`${p.name} ${p.ingredient} ${p.category}`).includes(word)).map(x=>({...x,is_prescription:!!x.is_prescription}));
}
async function inventory(db,pharmacyId){
  if(!await queryOne(db,"SELECT id FROM pharmacies WHERE id=? AND active=1 AND verification_status='approved'",[pharmacyId]))fail(404,'Nhà thuốc không tồn tại hoặc chưa duyệt.');
  const rows=await queryAll(db,`SELECT m.id AS medicine_id,m.name,m.ingredient,m.strength,m.is_prescription,i.price,i.quantity
    FROM inventory i JOIN medicines m ON m.id=i.medicine_id WHERE i.pharmacy_id=? AND m.active=1 ORDER BY m.name`,[pharmacyId]);
  return rows.map(x=>({...x,is_prescription:!!x.is_prescription}));
}

// 06. Demonstration-only prescription text and records (no real OCR / clinical check)
function parseText(value){
  const input=stringField(value,'Văn bản giả lập',4000);
  return input.split(/\r?\n/).filter(Boolean).slice(0,12).map(line=>({rawText:line.trim(),drugName:line.trim(),quantity:1}));
}
async function createPrescription(db,user,body){
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>12)fail(400,'Cần 1 đến 12 dòng dữ liệu.');
  const items=body.items.map(v=>({medicineId:positiveInt(v.medicineId,'Mã sản phẩm'),quantity:positiveInt(v.quantity,'Số lượng',1,20)}));
  if(new Set(items.map(x=>x.medicineId)).size!==items.length)fail(400,'Sản phẩm trùng.');
  for(const x of items)if(!await queryOne(db,'SELECT id FROM medicines WHERE id=? AND active=1',[x.medicineId]))fail(404,'Sản phẩm mô phỏng không tồn tại.');
  const r=await execute(db,'INSERT INTO prescriptions(user_id,items_json,status,created_at) VALUES(?,?,?,?)',[user.id,JSON.stringify(items),'draft',ts()]);
  return {id:r.insertId,items,status:'draft'};
}
async function confirmPrescription(db,user,id){
  const r=await execute(db,"UPDATE prescriptions SET status='confirmed' WHERE id=? AND user_id=? AND status='draft'",[id,user.id]);
  if(r.affectedRows!==1)fail(404,'Không có bản ghi nháp phù hợp.');
  return {id,status:'confirmed',warning:'Demo xác nhận thủ công, KHÔNG phải xác minh đơn thuốc y tế.'};
}
const jsonArray=v=>Array.isArray(v)?v:JSON.parse(String(v));

// 07. Simulated order workflow (NO actual purchase, stock shipment, payment)
const TRANSITIONS={
  pending:{confirmed:['pharmacy','admin'],rejected:['pharmacy','admin'],cancelled:['customer','admin']},
  confirmed:{preparing:['pharmacy','admin'],cancelled:['pharmacy','admin']},
  preparing:{delivering:['pharmacy','admin']},
  delivering:{completed:['pharmacy','customer','admin']},
  completed:{},rejected:{},cancelled:{}
};
const nextStatuses=(status,role)=>Object.entries(TRANSITIONS[status]||{}).filter(([,roles])=>roles.includes(role)).map(([s])=>s);
async function notify(db,userId,message){await execute(db,'INSERT INTO notifications(user_id,message,created_at) VALUES(?,?,?)',[userId,message,ts()]);}
async function createOrder(pool,user,body){
  const pharmacyId=positiveInt(body.pharmacyId,'Mã nhà thuốc');
  const address=stringField(body.shippingAddress,'Địa chỉ mô phỏng',255);
  const phone=stringField(body.phone,'Số điện thoại giả lập',25);
  if(!/^\+?[0-9\s.()-]{8,25}$/.test(phone))fail(400,'Số điện thoại không hợp lệ.');
  const note=stringField(body.note??'','Ghi chú',300,false);
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>12)fail(400,'Giỏ hàng phải có 1-12 dòng.');
  const items=body.items.map(x=>({medicineId:positiveInt(x.medicineId,'Sản phẩm'),quantity:positiveInt(x.quantity,'Số lượng',1,20)}));
  if(new Set(items.map(x=>x.medicineId)).size!==items.length)fail(400,'Sản phẩm trùng.');
  const prescriptionId=body.prescriptionId?positiveInt(body.prescriptionId,'Bản ghi xác nhận'):null;
  return transaction(pool,async db=>{
    const ph=await queryOne(db,"SELECT * FROM pharmacies WHERE id=? AND active=1 AND verification_status='approved'",[pharmacyId]);
    if(!ph)fail(404,'Nhà thuốc demo không tồn tại.');
    let prescriptionItems=[];
    if(prescriptionId){
      const p=await queryOne(db,"SELECT items_json FROM prescriptions WHERE id=? AND user_id=? AND status='confirmed'",[prescriptionId,user.id]);
      if(!p)fail(403,'Bản ghi xác nhận không hợp lệ.');
      prescriptionItems=jsonArray(p.items_json);
    }
    let total=0;const reserved=[];
    for(const item of items){
      // Lock each inventory row while validating & reserving; the transaction rolls back on failure.
      const stock=await queryOne(db,`SELECT i.price,i.quantity,m.is_prescription,m.name FROM inventory i
        JOIN medicines m ON m.id=i.medicine_id WHERE i.pharmacy_id=? AND i.medicine_id=? AND m.active=1 FOR UPDATE`,
        [pharmacyId,item.medicineId]);
      if(!stock)fail(404,`Không có sản phẩm demo #${item.medicineId}.`);
      if(stock.is_prescription&&!prescriptionItems.some(p=>p.medicineId===item.medicineId&&p.quantity>=item.quantity))
        fail(403,'Sản phẩm mẫu cần bản ghi xác nhận mô phỏng.');
      const updated=await execute(db,`UPDATE inventory SET quantity=quantity-? WHERE pharmacy_id=? AND medicine_id=? AND quantity>=?`,
        [item.quantity,pharmacyId,item.medicineId,item.quantity]);
      if(updated.affectedRows!==1)fail(409,'Sản phẩm mô phỏng không đủ tồn kho.');
      total+=stock.price*item.quantity;
      reserved.push({...item,unitPrice:stock.price});
    }
    const created=ts();
    const result=await execute(db,`INSERT INTO orders(user_id,pharmacy_id,prescription_id,status,shipping_address,phone,total,note,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?,?,?,?,?)`,[user.id,pharmacyId,prescriptionId,address,phone,total,note,created,created]);
    for(const i of reserved) await execute(db,`INSERT INTO order_items(order_id,medicine_id,quantity,unit_price) VALUES(?,?,?,?)`,
      [result.insertId,i.medicineId,i.quantity,i.unitPrice]);
    if(ph.owner_user_id)await notify(db,ph.owner_user_id,`Đơn mô phỏng #${result.insertId} mới.`);
    await notify(db,user.id,`Đã tạo đơn mô phỏng #${result.insertId}. Không có giao dịch thật.`);
    return {id:result.insertId,status:'pending',total,items:reserved,demoOnly:true};
  });
}
async function listOrders(db,user){
  let sql=`SELECT o.*,p.name AS pharmacy_name,u.name AS customer_name FROM orders o
     JOIN pharmacies p ON p.id=o.pharmacy_id JOIN users u ON u.id=o.user_id`;
  const params=[];
  if(user.role==='customer'){sql+=' WHERE o.user_id=?';params.push(user.id);}
  if(user.role==='pharmacy'){sql+=' WHERE o.pharmacy_id=?';params.push(user.pharmacy_id??0);}
  sql+=' ORDER BY o.id DESC LIMIT 100';
  const orders=await queryAll(db,sql,params);
  const result=[];
  for(const o of orders){const lines=await queryAll(db,`SELECT oi.medicine_id,m.name,oi.quantity,oi.unit_price FROM order_items oi
     JOIN medicines m ON m.id=oi.medicine_id WHERE oi.order_id=? ORDER BY oi.medicine_id`,[o.id]);
     result.push({...o,items:lines,allowedActions:nextStatuses(o.status,user.role),demoOnly:true});}
  return result;
}
async function updateOrder(pool,user,id,body){
  const status=stringField(body.status,'Trạng thái',30);
  return transaction(pool,async db=>{
    const order=await queryOne(db,'SELECT * FROM orders WHERE id=? FOR UPDATE',[id]);
    if(!order)fail(404,'Không có đơn demo.');
    if(user.role==='customer'&&order.user_id!==user.id)fail(403,'Không có quyền.');
    if(user.role==='pharmacy'&&order.pharmacy_id!==user.pharmacy_id)fail(403,'Không có quyền.');
    const allowed=TRANSITIONS[order.status]?.[status];
    if(!allowed)fail(409,'Chuyển trạng thái không hợp lệ.');
    if(!allowed.includes(user.role))fail(403,'Vai trò không được phép.');
    if(status==='rejected'&&!String(body.note||'').trim())fail(400,'Cần lý do từ chối demo.');
    const change=await execute(db,'UPDATE orders SET status=?,updated_at=? WHERE id=? AND status=?',[status,ts(),id,order.status]);
    if(change.affectedRows!==1)fail(409,'Đơn đã thay đổi.');
    if(['rejected','cancelled'].includes(status)){
      for(const i of await queryAll(db,'SELECT medicine_id,quantity FROM order_items WHERE order_id=?',[id]))
        await execute(db,'UPDATE inventory SET quantity=quantity+? WHERE pharmacy_id=? AND medicine_id=?',[i.quantity,order.pharmacy_id,i.medicine_id]);
    }
    const ph=await queryOne(db,'SELECT owner_user_id FROM pharmacies WHERE id=?',[order.pharmacy_id]);
    await notify(db,order.user_id,`Đơn mô phỏng #${id} chuyển sang: ${status}.`);
    if(ph?.owner_user_id&&ph.owner_user_id!==user.id)await notify(db,ph.owner_user_id,`Đơn mô phỏng #${id}: ${status}.`);
    return {id,status,demoOnly:true};
  });
}

// 08. Simple rules only; intentionally no medical advice / real diagnosis
function evaluateSymptoms(body){
  if(typeof body.difficultyBreathing!=='boolean'||typeof body.severeSymptoms!=='boolean')fail(400,'Cần hai câu trả lời true/false.');
  if(body.difficultyBreathing||body.severeSymptoms)return {redFlag:true,advice:'Cần trao đổi với nhân viên y tế hoặc cơ sở y tế phù hợp.',suggestions:[]};
  return {redFlag:false,advice:'Đây là demo phần mềm, không đánh giá y khoa hoặc kê đơn.',suggestions:[]};
}

// 09. API routes: same endpoints as previous SQLite demo and demo-api.js
async function handleApi(pool,req,res,url){
  const route=url.pathname,method=req.method;
  const body=()=>parseJsonBody(req);
  if(method==='GET'&&route==='/api/health'){
    await queryOne(pool,'SELECT 1 AS online');return ok(res,{ok:true,database:'MySQL demo isolated',engine:'mysql2/promise'});
  }
  if(method==='POST'&&route==='/api/auth/register')return ok(res,await register(pool,await body()),201);
  if(method==='POST'&&route==='/api/auth/login')return ok(res,await login(pool,req,res,await body()));
  if(method==='POST'&&route==='/api/auth/logout'){
    const token=tokenInCookie(req);if(token)await execute(pool,'DELETE FROM sessions WHERE token_hash=?',[hashToken(token)]);
    res.setHeader('Set-Cookie',cookieOptions('',0));return ok(res,{loggedOut:true});
  }
  if(method==='GET'&&route==='/api/me')return ok(res,await getCurrentUser(pool,req));
  if(method==='GET'&&route==='/api/pharmacies')return ok(res,await pharmacies(pool,url.searchParams.get('q')||''));
  if(method==='GET'&&route==='/api/medicines')return ok(res,await medicines(pool,url.searchParams.get('q')||''));
  if(method==='GET'&&route==='/api/search'){
    const q=url.searchParams.get('q')||'';
    return ok(res,{pharmacies:await pharmacies(pool,q),medicines:await medicines(pool,q)});
  }
  let m=route.match(/^\/api\/pharmacies\/(\d+)\/inventory$/);
  if(method==='GET'&&m)return ok(res,await inventory(pool,positiveInt(m[1],'Mã nhà thuốc')));
  if(method==='POST'&&route==='/api/prescriptions/parse-text'){
    await requireUser(pool,req,['customer']);const b=await body();return ok(res,{items:parseText(b.text),warning:'Chỉ dữ liệu text demo, không OCR.'});
  }
  if(method==='POST'&&route==='/api/prescriptions')return ok(res,await createPrescription(pool,await requireUser(pool,req,['customer']),await body()),201);
  if(method==='GET'&&route==='/api/prescriptions'){
    const u=await requireUser(pool,req,['customer']);const rows=await queryAll(pool,'SELECT * FROM prescriptions WHERE user_id=? ORDER BY id DESC',[u.id]);
    return ok(res,rows.map(x=>({...x,items:jsonArray(x.items_json),items_json:undefined})));
  }
  m=route.match(/^\/api\/prescriptions\/(\d+)\/confirm$/);
  if(method==='POST'&&m)return ok(res,await confirmPrescription(pool,await requireUser(pool,req,['customer']),positiveInt(m[1],'Mã bản ghi')));
  if(method==='POST'&&route==='/api/orders')return ok(res,await createOrder(pool,await requireUser(pool,req,['customer']),await body()),201);
  if(method==='GET'&&route==='/api/orders')return ok(res,await listOrders(pool,await requireUser(pool,req)));
  m=route.match(/^\/api\/orders\/(\d+)\/status$/);
  if(method==='PATCH'&&m)return ok(res,await updateOrder(pool,await requireUser(pool,req),positiveInt(m[1],'Mã đơn'),await body()));
  if(method==='GET'&&route==='/api/notifications'){
    const u=await requireUser(pool,req);return ok(res,await queryAll(pool,'SELECT id,message,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50',[u.id]));
  }
  m=route.match(/^\/api\/notifications\/(\d+)\/read$/);
  if(method==='PATCH'&&m){const u=await requireUser(pool,req);await execute(pool,'UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',[ts(),positiveInt(m[1],'Mã thông báo'),u.id]);return ok(res,{read:true});}
  if(method==='POST'&&route==='/api/symptoms/evaluate'){
    await requireUser(pool,req);return ok(res,evaluateSymptoms(await body()));
  }
  if(method==='GET'&&route==='/api/admin/pharmacies'){
    await requireUser(pool,req,['admin']);return ok(res,await queryAll(pool,'SELECT * FROM pharmacies ORDER BY id'));
  }
  m=route.match(/^\/api\/admin\/pharmacies\/(\d+)\/verification$/);
  if(method==='PATCH'&&m){
    await requireUser(pool,req,['admin']);const id=positiveInt(m[1],'Mã nhà thuốc'),status=stringField((await body()).status,'Trạng thái',20);
    if(!['pending','approved','rejected'].includes(status))fail(400,'Trạng thái không hợp lệ.');
    const r=await execute(pool,'UPDATE pharmacies SET verification_status=? WHERE id=?',[status,id]);
    if(r.affectedRows!==1)fail(404,'Nhà thuốc không tồn tại.');return ok(res,{id,status});
  }
  m=route.match(/^\/api\/admin\/inventory\/(\d+)\/(\d+)$/);
  if(method==='PUT'&&m){
    const u=await requireUser(pool,req,['admin','pharmacy']);
    const ph=positiveInt(m[1],'Mã nhà thuốc'),med=positiveInt(m[2],'Mã sản phẩm');
    if(u.role==='pharmacy'&&u.pharmacy_id!==ph)fail(403,'Không có quyền chỉnh kho của nhà thuốc khác.');
    const b=await body(),price=positiveInt(b.price,'Giá',0,1e9),quantity=positiveInt(b.quantity,'Tồn kho',0,1e6);
    if(!await queryOne(pool,'SELECT id FROM pharmacies WHERE id=?',[ph])||!await queryOne(pool,'SELECT id FROM medicines WHERE id=?',[med]))fail(404,'ID không tồn tại.');
    await execute(pool,`INSERT INTO inventory(pharmacy_id,medicine_id,price,quantity) VALUES(?,?,?,?)
      ON DUPLICATE KEY UPDATE price=VALUES(price),quantity=VALUES(quantity)`,[ph,med,price,quantity]);
    return ok(res,{pharmacyId:ph,medicineId:med,price,quantity});
  }
  fail(404,'API không tồn tại.');
}

// 10. Static files (frontend from GitHub), secure path validation
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json; charset=utf-8'};
function within(root,target){const rel=path.relative(root,target);return rel!== '..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel);}
function serveStatic(req,res,pathname){
  let decoded;try{decoded=decodeURIComponent(pathname);}catch{fail(400,'URL không hợp lệ.');}
  if(decoded.includes('\0')||decoded.includes('\\'))fail(400,'URL không hợp lệ.');
  const segments=decoded.split('/').filter(Boolean);
  if(segments.some(s=>s.startsWith('.')))fail(404,'Không tìm thấy file.');
  let full=path.resolve(PUBLIC_DIR,decoded==='/'?'index.html':decoded.slice(1));
  if(!within(PUBLIC_DIR,full))fail(403,'Không được phép truy cập file.');
  let stats;try{stats=fs.statSync(full);}catch{fail(404,'File không tồn tại.');}
  if(stats.isDirectory())full=path.join(full,'index.html');
  if(!within(PUBLIC_DIR,full))fail(403,'Không được phép truy cập file.');
  const ext=path.extname(full).toLowerCase();if(!Object.hasOwn(MIME,ext))fail(404,'Định dạng file không được phục vụ.');
  try{if(!fs.statSync(full).isFile())fail(404,'File không tồn tại.');}catch(e){if(e.status)throw e;fail(404,'File không tồn tại.');}
  const rootReal=fs.realpathSync(PUBLIC_DIR),fullReal=fs.realpathSync(full);
  if(!within(rootReal,fullReal))fail(403,'Không được phép truy cập file.');
  res.writeHead(200,{'Content-Type':MIME[ext],'Cache-Control':'no-cache'});
  fs.createReadStream(full).pipe(res);
}
function allowedOrigin(req){
  const origin=String(req.headers.origin||'');if(!origin)return true;
  if(PUBLIC_ORIGIN)return origin===PUBLIC_ORIGIN;
  return origin===`http://localhost:${PORT}`||origin===`http://127.0.0.1:${PORT}`;
}
function makeServer(pool){return http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  try{
    if(!allowedOrigin(req))fail(403,'Origin không được phép.');
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))return await handleApi(pool,req,res,url);
    if(req.method==='GET'||req.method==='HEAD')return serveStatic(req,res,url.pathname);
    fail(404,'Đường dẫn không tồn tại.');
  }catch(e){if(res.headersSent){if(!res.writableEnded)res.end();return;}
    const status=e.status||500;
    if(status===500)console.error('[demo error]',e);
    sendJson(res,status,{success:false,message:status===500?'Lỗi máy chủ demo.':e.message});
  }
});}

// 11. Bootstrap / controlled shutdown
async function main(){
  if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('PORT không hợp lệ.');
  if(HOST==='0.0.0.0'&&!PUBLIC_ORIGIN)console.warn('WARNING: Configure PUBLIC_ORIGIN to your exact HTTPS public domain.');
  if(process.env.DEMO_AUTO_INIT==='true')await initializeSchema();
  const pool=createDbPool();
  try{
    await queryOne(pool,'SELECT id FROM users LIMIT 1'); // Fail fast if connection/schema missing.
    if(process.env.DEMO_AUTO_SEED==='true')await seedDemo(pool);
    const server=makeServer(pool);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});
    console.log(`MEDIBRIDGE MySQL demo: http://${HOST}:${PORT}`);
    console.log('Database: dedicated MySQL DEMO schema (not production).');
    const stop=()=>server.close(()=>{pool.end().finally(()=>process.exit(0));});
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }catch(e){await pool.end();throw e;}
}
if(require.main===module){main().catch(e=>{console.error('[startup failed]',e.message);process.exitCode=1;});}
module.exports={getDbConfig,createDbPool,initializeSchema,seedDemo,makeServer,positiveInt,parseText,
  nextStatuses,passwordHash,passwordValid,allowedOrigin,serveStatic,main};
