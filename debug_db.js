const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./anime_tracker.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Insert demo user
db.run(`INSERT OR IGNORE INTO users (id, username, email, password) VALUES (1, 'demo', 'demo@example.com', 'demo')`, function(err) {
  if (err) {
    console.error('Error inserting user:', err);
  } else {
    console.log('Demo user inserted or already exists');
  }
});

// Check shows data
db.all(`SELECT * FROM shows`, [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Shows data:', rows);
  }
});

// Check watchlist data
db.all(`SELECT w.*, s.title, s.type, s.genre, s.total_episodes, s.image_url
        FROM watchlists w
        JOIN shows s ON w.show_id = s.id
        WHERE w.user_id = 1`, [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Watchlist data for user 1:', rows);
  }
  db.close();
});
