# hl7-fhir-translator — browser demo + docs

A demo, not a product — this is the React/Vite/Tailwind UI that shows off the
[`hl7-fhir-translator`](../packages/core) npm package. Two tabs: **Translator** (paste a
message, translate, inspect the output and its field-level mapping trail) and **Docs**
(the root README, the package's full API reference, and the field-level mapping spec,
rendered from the same markdown files that live in the repo — nothing duplicated).

**Everything runs client-side.** This app imports `hl7-fhir-translator` directly and calls
it in the browser — there's no backend, no API route, no network request involved in
translation. That also means it's just static files: `dist/` is a self-contained static
site, deployable to any static host with zero server-side config.

**Live at:** [heyitskundan.github.io/hl7-fhir-translator](https://heyitskundan.github.io/hl7-fhir-translator/) —
deployed from `main` via [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml).

## Run it

```bash
npm install        # from the repo root
npm run dev         # from here, or `npm run dev -w client` from the root
```

Opens on `http://localhost:5173`.

## Build it

```bash
npm run build        # outputs to client/dist/
npm run preview       # serve the production build locally
```

Building with `GITHUB_PAGES=true npm run build` bakes in the `/hl7-fhir-translator/`
base path GitHub Pages' project-site URL needs; plain `npm run build` builds for serving
at `/` (e.g. `npm run preview`, or any other static host mounted at its own root).

## What this is for

If you just want the translator, install the package: `npm install hl7-fhir-translator` —
see [`packages/core/README.md`](../packages/core/README.md) for the API. This app exists
to make the package's behavior visible and easy to try without writing any code, and to
double as a sanity check that the published API surface is actually pleasant to consume
from a real app.
