const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "data", "life.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const applied = new Set(
  db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id)
);
const dir = path.join(__dirname, "migrations");
for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith(".sql") || applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(file);
  })();
  console.log(`migration applied: ${file}`);
}

module.exports = db;
