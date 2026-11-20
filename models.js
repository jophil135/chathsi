// Select the database explicitly during the staged migration.
// DB_DRIVER=sqlite keeps the existing SQLite deployment available for export.
// Set DB_DRIVER=cockroach only after the snapshot has been imported.
const driver = String(process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'cockroach' : 'sqlite')).toLowerCase();
if (driver === 'cockroach') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when DB_DRIVER=cockroach.');
  module.exports = require('./cockroach-store');
} else if (driver === 'sqlite') {
  module.exports = require('./sqlite-store');
} else {
  throw new Error('DB_DRIVER must be either sqlite or cockroach.');
}
