const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

require("./db"); // opens DB + runs migrations at boot
const { router: authRouter, requireAuth } = require("./auth");
const studyRouter = require("./routes/study");
const todayRouter = require("./routes/today");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/study", requireAuth, studyRouter);
app.use("/api/today", requireAuth, todayRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "internal error" });
});

// production: serve the built SPA
const dist = path.join(__dirname, "..", "web", "dist");
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  res.sendFile(path.join(dist, "index.html"), (err) => err && next());
});

app.listen(PORT, () => {
  console.log(`life server on :${PORT}`);
  if (!process.env.APP_PASSWORD)
    console.warn("APP_PASSWORD not set — auth is DISABLED (dev mode)");
  if (!process.env.ANTHROPIC_API_KEY)
    console.warn("ANTHROPIC_API_KEY not set — question generation unavailable");
});
