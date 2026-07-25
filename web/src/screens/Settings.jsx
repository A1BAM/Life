import { api } from "../api";

export default function Settings({ onLogout }) {
  async function logout() {
    await api.post("/auth/logout");
    onLogout();
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold pt-2">Settings</h1>
      <button
        onClick={logout}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 text-red-400 font-medium"
      >
        Lock
      </button>
      <p className="text-zinc-600 text-xs text-center">
        Config lives in .env on the server — no wizard here on purpose.
      </p>
    </div>
  );
}
