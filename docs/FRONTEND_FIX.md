# Frontend Fix — Hash Routing to TanStack Router Migration

## Before

The frontend used manual hash-based routing:

```typescript
// Before: App.tsx — hash routing
const route = window.location.hash.slice(1) || '/';
window.addEventListener('hashchange', handler);
navigate(path) { window.location.hash = path; }
```

All URLs were `/#/provision`, `/#/review`, etc.

## After

File-based routing with TanStack Router:

```
apps/web/src/routes/
├── __root.tsx      — Layout: sidebar nav + <Outlet /> + ErrorBoundary
├── index.tsx        — Dashboard (with auth guard — redirects to LoginPage)
├── connections.tsx  — ConnectionsPage
├── mapping.tsx      — MappingPage
├── provision.tsx    — ProvisionPage
└── review.tsx       — ReviewDashboard
```

Each route exports a `pendingComponent` (skeleton loader) and the root exports an `errorComponent`.

Routes are clean URLs: `/`, `/connections`, `/mapping`, `/provision`, `/review`.

## Verification

```bash
# Zero hash routing remnants
grep -r "location.hash" apps/web/src/
# (no results)
```

## Demo Mode

The Dashboard now has a "Load Demo Data (Greggs plc)" button that:

1. Calls `POST /api/demo/seed` (new endpoint)
2. Creates a demo entity with 14 synthetic accounts
3. Pre-populates tax mappings (mixes of no_diff, temporary, permanent)
4. Shows result: PBT summary and next-step guidance

Expected result: `PBT: $480,000` with deferred DTL from depreciation temporary differences.
