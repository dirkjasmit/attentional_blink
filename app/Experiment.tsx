"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANSWER_LABEL,
  CONDITION_LABEL,
  MAX_OK_FRAME_GAP_MS,
  SETTINGS,
  generateTrials,
  summarize,
  toCsv,
  type Answer,
  type Trial,
  type TrialResult,
} from "@/lib/experiment";

type Phase = "login" | "instructions" | "ready" | "running" | "respond" | "feedback" | "results";

const STORAGE_KEY = "ab-student";

const ANSWERS: { value: Answer; label: string; key: string }[] = [
  { value: "none", label: "No target", key: "N" },
  { value: "6", label: "6", key: "6" },
  { value: "9", label: "9", key: "9" },
  { value: "both", label: "Both", key: "B" },
];

const KEY_TO_ANSWER: Record<string, Answer> = { n: "none", "0": "none", "6": "6", "9": "9", b: "both" };

export default function Experiment() {
  const [phase, setPhase] = useState<Phase>("login");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [trials, setTrials] = useState<Trial[]>([]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<TrialResult[]>([]);

  const stimRef = useRef<HTMLDivElement>(null);
  const responseStart = useRef(0);
  const maxFrameGap = useRef(0);

  // Restore a previous "login" on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved?.name) {
        setName(saved.name);
        setStudentId(saved.studentId ?? "");
      }
    } catch {}
  }, []);

  const trial = trials[index];
  const score = results.filter((r) => r.isCorrect).length;

  function login(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: name.trim(), studentId: studentId.trim() }));
    } catch {}
    setPhase("instructions");
  }

  function logout() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setName("");
    setStudentId("");
    setResults([]);
    setPhase("login");
  }

  function startExperiment() {
    const param = Number(new URLSearchParams(window.location.search).get("trials"));
    const n = Number.isFinite(param) && param >= 4 ? Math.min(param, 400) : SETTINGS.defaultTrials;
    setTrials(generateTrials(n));
    setResults([]);
    setIndex(0);
    setPhase("ready");
  }

  // RSVP presentation: drive the display from requestAnimationFrame and write straight
  // into the DOM so React rendering can't add jitter to the 100 ms item timing.
  useEffect(() => {
    if (phase !== "running" || !trial) return;
    const el = stimRef.current;
    if (!el) return;

    let raf = 0;
    let start = -1;
    let prev = -1;
    let shown = -2;
    const streamEnd = SETTINGS.fixationMs + trial.stream.length * SETTINGS.itemMs;
    maxFrameGap.current = 0;

    const tick = (now: number) => {
      if (start < 0) start = now;
      if (prev >= 0 && now - start > SETTINGS.fixationMs) {
        maxFrameGap.current = Math.max(maxFrameGap.current, now - prev);
      }
      prev = now;
      // Half a frame of tolerance so items land on the nearest screen refresh.
      const t = now - start + 8;

      if (t >= streamEnd) {
        el.textContent = "";
        responseStart.current = performance.now();
        setPhase("respond");
        return;
      }

      const item = t < SETTINGS.fixationMs ? -1 : Math.floor((t - SETTINGS.fixationMs) / SETTINGS.itemMs);
      if (item !== shown) {
        shown = item;
        el.className = item < 0 ? "rsvp fixation" : "rsvp";
        el.textContent = item < 0 ? "+" : trial.stream[item];
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, trial]);

  const respond = useCallback(
    (response: Answer) => {
      if (phase !== "respond" || !trial) return;
      const result: TrialResult = {
        ...trial,
        response,
        isCorrect: response === trial.correct,
        rtMs: performance.now() - responseStart.current,
        maxFrameGapMs: maxFrameGap.current,
      };
      setResults((rs) => [...rs, result]);
      setPhase("feedback");
    },
    [phase, trial],
  );

  const next = useCallback(() => {
    if (index + 1 >= trials.length) {
      setPhase("results");
    } else {
      setIndex((i) => i + 1);
      setPhase("running");
    }
  }, [index, trials.length]);

  // Keyboard support for laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (phase === "respond" && KEY_TO_ANSWER[k]) respond(KEY_TO_ANSWER[k]);
      else if ((phase === "feedback" || phase === "ready") && (k === " " || k === "enter")) {
        e.preventDefault();
        if (phase === "ready") setPhase("running");
        else next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, respond, next]);

  if (phase === "login") {
    return (
      <main className="screen">
        <form className="card" onSubmit={login}>
          <h1>Attentional Blink</h1>
          <p>Sign in to start the experiment.</p>
          <label htmlFor="name">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          <label htmlFor="sid">Student number (optional)</label>
          <input id="sid" value={studentId} onChange={(e) => setStudentId(e.target.value)} inputMode="numeric" />
          <button className="btn" type="submit" disabled={!name.trim()}>
            Continue
          </button>
        </form>
      </main>
    );
  }

  if (phase === "instructions") {
    return (
      <main className="screen">
        <div className="card">
          <h1>Hi {name}!</h1>
          <p>You will see a rapid stream of digits in the middle of the screen, about 10 per second.</p>
          <ul>
            <li>Watch for the targets <strong>6</strong> and <strong>9</strong>.</li>
            <li>A stream can contain no target, only a 6, only a 9, or both.</li>
            <li>After each stream, report what you saw. You get feedback and a running score.</li>
          </ul>
          <p>Keep your eyes on the cross (+) before each stream starts. Hold your phone steady and turn the brightness up.</p>
          <button className="btn" onClick={startExperiment}>
            Start experiment
          </button>
          <button className="btn secondary" onClick={logout}>
            Not {name}? Sign out
          </button>
        </div>
      </main>
    );
  }

  if (phase === "ready") {
    return (
      <main className="screen">
        <p className="question">Ready?</p>
        <p className="score">{trials.length} trials. Tap the button to see the first stream.</p>
        <button className="btn" style={{ maxWidth: 460 }} onClick={() => setPhase("running")}>
          Start first trial
        </button>
      </main>
    );
  }

  if (phase === "running") {
    return (
      <div className="stage">
        <div ref={stimRef} className="rsvp fixation" />
      </div>
    );
  }

  if (phase === "respond") {
    return (
      <main className="screen">
        <p className="question">What did you see?</p>
        <div className="answers">
          {ANSWERS.map((a) => (
            <button key={a.value} className="answer" onClick={() => respond(a.value)}>
              {a.label}
              <span className="key">key {a.key}</span>
            </button>
          ))}
        </div>
        <p className="score">
          Trial {index + 1} / {trials.length}
        </p>
      </main>
    );
  }

  if (phase === "feedback") {
    const last = results[results.length - 1];
    return (
      <main className="screen">
        <div className="topbar">
          <span>
            Trial {index + 1} / {trials.length}
          </span>
          <span>
            Score {score} / {results.length}
          </span>
        </div>
        <p className={`feedback ${last.isCorrect ? "good" : "bad"}`}>{last.isCorrect ? "Correct!" : "Wrong"}</p>
        <p className="score">
          Answer: <strong>{ANSWER_LABEL[last.correct]}</strong>
          {last.lag ? ` (second target ${last.lag} items after the first)` : ""}
          {!last.isCorrect && (
            <>
              <br />
              You said: {ANSWER_LABEL[last.response]}
            </>
          )}
        </p>
        {last.maxFrameGapMs > MAX_OK_FRAME_GAP_MS && (
          <p className="score">⚠️ The screen stuttered during this stream, so this trial is flagged in the data.</p>
        )}
        <button className="btn" style={{ maxWidth: 460 }} onClick={next}>
          {index + 1 >= trials.length ? "See results" : "Next trial"}
        </button>
      </main>
    );
  }

  // Results
  const summary = summarize(results);
  const pct = results.length ? Math.round((100 * score) / results.length) : 0;

  function downloadCsv() {
    const blob = new Blob([toCsv(results, name, studentId)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attentional-blink-${name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="screen">
      <div className="card">
        <h1>Done, {name}!</h1>
        <p>
          Final score: <strong style={{ color: "var(--text)" }}>{score} / {results.length}</strong> ({pct}%)
        </p>
        <div className="bars">
          {summary.map((s) => (
            <div className="bar-row" key={s.condition}>
              <span>{CONDITION_LABEL[s.condition]}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${s.pct}%` }} />
              </div>
              <span className="pct">{s.n ? `${Math.round(s.pct)}%` : "–"}</span>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 16 }}>
          The attentional blink: if the second target comes shortly after the first (lag 2, ~200 ms), people often miss
          it. At lag 4 (~400 ms) it is usually easier to report both. Compare your two bars for two targets.
        </p>
        <button className="btn" onClick={downloadCsv}>
          Download my data (CSV)
        </button>
        <button className="btn secondary" onClick={startExperiment}>
          Run again
        </button>
        <button className="linkbtn" style={{ marginTop: 16 }} onClick={logout}>
          Sign out
        </button>
      </div>
    </main>
  );
}
