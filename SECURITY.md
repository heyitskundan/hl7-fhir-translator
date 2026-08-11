# Security Policy

## Supported versions

This package is pre-1.0 (`0.x`). Security fixes land on the latest published version;
older `0.x` versions are not separately patched.

## Reporting a vulnerability

Do not open a public GitHub issue for a security report — report privately so a fix can
ship before the issue is public.

**Report to:** open a private [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository (Security tab → **Report a vulnerability**).

Include, if you can:

- The vulnerable code path (file/function, or the input that triggers it).
- Impact — what an attacker could do with it.
- A minimal reproduction. Synthetic input only; if you're reporting an issue found via
  real patient data, describe the _shape_ of the input rather than pasting the data
  itself.

Expect an acknowledgment within a few days. This is a solo-maintained project — there's
no formal SLA, but security reports are treated as highest priority.

## Scope

This package parses and translates HL7v2/FHIR JSON strings, has zero runtime
dependencies, and performs no network I/O and no persistence — the realistic attack
surface is the parser itself: a malformed or adversarial input causing a crash or
excessive resource consumption. `JSON.parse`-based prototype pollution via a `__proto__`
key does not occur on the FHIR-input path — report it anyway if you find an input shape
that does trigger it. Reports about the demo app in `client/` (a static, client-side-only
page) are also in scope, though its attack surface is smaller for the same reasons.

Out of scope: vulnerabilities in this repo's own `devDependencies` (build/test tooling
such as `vite`/`vitest`) that don't affect the published package or the built demo — track
those via `npm audit` and normal dependency updates instead of a security report.
