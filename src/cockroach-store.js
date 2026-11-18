'use strict';
// CockroachDB/PostgreSQL-compatible JSONB document store.
// All public persistence methods are asynchronous. CockroachDB SERIALIZABLE
// transaction retries are handled centrally for SQLSTATE 40001.
const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 8),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { ca: process.env.DATABASE_CA_CERT || undefined, rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
});
const id = () => crypto.randomUUID().replace(/-/g, '');
const now = () => new Date().toISOString();
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const refs = {
 users:{author:'users',sender:'users',recipient:'users',user:'users',actor:'users',reporter:'users',admin:'users',reviewedBy:'users',followers:'users',following:'users',blockedUsers:'users','comments.author':'users'},
 giftItems:{gift:'gifts',owner:'users'}, giftTransfers:{sender:'users',recipient:'users',giftItem:'giftItems',reviewedBy:'users'},
 posts:{author:'users','comments.author':'users'}, messages:{sender:'users',recipient:'users'}, friendRequests:{sender:'users',recipient:'users'},
 groupMessages:{sender:'users',group:'groups'}, groups:{owner:'users',members:'users',admins:'users'}, notifications:{user:'users',actor:'users'},
 stories:{author:'users',viewers:'users'}, topups:{user:'users',reviewedBy:'users'}, ledgers:{user:'users',actor:'users'},
 reports:{reporter:'users'}, audits:{admin:'users'}, adverts:{advertiser:'users',reviewedBy:'users'}
};
const defaults = {
 users:{displayName:'',bio:'',avatar:'',role:'user',premium:'free',premiumUntil:null,walletBalance:0,followers:[],following:[],blockedUsers:[],isSuspended:false,lastSeen:now()},
 posts:{text:'',mediaUrl:'',likes:[],comments:[],isRemoved:false},messages:{readAt:null},groupMessages:{text:'',mediaUrl:'',mediaType:'',audioUrl:'',audioDuration:0},
 groups:{description:'',avatar:'',members:[],admins:[],lastMessageAt:null},notifications:{readAt:null,link:''},gifts:{description:'',emoji:'🎁',active:true},
 giftItems:{status:'available',acquiredFrom:'purchase'},topups:{proofUrl:'',status:'pending',adminNote:'',reviewedBy:null,reviewedAt:null},
 giftTransfers:{status:'pending',adminNote:'',reviewedBy:null,reviewedAt:null},ledgers:{},reports:{status:'open'},stories:{text:'',mediaUrl:'',viewers:[]},settings:{},
 adverts:{status:'pending',paymentStatus:'pending',impressions:0,clicks:0,adminNote:'',mediaUrl:'',placement:'feed'},audits:{targetType:'',targetId:'',details:''}
};
function getPath(obj,key){const parts=key.split('.');let v=obj;for(const p of parts){if(v==null)return undefined;if(Array.isArray(v)){v=v.map(x=>x?.[p]);}else v=v[p];}return Array.isArray(v)?v.flat(Infinity):v;}
function eq(a,b){if(a instanceof Date)a=a.toISOString();if(b instanceof Date)b=b.toISOString();return String(a)===String(b);}
function matchValue(actual,expected){
 if(expected instanceof RegExp)return expected.test(String(actual??''));
 if(expected&&typeof expected==='object'&&!Array.isArray(expected)&&!(expected instanceof Date))return Object.entries(expected).every(([op,val])=>{
  if(op==='$ne')return !eq(actual,val);if(op==='$gt')return actual!=null&&(actual instanceof Date||val instanceof Date?new Date(actual)>new Date(val):actual>val);
  if(op==='$gte')return actual!=null&&actual>=val;if(op==='$lt')return actual!=null&&actual<val;if(op==='$lte')return actual!=null&&actual<=val;if(op==='$in')return val.some(x=>eq(actual,x));if(op==='$exists')return val?actual!==undefined:actual===undefined;return false;
 });
 if(Array.isArray(actual))return actual.some(x=>eq(x,expected));return eq(actual,expected);
}
function matches(doc,q={}){return Object.entries(q).every(([k,v])=>k==='$or'?v.some(x=>matches(doc,x)):k==='$and'?v.every(x=>matches(doc,x)):matchValue(getPath(doc,k),v));}
async function init(){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required when using CockroachDB.');
 await pool.query(`CREATE TABLE IF NOT EXISTS documents (
  collection STRING NOT NULL, id STRING NOT NULL, data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection,id)
 )`);
 await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_collection_created ON documents(collection,created_at DESC)`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON documents ((data->>'username')) WHERE collection='users'`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON documents ((data->>'email')) WHERE collection='users'`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_reference ON documents ((data->>'reference')) WHERE collection='topups'`);
 await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_reference ON documents ((data->>'reference')) WHERE collection='ledgers'`);
 await pool.query('SELECT 1');
}
async function tx(work,maxRetries=5){
 for(let attempt=0;;attempt++){
  const client=await pool.connect();
  try{await client.query('BEGIN');const out=await work(client);await client.query('COMMIT');return out;}
  catch(e){try{await client.query('ROLLBACK');}catch{}if(e.code==='40001'&&attempt<maxRetries){await new Promise(r=>setTimeout(r,20*(attempt+1)+Math.floor(Math.random()*30)));continue;}throw e;}
  finally{client.release();}
 }
}
async function getWith(client,collection,docId,lock=false){const r=await client.query(`SELECT data FROM documents WHERE collection=$1 AND id=$2${lock?' FOR UPDATE':''}`,[collection,String(docId)]);return r.rows[0]?.data||null;}
async function saveWith(client,collection,data){const d=clone(data);const stamp=now();d.updatedAt=d.updatedAt||stamp;await client.query(`INSERT INTO documents(collection,id,data,created_at,updated_at) VALUES($1,$2,$3::JSONB,$4,$5) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`,[collection,String(d._id),JSON.stringify(d),d.createdAt||stamp,d.updatedAt||stamp]);return d;}
async function createWith(client,collection,input){const t=now();const d={...(defaults[collection]||{}),...clone(input),_id:input._id||id(),createdAt:input.createdAt||t,updatedAt:t};if(collection==='users'){d.username=String(d.username||'').trim();d.email=String(d.email||'').trim().toLowerCase();if(!input.lastSeen)d.lastSeen=t;}return saveWith(client,collection,d);}
class Doc{
 constructor(model,data){this.$model=model;Object.assign(this,clone(data));this._id=String(this._id);}
 async save(){this.updatedAt=now();await this.$model._save(this);return this;}
 async populate(pathOrSpec,projection){await populateDoc(this,this.$model.collection,pathOrSpec,projection);return this;}
 toJSON(){const out={};for(const [k,v] of Object.entries(this))if(!k.startsWith('$'))out[k]=v;return out;}
}
function attachArrayMethods(doc){for(const [k,v] of Object.entries(doc))if(Array.isArray(v)){if(!v.addToSet)Object.defineProperty(v,'addToSet',{enumerable:false,value(x){if(!v.some(y=>eq(y,x)))v.push(x);}});if(!v.pull)Object.defineProperty(v,'pull',{enumerable:false,value(x){const i=v.findIndex(y=>eq(y,x));if(i>=0)v.splice(i,1);}});}return doc;}
const modelsByCollection={};
async function populateOne(doc,collection,field,projection,nested){const targetCollection=(refs[collection]||{})[field];if(!targetCollection)return;const target=modelsByCollection[targetCollection];const parts=field.split('.');const resolve=async value=>{if(value==null)return value;if(Array.isArray(value))return Promise.all(value.map(resolve));if(typeof value==='object'&&value._id)return value;const found=await target._get(String(value));if(!found)return null;let out=clone(found);if(projection){const keys=projection.split(/\s+/).filter(Boolean);const picked={_id:found._id};for(const k of keys)if(found[k]!==undefined)picked[k]=found[k];out=picked;}if(nested)await populateDoc(out,targetCollection,nested);return out;};const walk=async(node,i)=>{if(node==null)return;if(Array.isArray(node)){for(const x of node)await walk(x,i);return;}const key=parts[i];if(i===parts.length-1){node[key]=await resolve(node[key]);return;}await walk(node[key],i+1);};await walk(doc,0);}
async function populateDoc(doc,collection,spec,projection){if(!doc)return;if(typeof spec==='string'){for(const p of spec.split(' '))await populateOne(doc,collection,p,projection);}else if(spec?.path){for(const p of String(spec.path).split(' '))await populateOne(doc,collection,p,spec.select||projection,spec.populate);}}
class Query{
 constructor(model,kind,filter){this.model=model;this.kind=kind;this.filter=filter||{};this.sortSpec=null;this.max=null;this.populates=[];this.asLean=false;}
 sort(s){this.sortSpec=s;return this;}limit(n){this.max=n;return this;}populate(p,s){this.populates.push(typeof p==='string'?{path:p,select:s}:p);return this;}lean(){this.asLean=true;return this;}
 async exec(){let rows=(await this.model._all()).filter(d=>matches(d,this.filter));if(this.sortSpec){const [[k,dir]]=Object.entries(this.sortSpec);rows.sort((a,b)=>{const av=getPath(a,k),bv=getPath(b,k);return(av>bv?1:av<bv?-1:0)*(dir<0?-1:1);});}if(this.max!=null)rows=rows.slice(0,this.max);const docs=rows.map(d=>this.asLean?clone(d):attachArrayMethods(new Doc(this.model,d)));for(const doc of docs)for(const p of this.populates)await populateDoc(doc,this.model.collection,p);return this.kind==='one'?(docs[0]||null):docs;}
 then(a,b){return this.exec().then(a,b);}
}
class Model{
 constructor(name,collection){this.modelName=name;this.collection=collection;}
 async _all(){const r=await pool.query('SELECT data FROM documents WHERE collection=$1',[this.collection]);return r.rows.map(x=>x.data);}
 async _get(docId){return getWith(pool,this.collection,docId);}
 async _save(doc){const data=doc.toJSON?doc.toJSON():doc;await saveWith(pool,this.collection,data);}
 async create(input){if(Array.isArray(input))return Promise.all(input.map(x=>this._create(x)));return this._create(input);}
 async _create(input){const data=await createWith(pool,this.collection,input);return attachArrayMethods(new Doc(this,data));}
 find(f={}){return new Query(this,'many',f);}findOne(f={}){return new Query(this,'one',f);}findById(x){return new Query(this,'one',{_id:String(x)});}
 async countDocuments(f={}){return(await this._all()).filter(d=>matches(d,f)).length;}
 async deleteMany(f={}){const rows=(await this._all()).filter(d=>matches(d,f));for(const d of rows)await pool.query('DELETE FROM documents WHERE collection=$1 AND id=$2',[this.collection,String(d._id)]);return{deletedCount:rows.length};}
 async updateMany(f,u){const docs=(await this._all()).filter(d=>matches(d,f));for(const d of docs){Object.assign(d,u.$set||u);await this._save(d);}return{modifiedCount:docs.length};}
 async updateOne(f,u,options={}){let d=(await this._all()).find(x=>matches(x,f));if(!d&&options.upsert){d={...(u.$setOnInsert||{}),_id:id(),createdAt:now()};}if(!d)return{matchedCount:0};Object.assign(d,u.$set||{});await this._save(d);return{matchedCount:1};}
 async findByIdAndUpdate(docId,u){const d=await this._get(docId);if(!d)return null;Object.assign(d,u.$set||u);await this._save(d);return attachArrayMethods(new Doc(this,d));}
}
const defs={User:'users',Post:'posts',Message:'messages',FriendRequest:'friendRequests',Group:'groups',GroupMessage:'groupMessages',Notification:'notifications',Gift:'gifts',GiftItem:'giftItems',Topup:'topups',GiftTransfer:'giftTransfers',Ledger:'ledgers',Report:'reports',Story:'stories',Setting:'settings',Audit:'audits',Advert:'adverts'};
for(const [name,col] of Object.entries(defs)){const m=new Model(name,col);modelsByCollection[col]=m;}
const exported={};for(const [name,col] of Object.entries(defs))exported[name]=modelsByCollection[col];
exported.init=init;exported.db={query:(...args)=>pool.query(...args),pool};exported.close=()=>pool.end();
exported.exportSnapshot=async()=>{const r=await pool.query('SELECT collection,id,data,created_at,updated_at FROM documents ORDER BY collection,id');return{format:'chathis-jsonb-snapshot-v1',exportedAt:now(),documents:r.rows.map(x=>({collection:x.collection,id:x.id,data:x.data,created_at:x.created_at,updated_at:x.updated_at}))};};
exported.importSnapshot=async snapshot=>{if(snapshot?.format!=='chathis-jsonb-snapshot-v1'||!Array.isArray(snapshot.documents))throw new Error('Invalid CHATHIS snapshot.');return tx(async c=>{let count=0;for(const row of snapshot.documents){if(!defs||!Object.values(defs).includes(row.collection))continue;await c.query(`INSERT INTO documents(collection,id,data,created_at,updated_at) VALUES($1,$2,$3::JSONB,$4,$5) ON CONFLICT(collection,id) DO NOTHING`,[row.collection,String(row.id),JSON.stringify(row.data),row.created_at||now(),row.updated_at||now()]);count++;}return{imported:count};});};
exported.atomicPurchaseGift=(userId,giftId,quantity)=>tx(async c=>{const user=await getWith(c,'users',userId,true),gift=await getWith(c,'gifts',giftId,true);if(!user||!gift||!gift.active)return{error:'Gift not found.'};const total=Number(gift.value)*quantity;if(!Number.isSafeInteger(total)||total<1)return{error:'Invalid gift quantity.'};if(Number(user.walletBalance||0)<total)return{error:'Insufficient CHATHSI credits. Top up your wallet first.'};user.walletBalance=Number(user.walletBalance||0)-total;user.updatedAt=now();await saveWith(c,'users',user);const items=[];for(let i=0;i<quantity;i++)items.push(await createWith(c,'giftItems',{owner:user._id,gift:gift._id,originalValue:gift.value,acquiredFrom:'purchase'}));await createWith(c,'ledgers',{user:user._id,type:'gift_purchase',amount:-total,balanceAfter:user.walletBalance,reference:`GIFTBUY_${id()}`,description:`Purchased ${quantity} × ${gift.name}`});return{user,items};});
exported.atomicCreateGiftTransfer=(senderId,recipientId,giftItemId)=>tx(async c=>{const item=await getWith(c,'giftItems',giftItemId,true);if(!item||String(item.owner)!==String(senderId)||item.status!=='available')return{error:'Available gift not found.'};const sender=await getWith(c,'users',senderId),recipient=await getWith(c,'users',recipientId);if(!sender||!recipient||recipient.isSuspended)return{error:'Recipient is unavailable.'};item.status='pending';item.updatedAt=now();await saveWith(c,'giftItems',item);const transfer=await createWith(c,'giftTransfers',{sender:senderId,recipient:recipientId,giftItem:item._id,value:item.originalValue});return{transfer};});
exported.atomicReviewTopup=(topupId,adminId,status,note)=>tx(async c=>{const topup=await getWith(c,'topups',topupId,true);if(!topup||topup.status!=='pending')return{error:'Top-up is not pending.'};if(status==='approved'){const user=await getWith(c,'users',topup.user,true);if(!user)return{error:'Top-up user no longer exists.'};user.walletBalance=Number(user.walletBalance||0)+Number(topup.amount);user.updatedAt=now();await saveWith(c,'users',user);await createWith(c,'ledgers',{user:user._id,type:'topup',amount:topup.amount,balanceAfter:user.walletBalance,reference:topup.reference,description:`Approved ${topup.method} top-up`,actor:adminId});}topup.status=status;topup.adminNote=String(note||'').slice(0,500);topup.reviewedBy=adminId;topup.reviewedAt=now();topup.updatedAt=now();await saveWith(c,'topups',topup);return{topup,user:topup.user};});
exported.atomicReviewGiftTransfer=(transferId,adminId,status,note)=>tx(async c=>{const transfer=await getWith(c,'giftTransfers',transferId,true);if(!transfer||transfer.status!=='pending')return{error:'Transfer is not pending.'};const item=await getWith(c,'giftItems',transfer.giftItem,true);if(!item||item.status!=='pending'||String(item.owner)!==String(transfer.sender))return{error:'Gift item is no longer eligible.'};let recipient=null;if(status==='approved'){recipient=await getWith(c,'users',transfer.recipient,true);if(!recipient)return{error:'Recipient no longer exists.'};item.status='transferred';item.updatedAt=now();await saveWith(c,'giftItems',item);recipient.walletBalance=Number(recipient.walletBalance||0)+Number(transfer.value);recipient.updatedAt=now();await saveWith(c,'users',recipient);await createWith(c,'ledgers',{user:recipient._id,type:'gift_received',amount:transfer.value,balanceAfter:recipient.walletBalance,reference:`TRANSFER_${transfer._id}`,description:'Gift transfer value credited (100%)',actor:adminId});}else{item.status='available';item.updatedAt=now();await saveWith(c,'giftItems',item);}transfer.status=status;transfer.adminNote=String(note||'').slice(0,500);transfer.reviewedBy=adminId;transfer.reviewedAt=now();transfer.updatedAt=now();await saveWith(c,'giftTransfers',transfer);return{transfer,recipient:recipient?recipient._id:null,sender:transfer.sender,value:transfer.value};});
module.exports=exported;
