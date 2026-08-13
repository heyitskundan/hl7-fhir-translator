import { useCallback, useState } from "react";
import { translate, TranslateError } from "../api.js";
import { SAMPLES } from "../samples.js";
import type { Direction, TranslateResult } from "../types.js";
import { DirectionToggle } from "./DirectionToggle.js";
import { InputPane } from "./InputPane.js";
import { OutputPane } from "./OutputPane.js";
import { SampleMessages } from "./SampleMessages.js";

export function Translator() {
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

  const handleDirectionChange = useCallback((d: Direction) => {
    setDirection(d);
    setResult(undefined);
    setError(undefined);
  }, []);

  const handleSampleSelect = useCallback((index: number) => {
    const sample = SAMPLES[index];
    if (!sample) return;
    setDirection(sample.direction);
    setInput(sample.content);
    setResult(undefined);
    setError(undefined);
  }, []);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6 lg:px-8" style={{ borderColor: "var(--color-divider)" }}>
        <DirectionToggle direction={direction} onChange={handleDirectionChange} />
        <SampleMessages direction={direction} onSelect={handleSampleSelect} />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <InputPane
            value={input}
            onChange={setInput}
            direction={direction}
            onDirectionChange={handleDirectionChange}
            onTranslate={handleTranslate}
          />
        </div>
        <div className="min-w-0 flex-1">
          <OutputPane result={result} error={error} />
        </div>

        <button
          type="button"
          onClick={handleTranslate}
          disabled={input.trim() === ""}
          title="Translate (⌘⏎)"
          aria-label="Translate"
          className="absolute top-1/2 left-1/2 z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 text-2xl leading-none shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          style={{ borderColor: "var(--color-bg)", background: "var(--color-accent)", color: "var(--color-bg)" }}
        >
          →
        </button>
      </div>
    </div>
  );
}
