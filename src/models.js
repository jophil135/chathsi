// SQLite-backed model facade. Keeps the existing route layer while persisting
// application records in a local SQLite database on Render's persistent disk.
module.exports = require('./sqlite-store');
