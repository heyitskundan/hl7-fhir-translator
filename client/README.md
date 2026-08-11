# hl7-fhir-translate — browser demo

A demo, not a product — this is the React/Vite/Tailwind UI that shows off the
[`hl7-fhir-translate`](../packages/core) npm package. It's a thin visual wrapper: paste a
message, translate, inspect the output and its field-level mapping trail.

**Everything runs client-side.** This app imports `hl7-fhir-translate` directly and calls
it in the browser — there's no backend, no API route, no network request involved in
translation. That also means it's just static files: you can deploy `dist/` to any static
host (GitHub Pages, Netlify, Vercel, S3) with zero server-side config.

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

## What this is for

If you just want the translator, install the package: `npm install hl7-fhir-translate` —
see [`packages/core/README.md`](../packages/core/README.md) for the API. This app exists
to make the package's behavior visible and easy to try without writing any code, and to
double as a sanity check that the published API surface is actually pleasant to consume
from a real app.
