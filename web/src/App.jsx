import { useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { api } from "./api";
import BottomNav from "./components/BottomNav";
import Login from "./screens/Login";
import Today from "./screens/Today";
import Study from "./screens/Study";
import Practice from "./screens/Practice";
import Courses from "./screens/Courses";
import AddQuestions from "./screens/AddQuestions";
import Settings from "./screens/Settings";
import Daily from "./screens/Daily";
import Reset from "./screens/Reset";
import Training from "./screens/Training";

export default function App() {
  const [authed, setAuthed] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/me").then((me) => setAuthed(me.authed)).catch(() => setAuthed(false));
    const onUnauthorized = () => {
      setAuthed(false);
      navigate("/login");
    };
    window.addEventListener("app:unauthorized", onUnauthorized);
    return () => window.removeEventListener("app:unauthorized", onUnauthorized);
  }, [navigate]);

  if (authed === null)
    return <div className="min-h-screen bg-zinc-950" />;

  if (!authed)
    return <Login onLogin={() => setAuthed(true)} />;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-20">
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/study" element={<Study />} />
        <Route path="/study/practice" element={<Practice />} />
        <Route path="/study/courses" element={<Courses />} />
        <Route path="/study/add" element={<AddQuestions />} />
        <Route path="/daily" element={<Daily />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/training" element={<Training />} />
        <Route path="/settings" element={<Settings onLogout={() => setAuthed(false)} />} />
        <Route path="/login" element={<Login onLogin={() => setAuthed(true)} />} />
      </Routes>
      <BottomNav />
    </div>
  );
}
