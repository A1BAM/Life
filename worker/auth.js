/**
 * Single-user auth. Stateless: the cookie is an HMAC-signed expiry stamp, so
 * there is no session table and no DB round trip on each request.
 */

const COOKIE = "sid";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const enc = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function mintToken(env) {
  const payload = String(Date.now() + TTL_MS);
  const sig = await crypto.subtle.sign("HMAC", await key(env.SESSION_SECRET), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyToken(env, token) {
  if (!token || !env.SESSION_SECRET) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  let sig;
  try {
    sig = fromB64url(token.slice(dot + 1));
  } catch {
    return false;
  }
  const ok = await crypto.subtle.verify(
    "HMAC",
    await key(env.SESSION_SECRET),
    sig,
    enc.encode(payload)
  );
  if (!ok) return false;
  return Number(payload) > Date.now();
}

/** Constant-time string compare — avoids leaking the password via timing. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare lengths without early return.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function authConfigured(env) {
  return Boolean(env.APP_PASSWORD && env.SESSION_SECRET);
}

export function readCookie(req, name = COOKIE) {
  const header = req.header("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function cookieHeader(token) {
  const attrs = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  return attrs.join("; ");
}

export function clearCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Hono middleware. With no password configured the app is open (local dev). */
export function requireAuth() {
  return async (c, next) => {
    if (!authConfigured(c.env)) return next();
    if (await verifyToken(c.env, readCookie(c.req))) return next();
    return c.json({ error: "unauthorized" }, 401);
  };
}
