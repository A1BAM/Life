import { Hono } from "hono";
import {
  authConfigured,
  clearCookieHeader,
  cookieHeader,
  mintToken,
  readCookie,
  requireAuth,
  safeEqual,
  verifyToken,
} from "./auth.js";
import { processChunk, sweepStuckChunks } from "./ingest.js";
import study from "./routes/study.js";
import today from "./routes/today.js";
import training from "./routes/training.js";

const app = new Hono();

// ---------------- auth ----------------

app.get("/api/auth/me", async (c) =>
  c.json({
    authed: !authConfigured(c.env) || (await verifyToken(c.env, readCookie(c.req))),
    auth_configured: authConfigured(c.env),
  })
);

app.post("/api/auth/login", async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: "APP_PASSWORD / SESSION_SECRET are not configured" }, 500);
  const { password } = await c.req.json().catch(() => ({}));
  if (!safeEqual(password, c.env.APP_PASSWORD))
    return c.json({ error: "wrong password" }, 401);
  c.header("Set-Cookie", cookieHeader(await mintToken(c.env)));
  return c.json({ ok: true });
});

app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", clearCookieHeader());
  return c.json({ ok: true });
});

// ---------------- modules ----------------

app.use("/api/*", requireAuth());
app.route("/api/today", today);
app.route("/api/study", study);
app.route("/api/training", training);

// Deep links (/study/practice) must return the SPA shell, not a 404, so a
// bookmarked or refreshed page still loads. /api/* keeps JSON 404s.
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
  if (!c.env.ASSETS) return c.notFound();
  return c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url), c.req.raw));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err?.message || "internal error" }, 500);
});

export default {
  fetch: app.fetch,

  // One message per lecture chunk. Failures throw so the queue retries with
  // backoff; the third attempt is recorded on the chunk and the job moves on.
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await processChunk(env, msg.body.chunk_id);
        msg.ack();
      } catch (err) {
        console.error("chunk failed", msg.body?.chunk_id, err?.message);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },

  // Safety net: re-drive chunks the queue never took (unbound queue) or that
  // died mid-flight.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweepStuckChunks(env));
  },
};
