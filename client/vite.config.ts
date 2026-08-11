import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site at https://<user>.github.io/<repo>/, so the
// build needs that subpath baked in; local dev stays at the server root.
const base = process.env.GITHUB_PAGES ? "/hl7-fhir-translator/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      // The Docs tab pulls README.md/MAPPING.md straight from the monorepo root via
      // `?raw` imports, which sits outside this package's own directory.
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
});
