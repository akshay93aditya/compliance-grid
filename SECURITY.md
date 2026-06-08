# Security Policy

## Reporting a vulnerability

If you've found a security issue in Compliance Grid, **please do not file a public issue.** Open a private GitHub Security Advisory or email the maintainer at the address configured in `COMPLIANCE_GRID_CONTACT_EMAIL` for this deployment.

We aim to acknowledge reports within 72 hours.

## Scope

In scope:

- The engine, recipes, CLI, and Source Index.
- The Next.js app, auth (scrypt + HttpOnly session cookie), and Org Vault (AES-256-GCM with AAD-bound key).
- Federation primitives (`cg publish`, `cg pull`) and their on-disk JSONL handling.

Out of scope (by design, not necessarily safe to assume):

- Vulnerabilities in upstream dependencies that we cannot mitigate without breaking the build. We track these via `npm audit` and document accepted risks under [Known accepted risks](#known-accepted-risks) below.

## Known accepted risks

- **PostCSS via Next.js (moderate, no upstream fix in 16.x)**: `npm audit` flags an indirect PostCSS dependency through Next 16.2.7. The "fix" auto-suggested by npm downgrades Next to 9.3.3, which we will not accept. We track upstream Next 16.x patches and will update when one ships.

## What gets a CVE

We follow standard severity rules:

- **Critical**: remote code execution, auth bypass, secret exfiltration, federation manipulation that could poison the Commons.
- **High**: privilege escalation, persistent XSS in the auth surface, content injection that bypasses the citation requirement.
- **Moderate**: rate-limit bypass, denial-of-service through the patrol or extraction loops, info disclosure of pre-publication obligations.
- **Low**: cosmetic, logging-only, theoretical without an exploit path.

## Trust model summary

Compliance Grid is designed around the **AI proposes, deterministic code disposes** invariant (D3). The system of record is reached only through deterministic gates — security guarantees about extraction and routing rest on those gates not being bypassable. If you find a path that gets AI output into the CKG without passing through `routeCandidate` + `commit`, treat it as a critical issue.
