const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./fileTracker.db');

// Users table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  // Files tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      filename TEXT PRIMARY KEY,
      last_modified INTEGER
    )
  `);
});

module.exports = db;
