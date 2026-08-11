import { FhirValidationError, Hl7ParseError, translateFhirToHl7, translateHl7ToFhir } from "hl7-fhir-translator";
import type { Direction, TranslateResult } from "./types.js";

export class TranslateError extends Error {
  constructor(
    message: string,
    public readonly context?: string,
  ) {
    super(message);
    this.name = "TranslateError";
  }
}

/**
 * Runs entirely in the browser — the translation package has zero runtime dependencies
 * and does no I/O, so nothing here ever leaves the tab.
 */
export function translate(input: string, direction: Direction): TranslateResult {
  try {
    return direction === "hl7ToFhir" ? translateHl7ToFhir(input) : translateFhirToHl7(input);
  } catch (error) {
    if (error instanceof Hl7ParseError || error instanceof FhirValidationError) {
      throw new TranslateError(error.message, error.context);
    }
    throw error;
  }
}
