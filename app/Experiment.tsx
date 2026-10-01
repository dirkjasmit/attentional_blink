"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SETTINGS,
  generateTrials,
  summarize,
  toCsv,
  type Answer,
  type Trial,
  type TrialResult,
} from "@/lib/experiment";

type Phase = "login" | "instructions" | "ready" | "running" | "respond" | "results";

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

  /** Number of trials for this run: ?trials=N in the URL, otherwise the default. */
  function trialCount() {
    const param = Number(new URLSearchParams(window.location.search).get("trials"));
    return Number.isFinite(param) && param >= 4 ? Math.min(param, 400) : SETTINGS.defaultTrials;
  }

  /** Human-readable version of the settings, shown on the start screen. */
  function parameterList(): [string, string][] {
    const { soaMs, itemOnMs, streamLength, firstTargetMin, firstTargetMax, lags, fixationMs, interTrialMs } = SETTINGS;
    return [
      ["SOA", `${soaMs} ms (${Math.round(1000 / soaMs)} items per second)`],
      ["Item duration", `${itemOnMs} ms visible, then ${soaMs - itemOnMs} ms blank`],
      ["Stream length", `${streamLength} digits (${(streamLength * soaMs) / 1000} s)`],
      ["Targets", "6 and 9 — other digits are 0–5, 7 and 8"],
      ["First target", `item ${firstTargetMin + 1}–${firstTargetMax + 1} of the stream`],
      ["Lags (T1→T2)", lags.map((l) => `${l} (${l * soaMs} ms)`).join(" and ")],
      ["Trials", `${trialCount()} — 50% two targets, 25% one target, 25% no target`],
      ["Before each stream", `${interTrialMs} ms blank, then a fixation cross for ${fixationMs} ms`],
      ["Feedback", "none during the experiment; score is shown at the end"],
    ];
  }

  function startExperiment() {
    const n = trialCount();
    setTrials(generateTrials(n));
    setResults([]);
    setIndex(0);
    setPhase("ready");
  }

  // RSVP presentation: drive the display from requestAnimationFrame and write straight
  // into the DOM so React rendering can't add jitter to the item timing.
  // Timeline per trial: blank → fixation cross → stream.
  useEffect(() => {
    if (phase !== "running" || !trial) return;
    const el = stimRef.current;
    if (!el) return;

    let raf = 0;
    let start = -1;
    let prev = -1;
    let shownText: string | null = null;
    const streamStart = SETTINGS.interTrialMs + SETTINGS.fixationMs;
    const streamEnd = streamStart + trial.stream.length * SETTINGS.soaMs;
    maxFrameGap.current = 0;

    const tick = (now: number) => {
      if (start < 0) start = now;
      if (prev >= 0 && now - start > streamStart) {
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

      // Blank → fixation cross → stream. Within each SOA the digit is visible for
      // itemOnMs and the remainder of the SOA is blank.
      let text = "";
      let fixation = true;
      if (t >= streamStart) {
        const inStream = t - streamStart;
        fixation = false;
        if (inStream % SETTINGS.soaMs < SETTINGS.itemOnMs) {
          text = trial.stream[Math.floor(inStream / SETTINGS.soaMs)];
        }
      } else if (t >= SETTINGS.interTrialMs) {
        text = "+";
      }

      if (text !== shownText) {
        shownText = text;
        el.className = fixation ? "rsvp fixation" : "rsvp";
        el.textContent = text;
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
      // No feedback: go straight on to the next trial.
      if (index + 1 >= trials.length) {
        setPhase("results");
      } else {
        setIndex(index + 1);
        setPhase("running");
      }
    },
    [phase, trial, index, trials.length],
  );

  // Keyboard support for laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (phase === "respond" && KEY_TO_ANSWER[k]) respond(KEY_TO_ANSWER[k]);
      else if (phase === "ready" && (k === " " || k === "enter")) {
        e.preventDefault();
        setPhase("running");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, respond]);

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
          <p>
            You will see a rapid stream of digits in the middle of the screen, about{" "}
            {Math.round(1000 / SETTINGS.soaMs)} per second.
          </p>
          <ul>
            <li>Watch for the targets <strong>6</strong> and <strong>9</strong>.</li>
            <li>A stream can contain no target, only a 6, only a 9, or both.</li>
            <li>After each stream, report what you saw. The next stream then starts automatically.</li>
            <li>You see your score at the end.</li>
          </ul>
          <p>Keep your eyes on the cross (+) before each stream starts. Hold your phone steady and turn the brightness up.</p>
          <details className="params">
            <summary>Experimental parameters</summary>
            <dl>
              {parameterList().map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
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

  // Results
  const summary = summarize(results);
  const shortLag = SETTINGS.lags[0];
  const longLag = SETTINGS.lags[SETTINGS.lags.length - 1];
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
              <span>{s.label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${s.pct}%` }} />
              </div>
              <span className="pct">{s.n ? `${Math.round(s.pct)}%` : "–"}</span>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 16 }}>
          The attentional blink: if the second target comes shortly after the first (lag {shortLag}, ~
          {shortLag * SETTINGS.soaMs} ms), people often miss it. At lag {longLag} (~{longLag * SETTINGS.soaMs} ms) it
          is usually easier to report both. Compare your two bars for two targets.
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
