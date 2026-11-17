'use strict';
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'chathsi.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(collection, id)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_collection_created ON documents(collection, created_at)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON documents(json_extract(data,'$.username')) WHERE collection='users'`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON documents(json_extract(data,'$.email')) WHERE collection='users'`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_reference ON documents(json_extract(data,'$.reference')) WHERE collection='topups'`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_reference ON documents(json_extract(data,'$.reference')) WHERE collection='ledgers'`);

const id = () => require('crypto').randomUUID().replace(/-/g, '');
const now = () => new Date().toISOString();
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const refs = {
  users: { author:'users', sender:'users', recipient:'users', user:'users', actor:'users', reporter:'users', admin:'users', reviewedBy:'users', followers:'users', following:'users', blockedUsers:'users', 'comments.author':'users' },
  giftItems: { gift:'gifts', owner:'users' },
  giftTransfers: { sender:'users', recipient:'users', giftItem:'giftItems', reviewedBy:'users' },
  posts: { author:'users', 'comments.author':'users' },
  messages: { sender:'users', recipient:'users' },
  notifications: { user:'users', actor:'users' },
  stories: { author:'users', viewers:'users' },
  topups: { user:'users', reviewedBy:'users' },
  ledgers: { user:'users', actor:'users' },
  reports: { reporter:'users' },
  audits: { admin:'users' }
};
const defaults = {
 users:{displayName:'',bio:'',avatar:'',role:'user',premium:'free',premiumUntil:null,walletBalance:0,followers:[],following:[],blockedUsers:[],isSuspended:false,lastSeen:now()},
 posts:{text:'',mediaUrl:'',likes:[],comments:[],isRemoved:false}, messages:{readAt:null}, notifications:{readAt:null,link:''},
 gifts:{description:'',emoji:'🎁',active:true}, giftItems:{status:'available',acquiredFrom:'purchase'}, topups:{proofUrl:'',status:'pending',adminNote:'',reviewedBy:null,reviewedAt:null},
 giftTransfers:{status:'pending',adminNote:'',reviewedBy:null,reviewedAt:null}, ledgers:{}, reports:{status:'open'}, stories:{text:'',mediaUrl:'',viewers:[]}, settings:{}, audits:{targetType:'',targetId:'',details:''}
};
function getPath(obj, key) { const parts=key.split('.'); const walk=(value,i)=>{ if(value==null)return undefined; if(i===parts.length)return value; if(Array.isArray(value))return value.map(v=>walk(v,i)).flat(); return walk(value[parts[i]],i+1); }; return walk(obj,0); }
function setPath(obj,key,value){const parts=key.split('.');const walk=(target,i)=>{if(i===parts.length-1){target[parts[i]]=value;return;}if(Array.isArray(target)){target.forEach(x=>walk(x,i));return;}if(!target[parts[i]])return;walk(target[parts[i]],i+1);};walk(obj,0);}
function eq(a,b) { if (a instanceof Date) a=a.toISOString(); if (b instanceof Date) b=b.toISOString(); return String(a)===String(b); }
function matchValue(actual, expected) {
 if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
 if (expected && typeof expected==='object' && !Array.isArray(expected) && !(expected instanceof Date)) {
   return Object.entries(expected).every(([op,val])=>{
    if(op==='$ne') return !eq(actual,val);
    if(op==='$gt') return actual!=null && (actual instanceof Date || val instanceof Date ? new Date(actual)>new Date(val) : actual>val);
    if(op==='$gte') return actual!=null && actual>=val;
    if(op==='$lt') return actual!=null && actual<val;
    if(op==='$in') return val.some(x=>eq(actual,x));
    if(op==='$exists') return val ? actual!==undefined : actual===undefined;
    return false;
   });
 }
 if(Array.isArray(actual)) return actual.some(x=>eq(x,expected));
 return eq(actual,expected);
}
function matches(doc, query={}) {
 return Object.entries(query).every(([key,val])=>{
  if(key==='$or') return val.some(q=>matches(doc,q));
  if(key==='$and') return val.every(q=>matches(doc,q));
  return matchValue(getPath(doc,key),val);
 });
}
class Doc {
 constructor(model, data) { this.$model=model; Object.assign(this, clone(data)); this._id=String(this._id); this.$dirty=false; }
 async save() { this.updatedAt=now(); this.$model._save(this); this.$dirty=false; return this; }
 async populate(pathOrSpec, projection) { await populateDoc(this, this.$model.collection, pathOrSpec, projection); return this; }
 toJSON() { const out={}; for(const [k,v] of Object.entries(this)) if(!k.startsWith('$')) out[k]=v; return out; }
}
function attachArrayMethods(doc) {
 for(const [k,v] of Object.entries(doc)) if(Array.isArray(v)) {
  if(!v.addToSet) Object.defineProperty(v,'addToSet',{enumerable:false,value(x){if(!v.some(y=>eq(y,x)))v.push(x);}});
  if(!v.pull) Object.defineProperty(v,'pull',{enumerable:false,value(x){const i=v.findIndex(y=>eq(y,x));if(i>=0)v.splice(i,1);}});
 }
 return doc;
}
async function populateOne(doc, collection, field, projection, nested) {
 const targetCollection=(refs[collection]||{})[field]; if(!targetCollection) return;
 const targetModel=modelsByCollection[targetCollection];
 const parts=field.split('.');
 const resolve=async value=>{
  if(value==null)return value;
  if(Array.isArray(value))return Promise.all(value.map(resolve));
  if(typeof value==='object' && value._id)return value;
  const found=targetModel._get(String(value)); if(!found)return null;
  let out=clone(found);
  if(projection){const keys=projection.split(/\s+/).filter(Boolean);const picked={_id:found._id};for(const k of keys)if(found[k]!==undefined)picked[k]=found[k];out=picked;}
  if(nested)await populateDoc(out,targetCollection,nested);
  return out;
 };
 const walk=async (node,index)=>{
  if(node==null)return;
  if(Array.isArray(node)){for(const item of node)await walk(item,index);return;}
  const key=parts[index];
  if(index===parts.length-1){node[key]=await resolve(node[key]);return;}
  await walk(node[key],index+1);
 };
 await walk(doc,0);
}
async function populateDoc(doc, collection, pathOrSpec, projection) {
 if(!doc) return;
 if(typeof pathOrSpec==='string') {
  const parts=pathOrSpec.split(' ');
  for(const p of parts) await populateOne(doc,collection,p,projection);
 } else if(pathOrSpec && pathOrSpec.path) {
  for(const p of String(pathOrSpec.path).split(' ')) await populateOne(doc,collection,p,pathOrSpec.select || projection,pathOrSpec.populate);
 }
}
class Query {
 constructor(model, kind, filter, extra) { this.model=model;this.kind=kind;this.filter=filter||{};this.extra=extra;this.sortSpec=null;this.max=null;this.populates=[];this.asLean=false; }
 sort(spec){this.sortSpec=spec;return this;} limit(n){this.max=n;return this;} populate(p,s){this.populates.push(typeof p==='string'?{path:p,select:s}:p);return this;} lean(){this.asLean=true;return this;}
 async exec(){
  let rows=this.model._all().filter(d=>matches(d,this.filter));
  if(this.sortSpec){const [[k,dir]]=Object.entries(this.sortSpec);rows.sort((a,b)=>{const av=getPath(a,k),bv=getPath(b,k);return (av>bv?1:av<bv?-1:0)*(dir<0?-1:1);});}
  if(this.max!=null)rows=rows.slice(0,this.max);
  const docs=rows.map(d=>this.asLean?clone(d):attachArrayMethods(new Doc(this.model,d)));
  for(const doc of docs) for(const p of this.populates) await populateDoc(doc,this.model.collection,p);
  return this.kind==='one'?(docs[0]||null):docs;
 }
 then(resolve,reject){return this.exec().then(resolve,reject);}
}
class Model {
 constructor(name,collection){this.modelName=name;this.collection=collection;}
 _all(){return db.prepare('SELECT data FROM documents WHERE collection=?').all(this.collection).map(r=>JSON.parse(r.data));}
 _get(id){const r=db.prepare('SELECT data FROM documents WHERE collection=? AND id=?').get(this.collection,String(id));return r?JSON.parse(r.data):null;}
 _save(doc){const data=doc.toJSON?doc.toJSON():doc;db.prepare('INSERT INTO documents(collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(this.collection,String(data._id),JSON.stringify(data),data.createdAt||now(),data.updatedAt||now());}
 async create(input){if(Array.isArray(input))return input.map(x=>this._create(x));return this._create(input);}
 _create(input){const t=now(),data={...(defaults[this.collection]||{}),...clone(input),_id:input._id||id(),createdAt:input.createdAt||t,updatedAt:t};if(this.collection==='users'){data.username=String(data.username||'').trim();data.email=String(data.email||'').trim().toLowerCase();if(!input.lastSeen)data.lastSeen=t;}if(data.createdAt instanceof Date)data.createdAt=data.createdAt.toISOString();if(data.updatedAt instanceof Date)data.updatedAt=data.updatedAt.toISOString();const doc=attachArrayMethods(new Doc(this,data));this._save(doc);return doc;}
 find(filter={}){return new Query(this,'many',filter);} findOne(filter={}){return new Query(this,'one',filter);} findById(id){return new Query(this,'one',{_id:String(id)});}
 async countDocuments(filter={}){return this._all().filter(d=>matches(d,filter)).length;}
 async updateMany(filter, update){const docs=this._all().filter(d=>matches(d,filter));for(const d of docs){Object.assign(d,update.$set||update);this._save(d);}return {modifiedCount:docs.length};}
 async updateOne(filter,update,options={}){let d=this._all().find(x=>matches(x,filter));if(!d&&options.upsert){d={...(update.$setOnInsert||{}),_id:id(),createdAt:now()};}if(!d)return {matchedCount:0};Object.assign(d,update.$set||{});this._save(d);return {matchedCount:1};}
 async findByIdAndUpdate(id,update,options={}){const d=this._get(id);if(!d)return null;Object.assign(d,update.$set||update);this._save(d);return attachArrayMethods(new Doc(this,d));}
}
const modelsByCollection={};
const defs={User:'users',Post:'posts',Message:'messages',Notification:'notifications',Gift:'gifts',GiftItem:'giftItems',Topup:'topups',GiftTransfer:'giftTransfers',Ledger:'ledgers',Report:'reports',Story:'stories',Setting:'settings',Audit:'audits'};

function atomicPurchaseGift(userId, giftId, quantity) {
 return db.transaction(() => {
  const user=modelsByCollection.users._get(userId), gift=modelsByCollection.gifts._get(giftId);
  if(!user || !gift || !gift.active) return {error:'Gift not found.'};
  const total=Number(gift.value)*quantity;
  if(!Number.isSafeInteger(total) || total<1) return {error:'Invalid gift quantity.'};
  if(Number(user.walletBalance||0)<total) return {error:'Insufficient CHATHSI credits. Top up your wallet first.'};
  user.walletBalance=Number(user.walletBalance||0)-total; user.updatedAt=now(); modelsByCollection.users._save(user);
  const items=[]; for(let i=0;i<quantity;i++) items.push(modelsByCollection.giftItems._create({owner:user._id,gift:gift._id,originalValue:gift.value,acquiredFrom:'purchase'}));
  modelsByCollection.ledgers._create({user:user._id,type:'gift_purchase',amount:-total,balanceAfter:user.walletBalance,reference:`GIFTBUY_${id()}`,description:`Purchased ${quantity} × ${gift.name}`});
  return {user,items};
 })();
}
function atomicCreateGiftTransfer(senderId, recipientId, giftItemId) {
 return db.transaction(() => {
  const item=modelsByCollection.giftItems._get(giftItemId);
  if(!item || String(item.owner)!==String(senderId) || item.status!=='available') return {error:'Available gift not found.'};
  const sender=modelsByCollection.users._get(senderId), recipient=modelsByCollection.users._get(recipientId);
  if(!sender || !recipient || recipient.isSuspended) return {error:'Recipient is unavailable.'};
  item.status='pending';item.updatedAt=now();modelsByCollection.giftItems._save(item);
  const transfer=modelsByCollection.giftTransfers._create({sender:senderId,recipient:recipientId,giftItem:item._id,value:item.originalValue});
  return {transfer};
 })();
}
function atomicReviewTopup(topupId, adminId, status, note) {
 return db.transaction(() => {
  const topup=modelsByCollection.topups._get(topupId);
  if(!topup || topup.status!=='pending') return {error:'Top-up is not pending.'};
  if(status==='approved') {
   const user=modelsByCollection.users._get(topup.user); if(!user)return {error:'Top-up user no longer exists.'};
   user.walletBalance=Number(user.walletBalance||0)+Number(topup.amount);user.updatedAt=now();modelsByCollection.users._save(user);
   modelsByCollection.ledgers._create({user:user._id,type:'topup',amount:topup.amount,balanceAfter:user.walletBalance,reference:topup.reference,description:`Approved ${topup.method} top-up`,actor:adminId});
  }
  topup.status=status;topup.adminNote=String(note||'').slice(0,500);topup.reviewedBy=adminId;topup.reviewedAt=now();topup.updatedAt=now();modelsByCollection.topups._save(topup);
  return {topup,user:topup.user};
 })();
}
function atomicReviewGiftTransfer(transferId, adminId, status, note) {
 return db.transaction(() => {
  const transfer=modelsByCollection.giftTransfers._get(transferId);
  if(!transfer || transfer.status!=='pending') return {error:'Transfer is not pending.'};
  const item=modelsByCollection.giftItems._get(transfer.giftItem);
  if(!item || item.status!=='pending' || String(item.owner)!==String(transfer.sender)) return {error:'Gift item is no longer eligible.'};
  let recipient=null;
  if(status==='approved') {
   recipient=modelsByCollection.users._get(transfer.recipient);if(!recipient)return {error:'Recipient no longer exists.'};
   item.status='transferred';item.updatedAt=now();modelsByCollection.giftItems._save(item);
   recipient.walletBalance=Number(recipient.walletBalance||0)+Number(transfer.value);recipient.updatedAt=now();modelsByCollection.users._save(recipient);
   modelsByCollection.ledgers._create({user:recipient._id,type:'gift_received',amount:transfer.value,balanceAfter:recipient.walletBalance,reference:`TRANSFER_${transfer._id}`,description:'Gift transfer value credited (100%)',actor:adminId});
  } else { item.status='available';item.updatedAt=now();modelsByCollection.giftItems._save(item); }
  transfer.status=status;transfer.adminNote=String(note||'').slice(0,500);transfer.reviewedBy=adminId;transfer.reviewedAt=now();transfer.updatedAt=now();modelsByCollection.giftTransfers._save(transfer);
  return {transfer,recipient:recipient?recipient._id:null,sender:transfer.sender,value:transfer.value};
 })();
}

const exported={};for(const [name,col] of Object.entries(defs)){const m=new Model(name,col);modelsByCollection[col]=m;exported[name]=m;}
exported.db=db;
exported.atomicPurchaseGift=atomicPurchaseGift;
exported.atomicCreateGiftTransfer=atomicCreateGiftTransfer;
exported.atomicReviewTopup=atomicReviewTopup;
exported.atomicReviewGiftTransfer=atomicReviewGiftTransfer;
exported.close=()=>db.close();
module.exports=exported;
