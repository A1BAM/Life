import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function Practice() {
  const [params] = useSearchParams();
  const [question, setQuestion] = useState(null);
  const [empty, setEmpty] = useState(false);
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null); // { correct, correct_index, rationales }
  const [stats, setStats] = useState({ answered: 0, correct: 0 });

  const filters = ["course_id", "unit_id"]
    .filter((k) => params.get(k))
    .map((k) => `${k}=${params.get(k)}`)
    .join("&");

  const loadNext = useCallback(async () => {
    setPicked(null);
    setResult(null);
    const data = await api.get(`/study/practice/next${filters ? `?${filters}` : ""}`);
    if (!data.question) setEmpty(true);
    else setQuestion(data.question);
  }, [filters]);

  useEffect(() => {
    loadNext().catch(console.error);
  }, [loadNext]);

  async function answer(index) {
    if (result) return;
    setPicked(index);
    const r = await api.post("/study/attempts", {
      question_id: question.id,
      answered_index: index,
    });
    setResult(r);
    setStats((s) => ({ answered: s.answered + 1, correct: s.correct + (r.correct ? 1 : 0) }));
  }

  if (empty)
    return (
      <div className="max-w-md mx-auto p-4 pt-16 text-center space-y-4">
        <p className="text-zinc-400">No questions here yet.</p>
        <Link to="/study/add" className="text-emerald-400 font-medium">
          Add questions →
        </Link>
      </div>
    );

  if (!question) return <div className="p-4" />;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between pt-2 text-sm">
        <Link to="/study" className="text-zinc-400">← Heatmap</Link>
        <span className="text-zinc-500">
          {stats.answered > 0 && `${stats.correct}/${stats.answered}`}
        </span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        {question.topic && (
          <div className="text-zinc-500 text-xs mb-2">{question.topic}</div>
        )}
        <p className="leading-relaxed">{question.stem}</p>
      </div>

      <div className="space-y-2">
        {question.options.map((opt, i) => {
          let style = "bg-zinc-900 border-zinc-800 active:bg-zinc-800";
          if (result) {
            if (i === result.correct_index)
              style = "bg-emerald-900/60 border-emerald-600";
            else if (i === picked)
              style = "bg-red-900/60 border-red-600";
            else style = "bg-zinc-900 border-zinc-800 opacity-50";
          }
          return (
            <button
              key={i}
              onClick={() => answer(i)}
              disabled={Boolean(result)}
              className={`w-full text-left border rounded-xl p-3.5 ${style}`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {result && (
        <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3 text-sm">
            {question.options.map((opt, i) => (
              <div key={i} className={i === result.correct_index ? "" : "opacity-80"}>
                <span
                  className={`font-semibold ${
                    i === result.correct_index ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {String.fromCharCode(65 + i)}.
                </span>{" "}
                <span className="text-zinc-300">{result.rationales[i]}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => loadNext()}
            className="w-full bg-emerald-600 active:bg-emerald-500 rounded-xl py-3.5 font-medium"
          >
            Next
          </button>
        </>
      )}
    </div>
  );
}
