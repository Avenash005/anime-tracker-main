const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./anime_tracker.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Shows table (anime and TV series)
    db.run(`CREATE TABLE IF NOT EXISTS shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      type TEXT, -- 'anime' or 'tv'
      genre TEXT,
      release_year INTEGER,
      total_episodes INTEGER,
      status TEXT, -- 'ongoing', 'completed', etc.
      image_url TEXT
    )`);

    // User watchlists
    db.run(`CREATE TABLE IF NOT EXISTS watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      show_id INTEGER,
      status TEXT, -- 'watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'
      progress INTEGER DEFAULT 0, -- episodes watched
      rating INTEGER,
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (show_id) REFERENCES shows (id)
    )`);

    // Clubs
    db.run(`CREATE TABLE IF NOT EXISTS clubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      creator_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users (id)
    )`);

    // Club members
    db.run(`CREATE TABLE IF NOT EXISTS club_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id INTEGER,
      user_id INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (club_id) REFERENCES clubs (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Discussions
    db.run(`CREATE TABLE IF NOT EXISTS discussions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id INTEGER,
      user_id INTEGER,
      title TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (club_id) REFERENCES clubs (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Insert demo user if not exists
    db.run(`INSERT OR IGNORE INTO users (id, username, email, password) VALUES (1, 'demo', 'demo@example.com', 'demo')`);

    console.log('Database tables initialized.');
  });
}

// API Routes

// Search anime from Jikan API
app.get('/api/anime/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }
  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=10`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch anime data' });
  }
});

// Get top anime
app.get('/api/anime/top', async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const response = await fetch(`https://api.jikan.moe/v4/top/anime?limit=${limit}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top anime' });
  }
});

// Get seasonal anime
app.get('/api/anime/seasonal', async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    // Get current season
    const now = new Date();
    const month = now.getMonth() + 1;
    let season = 'winter';
    if (month >= 4 && month <= 6) season = 'spring';
    else if (month >= 7 && month <= 9) season = 'summer';
    else if (month >= 10 && month <= 12) season = 'fall';
    
    const year = now.getFullYear();
    const response = await fetch(`https://api.jikan.moe/v4/seasons/${year}/${season}?limit=${limit}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch seasonal anime' });
  }
});

// Get all shows
app.get('/api/shows', (req, res) => {
  db.all('SELECT * FROM shows', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ shows: rows });
  });
});

// Add a new show
app.post('/api/shows', (req, res) => {
  const { title, type, genre, release_year, total_episodes, status, image_url } = req.body;
  db.run(`INSERT INTO shows (title, type, genre, release_year, total_episodes, status, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, type, genre, release_year, total_episodes, status, image_url], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id: this.lastID });
  });
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Get user's watchlist
app.get('/api/watchlist/:userId', authenticateToken, (req, res) => {
  const userId = req.params.userId;
  if (req.user.id != userId) return res.status(403).json({ error: 'Unauthorized' });
  db.all(`SELECT w.*, s.title, s.type, s.genre, s.total_episodes, s.image_url
          FROM watchlists w
          JOIN shows s ON w.show_id = s.id
          WHERE w.user_id = ?`, [userId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ watchlist: rows });
  });
});

// Add to watchlist
app.post('/api/watchlist', authenticateToken, (req, res) => {
  const { show_id, status } = req.body;
  const user_id = req.user.id;
  db.run(`INSERT INTO watchlists (user_id, show_id, status) VALUES (?, ?, ?)`,
    [user_id, show_id, status], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id: this.lastID });
  });
});

// Update watchlist item
app.put('/api/watchlist/:id', authenticateToken, (req, res) => {
  const { status, progress, rating, notes } = req.body;
  db.get(`SELECT * FROM watchlists WHERE id = ?`, [req.params.id], (err, item) => {
    if (err || !item || item.user_id != req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    db.run(`UPDATE watchlists SET status = ?, progress = ?, rating = ?, notes = ? WHERE id = ?`,
      [status, progress, rating, notes, req.params.id], function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ changes: this.changes });
    });
  });
});

// Delete watchlist item
app.delete('/api/watchlist/:id', authenticateToken, (req, res) => {
  db.get(`SELECT * FROM watchlists WHERE id = ?`, [req.params.id], (err, item) => {
    if (err || !item || item.user_id != req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    db.run(`DELETE FROM watchlists WHERE id = ?`, [req.params.id], function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ changes: this.changes });
    });
  });
});

// Get clubs
app.get('/api/clubs', (req, res) => {
  db.all('SELECT * FROM clubs', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ clubs: rows });
  });
});

// Create club
app.post('/api/clubs', (req, res) => {
  const { name, description, creator_id } = req.body;
  db.run(`INSERT INTO clubs (name, description, creator_id) VALUES (?, ?, ?)`,
    [name, description, creator_id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id: this.lastID });
  });
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
      [username, email, hashedPassword], function(err) {
      if (err) {
        return res.status(400).json({ error: 'User already exists' });
      }
      const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET);
      res.json({ token, user: { id: this.lastID, username, email } });
    });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  });
});

// Protected routes
app.get('/api/user/profile', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
