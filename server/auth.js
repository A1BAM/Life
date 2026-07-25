const crypto = require("crypto");
const express = require("express");
const db = require("./db");

const SESSION_DAYS = 90;
const router = express.Router();

function passwordConfigured() {
  return Boolean(process.env.APP_PASSWORD);
}

router.post("/login", (req, res) => {
  if (!passwordConfigured()) {
    return res.status(500).json({ error: "APP_PASSWORD is not set on the server" });
  }
  const { password } = req.body || {};
  const expected = process.env.APP_PASSWORD;
  const ok =
    typeof password === "string" &&
    password.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: "wrong password" });

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO sessions (token, expires_at) VALUES (?, ?)").run(token, expires);
  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 864e5,
    secure: req.secure,
  });
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.sid;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie("sid");
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  res.json({ authed: isAuthed(req), passwordConfigured: passwordConfigured() });
});

function isAuthed(req) {
  // Dev convenience: with no password configured, the app is open.
  // Set APP_PASSWORD in prod — the login screen appears automatically.
  if (!passwordConfigured()) return true;
  const token = req.cookies?.sid;
  if (!token) return false;
  const row = db
    .prepare("SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .get(token);
  return Boolean(row);
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}

module.exports = { router, requireAuth };
