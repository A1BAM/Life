import { useState } from "react";
import { api } from "../api";

export default function Login({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { password });
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h1 className="text-zinc-100 text-2xl font-semibold text-center">Life</h1>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 outline-none focus:border-emerald-500"
        />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button
          disabled={busy || !password}
          className="w-full bg-emerald-600 disabled:opacity-40 rounded-xl py-3 text-white font-medium"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
