const express = require('express');
const bcrypt = require('bcrypt');
const chokidar = require('chokidar');
const socketIo = require('socket.io');
const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Initialize Express & HTTP Server
const app = express();
const httpServer = require('http').createServer(app);
const io = socketIo(httpServer);

// Configurations
const DATA_DIR = path.join(__dirname, 'data/json_files'); // JSON files directory
const PORT = process.env.PORT || 3000;

// Database Setup
const db = new sqlite3.Database('./fileTracker.db');

// Create tables if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      filename TEXT PRIMARY KEY,
      last_modified INTEGER
    )
  `);
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---------- Authentication Routes ----------
// Create default admin user
bcrypt.hash('admin123', 10, (err, hash) => {
  db.run(
    "INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)",
    ['admin', hash]
  );
});

// Login Handler
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    (err, user) => {
      if (!user) return res.status(401).send('Invalid username!');
      bcrypt.compare(password, user.password, (err, result) => {
        if (result) {
          req.session.user = user;
          res.redirect('/dashboard');
        } else {
          res.status(401).send('Invalid password!');
        }
      });
    }
  );
});

// ---------- File Watcher ----------
const watcher = chokidar.watch(DATA_DIR, {
  ignored: /(^|[/\\])\../,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 2000 }
});

let debounceTimer;
watcher.on('change', (filePath) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const stats = await fs.promises.stat(filePath);
      db.get(
        "SELECT last_modified FROM files WHERE filename = ?",
        [filePath],
        (err, row) => {
          if (!row || row.last_modified < stats.mtimeMs) {
            db.run(
              "REPLACE INTO files (filename, last_modified) VALUES (?, ?)",
              [filePath, stats.mtimeMs]
            );
            io.emit('file-updated', { filename: filePath });
          }
        }
      );
    } catch (err) {
      console.error('Error processing file:', err);
    }
  }, 1000); // Debounce 1 second
});

// ---------- API Routes ----------
// Get all JSON data
app.get('/data', (req, res) => {
  db.all("SELECT filename FROM files", [], (err, rows) => {
    const allData = [];
    rows.forEach(row => {
      try {
        const rawData = fs.readFileSync(row.filename);
        const jsonData = JSON.parse(rawData);
        allData.push(...jsonData);
      } catch (err) {
        console.error(`Error reading ${row.filename}:`, err);
      }
    });
    res.json(allData);
  });
});

// Export to Excel
app.get('/export', (req, res) => {
  db.all("SELECT filename FROM files", [], (err, rows) => {
    const allData = [];
    rows.forEach(row => {
      try {
        const rawData = fs.readFileSync(row.filename);
        const jsonData = JSON.parse(rawData);
        allData.push(...jsonData);
      } catch (err) {
        console.error(`Error reading ${row.filename}:`, err);
      }
    });

    const worksheet = XLSX.utils.json_to_sheet(allData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=export.xlsx');
    res.end(buffer);
  });
});

// Start Server
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
});
