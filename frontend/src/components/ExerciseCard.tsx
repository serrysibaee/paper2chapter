"use client";

import { useState } from "react";
import { isNumericallyCorrect } from "@/lib/grading";
import type { MarkdownContext } from "@/lib/markdown";
import { runPython, withTests, type RunResult } from "@/lib/pyodide";
import type { Exercise, VerificationResult } from "@/lib/types";
import { Markdown } from "./Markdown";
import { VerifyBadge } from "./VerifyBadge";

const KIND_LABEL: Record<Exercise["kind"], string> = {
  conceptual: "Concept",
  multiple_choice: "Multiple choice",
  math: "Math",
  python: "Python",
};

export function ExerciseCard({ ex, ctx, verification }: { ex: Exercise; ctx: MarkdownContext; verification?: VerificationResult }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="exercise" id={`ex-${ex.id}`}>
      <div className="ex-head">
        <span>{KIND_LABEL[ex.kind]}</span>
        <span className={`diff ${ex.difficulty}`}>{ex.difficulty}</span>
        <VerifyBadge result={verification} />
      </div>
      <Markdown text={ex.prompt_md} ctx={ctx} />
      {ex.kind === "multiple_choice" && <MultipleChoice ex={ex} ctx={ctx} onAnswered={() => setRevealed(true)} />}
      {ex.kind === "math" && ex.numeric_answer !== null && <NumericAnswer ex={ex} onAnswered={() => setRevealed(true)} />}
      {ex.kind === "conceptual" && <textarea className="answer-box" rows={3} placeholder="Write your answer, then compare with the solution." />}
      {ex.kind === "python" && <PythonRunner ex={ex} />}
      <button className="link-btn" onClick={() => setRevealed((r) => !r)}>
        {revealed ? "Hide solution" : "Show solution"}
      </button>
      {revealed && (
        <div className="solution">
          <Markdown text={ex.answer_md} ctx={ctx} />
          <Markdown text={ex.explanation_md} ctx={ctx} />
          {ex.kind === "python" && ex.solution_code && (
            <>
              <div className="muted small">Reference solution</div>
              <pre><code>{ex.solution_code}</code></pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MultipleChoice({ ex, ctx, onAnswered }: { ex: Exercise; ctx: MarkdownContext; onAnswered: () => void }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const correct = checked && choice === ex.correct_choice;
  return (
    <div>
      <div className="choices" role="radiogroup">
        {ex.choices.map((c, i) => {
          const state = checked ? (i === ex.correct_choice ? "correct" : i === choice ? "wrong" : "") : "";
          return (
            <label key={i} className={`choice ${state}`}>
              <input type="radio" name={ex.id} checked={choice === i} onChange={() => { setChoice(i); setChecked(false); }} />
              <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
              <Markdown text={c} ctx={ctx} inline />
            </label>
          );
        })}
      </div>
      <div className="row">
        <button className="btn small" disabled={choice === null} onClick={() => { setChecked(true); onAnswered(); }}>Check</button>
        {checked && <span className={correct ? "ok" : "bad"}>{correct ? "Correct" : "Not quite - see the explanation."}</span>}
      </div>
    </div>
  );
}

function NumericAnswer({ ex, onAnswered }: { ex: Exercise; onAnswered: () => void }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  return (
    <div className="row">
      <input
        className="input num"
        value={value}
        placeholder="Your answer"
        onChange={(e) => { setValue(e.target.value); setResult(null); }}
        onKeyDown={(e) => e.key === "Enter" && value && setResult(isNumericallyCorrect(value, ex.numeric_answer!, ex.tolerance))}
      />
      <button className="btn small" disabled={!value} onClick={() => { setResult(isNumericallyCorrect(value, ex.numeric_answer!, ex.tolerance)); onAnswered(); }}>
        Check
      </button>
      {result !== null && <span className={result ? "ok" : "bad"}>{result ? "Correct" : "Not quite"}</span>}
    </div>
  );
}

function PythonRunner({ ex }: { ex: Exercise }) {
  const initial = ex.starter_code ?? "";
  const [code, setCode] = useState(initial);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  async function run(withTestCode: boolean) {
    setRunning(true);
    setResult(null);
    const src = withTestCode && ex.test_code ? withTests(code, ex.test_code) : code;
    setResult(await runPython(src));
    setRunning(false);
  }

  return (
    <div className="py">
      <textarea
        className="code"
        spellCheck={false}
        value={code}
        rows={Math.min(24, Math.max(6, code.split("\n").length + 1))}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = t;
            setCode(code.slice(0, s) + "    " + code.slice(end));
            requestAnimationFrame(() => t.setSelectionRange(s + 4, s + 4));
          }
        }}
      />
      <div className="row">
        <button className="btn small" disabled={running} onClick={() => run(true)}>{running ? "Running…" : "Run tests"}</button>
        <button className="btn small ghost" disabled={running} onClick={() => run(false)}>Run</button>
        <button className="btn small ghost" disabled={running} onClick={() => { setCode(initial); setResult(null); }}>Reset</button>
        <span className="muted small">Runs in your browser (Pyodide); the first run downloads the Python runtime.</span>
      </div>
      {result && (
        <div className={`run-out ${result.ok ? "ok" : "bad"}`}>
          <strong>{result.ok ? "All tests passed" : result.timedOut ? "Timed out" : "Failed"}</strong>
          {(result.stdout || result.error) && <pre>{[result.stdout.trim(), result.error].filter(Boolean).join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}
