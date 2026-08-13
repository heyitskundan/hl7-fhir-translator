import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's auto-cleanup registers against a global `afterEach`, which
// only exists with `test.globals: true`; this config opts out of globals, so cleanup is
// wired explicitly here instead, once, for every test file.
afterEach(cleanup);

// Shared jsdom stand-ins for matchMedia/scrollIntoView/scrollTo, none of which jsdom
// implements natively.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

window.scrollTo = () => {};
