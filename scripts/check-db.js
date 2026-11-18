'use strict';
require('dotenv').config();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
process.env.DB_DRIVER = 'cockroach';
const M = require('../src/models');
(async()=>{try{await M.init();const r=await M.db.query('SELECT current_database() AS database, version() AS version');console.log('CockroachDB connection successful:',r.rows[0]);}catch(e){console.error('CockroachDB connection failed:',e.message);process.exitCode=1;}finally{await M.close();}})();
