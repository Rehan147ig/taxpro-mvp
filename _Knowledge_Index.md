# TaxPro Knowledge Index

## Project Overview
- [[README]] — Product overview, YC thesis, quick start, architecture
- [[TAXPRO_KT]] — Comprehensive knowledge transfer for AI engineers
- [[ARCHITECTURE]] — Mermaid architecture diagram (frontend → API → engine → infra)
- Official website: https://taxpro.ploy.build/ (product, benchmark evidence, pilot)

## Production Readiness
- [[docs/PRODUCTION_READINESS_REPORT]] — P1/P2 audit trail, infrastructure, test results
- [[docs/ROADMAP_PRODUCTION]] — launch checklist (Phases 1–11, all ticked) + hard constraints
- [[docs/EXTERNAL_REVIEW_BRIEF]] — CPA + security audit brief (what to verify, evidence index)
- [[docs/EDGAR_SKIP_GAP_REPORT]] — US eval skip root causes + ranked fixes
- [[docs/PUBLIC_DATA_VALIDATION]] — benchmark methodology (honesty contract)
- [[docs/AI_EVAL]] — eval modes + multi-agent harness contract
- [[docs/STATE_RULE_REFRESH]] — agentic US state rule-refresh loop: source → capture → extract → verify → diff → human approve → atomic apply → CI gate (live-source verified 51/51 rates + 51/51 apportionment weights vs Tax Foundation 2026)

## CI/CD & Security (2026-08-03)
- `.github/workflows/` — 4 workflows on every push/PR to `master`: CI (security scan, fresh-Postgres lint+test, Docker+Trivy), CodeQL, Semgrep (p/security-audit), OSV dependency gate; Dependabot enabled

## Enterprise Package (isolated, UNVALIDATED for real ERP data)
- [[packages/tax-engine-enterprise/README]] — group relief / US state tax rule engine / GL-ELT exploratory package
- [[packages/tax-engine-enterprise/ASSUMPTIONS]] — every assumption catalogued (89 tests; the API rule-update agent imports its proposal contract `us/proposals.ts`; computation engine not wired into any app)
- US state rules verified against dated Tax Foundation 2026 snapshots via `npm run verify:us-rates` (51/51 rates + 51/51 apportionment weights exact)

## Agent System
- [[apps/api/src/agent/instructions]] — Eve agent runtime instructions
- [[apps/api/src/agent/skills/asc-740-guidance]] — ASC 740 technical guidance for AI agents
- [[apps/api/src/agent/skills/sec-174-rd]] — Section 174 R&D capitalization guidance
