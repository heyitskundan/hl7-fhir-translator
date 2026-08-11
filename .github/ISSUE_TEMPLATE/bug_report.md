---
name: Bug report
about: A mapping looks wrong, or the package errored/crashed unexpectedly
title: ""
labels: bug
---

**Input** (de-identified/synthetic only — never real patient data)

```
paste the HL7v2 message or FHIR JSON here
```

**Direction:** hl7ToFhir / fhirToHl7

**Expected**

What you expected `translated`/`mappings`/`warnings` to contain, or what you expected to
happen.

**Actual**

What you got instead — the actual output, or the exact error message and `.context` if
one was thrown.

**Environment**

- `hl7-fhir-translate` version: `npm ls hl7-fhir-translate`
- Node.js version: `node -v`
- Library API or CLI?
