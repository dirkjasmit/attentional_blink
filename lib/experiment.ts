// Attentional blink trial generation and scoring.

export const SETTINGS = {
  /** Time each item is on screen (ms). 150 ms ≈ 6.7 items per second. */
  itemMs: 150,
  /** Blank screen after a response, before the next fixation cross (ms). */
  blankMs: 700,
  /** Items per RSVP stream. Keep room for firstTargetMax + the longest lag plus a few items. */
  streamLength: 20,
  /** Earliest / latest (0-based) position of the first target. */
  firstTargetMin: 3,
  firstTargetMax: 6,
  /** Lags (in items) between T1 and T2 on dual-target trials. Dual trials are split evenly over these. */
  lags: [3, 7] as const,
  /** Fixation cross duration before the stream (ms). */
  fixationMs: 600,
  /** Default number of trials; can be overridden with ?trials=N in the URL. */
  defaultTrials: 40,
};

export type Target = "6" | "9";
export type Answer = "none" | "6" | "9" | "both";
export type Lag = (typeof SETTINGS.lags)[number];

export type Condition = "none" | "single" | `lag${number}`;

export interface Trial {
  number: number;
  condition: Condition;
  lag: Lag | null;
  stream: string[];
  /** Stream positions (0-based) of the targets, in order of appearance. */
  targetPositions: number[];
  targets: Target[];
  correct: Answer;
}

export interface TrialResult extends Trial {
  response: Answer;
  isCorrect: boolean;
  rtMs: number;
  /** Longest gap between screen refreshes during the stream; >50 ms means items may have been skipped. */
  maxFrameGapMs: number;
}

export const MAX_OK_FRAME_GAP_MS = 50;

const DISTRACTORS = ["0", "1", "2", "3", "4", "5", "7", "8"];

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Distractor stream with no digit repeated on consecutive items. */
function distractorStream(length: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    let d: string;
    do d = DISTRACTORS[randInt(0, DISTRACTORS.length - 1)];
    while (d === out[i - 1]);
    out.push(d);
  }
  return out;
}

function buildTrial(number: number, lag: Lag | null, targets: Target[]): Trial {
  const stream = distractorStream(SETTINGS.streamLength);
  const condition: Condition = targets.length === 0 ? "none" : lag === null ? "single" : `lag${lag}`;
  const targetPositions: number[] = [];

  if (targets.length > 0) {
    const t1 = randInt(SETTINGS.firstTargetMin, SETTINGS.firstTargetMax);
    targetPositions.push(t1);
    if (lag) targetPositions.push(t1 + lag);
    targetPositions.forEach((pos, i) => (stream[pos] = targets[i]));
  }

  const correct: Answer =
    targets.length === 0 ? "none" : targets.length === 2 ? "both" : targets[0];

  return { number, condition, lag, stream, targetPositions, targets, correct };
}

/**
 * Balanced, shuffled trial list:
 *  - 50% dual-target (one 6 and one 9, order counterbalanced), split evenly over SETTINGS.lags
 *  - 25% single target (6 or 9)
 *  - 25% no target
 */
export function generateTrials(total: number): Trial[] {
  const lags = SETTINGS.lags;
  const nDual = Math.round(total * 0.5);
  const nSingle = Math.round(total * 0.25);
  const nNone = total - nDual - nSingle;

  const specs: { lag: Lag | null; targets: Target[] }[] = [];
  for (let i = 0; i < nDual; i++) {
    const lag = lags[i % lags.length];
    const order: Target[] = Math.floor(i / lags.length) % 2 === 0 ? ["6", "9"] : ["9", "6"];
    specs.push({ lag, targets: order });
  }
  for (let i = 0; i < nSingle; i++) {
    specs.push({ lag: null, targets: [i % 2 === 0 ? "6" : "9"] });
  }
  for (let i = 0; i < nNone; i++) specs.push({ lag: null, targets: [] });

  return shuffle(specs).map((s, i) => buildTrial(i + 1, s.lag, s.targets));
}

export const ANSWER_LABEL: Record<Answer, string> = {
  none: "No target",
  "6": "Only 6",
  "9": "Only 9",
  both: "Both 6 and 9",
};

export function conditionLabel(condition: Condition): string {
  if (condition === "none") return "No target";
  if (condition === "single") return "One target";
  return `Two targets, lag ${condition.slice(3)}`;
}

export function summarize(results: TrialResult[]) {
  const conditions: Condition[] = ["none", "single", ...SETTINGS.lags.map((l): Condition => `lag${l}`)];
  return conditions.map((c) => {
    const rs = results.filter((r) => r.condition === c);
    const correct = rs.filter((r) => r.isCorrect).length;
    return {
      condition: c,
      label: conditionLabel(c),
      n: rs.length,
      correct,
      pct: rs.length ? (100 * correct) / rs.length : 0,
    };
  });
}

export function toCsv(results: TrialResult[], name: string, studentId: string): string {
  const header = [
    "name", "student_id", "trial", "condition", "lag", "targets", "target_positions",
    "correct_answer", "response", "is_correct", "rt_ms", "max_frame_gap_ms", "timing_ok", "stream",
  ];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = results.map((r) =>
    [
      name, studentId, r.number, r.condition, r.lag ?? "", r.targets.join(" "),
      r.targetPositions.map((p) => p + 1).join(" "), r.correct, r.response,
      r.isCorrect ? 1 : 0, Math.round(r.rtMs), Math.round(r.maxFrameGapMs),
      r.maxFrameGapMs <= MAX_OK_FRAME_GAP_MS ? 1 : 0, r.stream.join(""),
    ].map(esc).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
