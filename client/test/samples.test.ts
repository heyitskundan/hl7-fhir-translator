import { describe, expect, it } from "vitest";
import { translate } from "../src/api.js";
import { SAMPLES } from "../src/samples.js";

// Ties the demo dropdown's sample data to the core package's actual supported types.
describe("SAMPLES", () => {
  it.each(SAMPLES)("$label translates without throwing", (sample) => {
    const result = translate(sample.content, sample.direction);
    expect(result.translated.length).toBeGreaterThan(0);
  });
});
