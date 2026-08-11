import { useCallback, useState } from "react";
import { translate, TranslateError } from "./api.js";
import { InputPane } from "./components/InputPane.js";
import { OutputPane } from "./components/OutputPane.js";
import { SAMPLES } from "./samples.js";
import type { Direction, TranslateResult } from "./types.js";

export default function App() {
  const [direction, setDirection] = useState<Direction>("hl7ToFhir");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TranslateResult | undefined>();
  const [error, setError] = useState<TranslateError | undefined>();

  const handleTranslate = useCallback(() => {
    if (input.trim() === "") return;
    try {
      setResult(translate(input, direction));
      setError(undefined);
    } catch (err) {
      setResult(undefined);
      setError(err instanceof TranslateError ? err : new TranslateError("Unexpected error"));
    }
  }, [input, direction]);

  const handleSampleSelect = useCallback((index: number) => {
    const sample = SAMPLES[index];
    if (!sample) return;
    setDirection(sample.direction);
    setInput(sample.content);
    setResult(undefined);
    setError(undefined);
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 font-mono text-sm font-bold text-surface-950">
            ⇄
          </div>
          <h1 className="text-lg font-semibold text-slate-100">HL7v2 ⇄ FHIR Translator</h1>
        </div>
        <p className="max-w-2xl text-sm text-slate-500">
          A live demo of the <code className="text-slate-400">hl7-fhir-translate</code> npm package. Translation runs entirely in this tab —
          no server, no network request, no AI in the translation path. Every value in{" "}
          <span className="text-slate-400">Field Mappings</span> traces back to a specific HL7 field or FHIR path through a deterministic,
          unit-tested mapping table.
        </p>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <InputPane
          value={input}
          onChange={setInput}
          direction={direction}
          onDirectionChange={(d) => {
            setDirection(d);
            setResult(undefined);
            setError(undefined);
          }}
          onSampleSelect={handleSampleSelect}
          onTranslate={handleTranslate}
        />
        <OutputPane result={result} error={error} />
      </main>

      <footer className="border-t border-surface-800 pt-4 text-xs text-slate-600">
        Open source, MIT licensed — <code className="text-slate-500">npm install hl7-fhir-translate</code>. Supports ADT^A01, ADT^A08,
        ORU^R01, ORM^O01, and FHIR Patient/DiagnosticReport/ServiceRequest bundles.
      </footer>
    </div>
  );
}
