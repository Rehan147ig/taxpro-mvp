# TaxPro Knowledge Index

## Project Overview
- [[README]] — Product overview, YC thesis, quick start, architecture
- [[TAXPRO_KT]] — Comprehensive knowledge transfer for AI engineers
- [[ARCHITECTURE]] — Mermaid architecture diagram (frontend → API → engine → infra)

## Production Readiness
- [[docs/PRODUCTION_READINESS_REPORT]] — P1/P2 audit trail, infrastructure, test results
- [[docs/ROADMAP_PRODUCTION]] — launch checklist (Phases 1–11, all ticked) + hard constraints
- [[docs/EXTERNAL_REVIEW_BRIEF]] — CPA + security audit brief (what to verify, evidence index)
- [[docs/EDGAR_SKIP_GAP_REPORT]] — US eval skip root causes + ranked fixes
- [[docs/PUBLIC_DATA_VALIDATION]] — benchmark methodology (honesty contract)
- [[docs/AI_EVAL]] — eval modes + multi-agent harness contract

## CI/CD & Security (2026-08-03)
- `.github/workflows/` — 4 workflows on every push/PR to `master`: CI (security scan, fresh-Postgres lint+test, Docker+Trivy), CodeQL, Semgrep (p/security-audit), OSV dependency gate; Dependabot enabled

## Enterprise Package (isolated, UNVALIDATED)
- [[packages/tax-engine-enterprise/README]] — group relief / apportionment / GL-ELT exploratory package
- [[packages/tax-engine-enterprise/ASSUMPTIONS]] — every assumption catalogued (44 tests, not wired into any app)

## Agent System
- [[apps/api/src/agent/instructions]] — Eve agent runtime instructions
- [[apps/api/src/agent/skills/asc-740-guidance]] — ASC 740 technical guidance for AI agents
- [[apps/api/src/agent/skills/sec-174-rd]] — Section 174 R&D capitalization guidance
