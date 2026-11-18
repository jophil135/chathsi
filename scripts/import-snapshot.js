'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in your local .env before importing.');
process.env.DB_DRIVER = 'cockroach';
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/import-snapshot.js path/to/chathis-database-export.json');
const M = require('../src/models');
(async()=>{
  try {
    await M.init();
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const result = await M.importSnapshot(snapshot);
    console.log(`Imported ${result.imported} records into CockroachDB.`);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  } finally { await M.close(); }
})();
