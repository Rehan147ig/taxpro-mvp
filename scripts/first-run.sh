#!/bin/bash
# ── TaxPro First-Run Setup Script ──
# Usage: bash scripts/first-run.sh
# Sets up the project for local development

set -e

echo "========================================"
echo "  TaxPro - First-Run Setup"
echo "========================================"
echo ""

# 1. Copy .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[Setup] Created .env from .env.example"
  echo "[Setup] !! Edit .env with your production values before deploying !!"
else
  echo "[Setup] .env already exists"
fi

# 2. Install dependencies
echo "[Setup] Installing dependencies..."
npm install --include=dev

# 3. Generate drizzle migrations
echo "[Setup] Generating database migrations..."
npm run db:generate 2>/dev/null || echo "[Setup] No new migrations to generate"

echo ""
echo "========================================"
echo "  Setup complete! Next steps:"
echo "========================================"
echo ""
echo "  1. Start infrastructure:"
echo "     docker compose up -d"
echo ""
echo "  2. Run migrations:"
echo "     npm run db:migrate"
echo ""
echo "  3. (Optional) Seed demo data:"
echo "     npm run db:seed"
echo ""
echo "  4. Start development servers:"
echo "     npm run dev"
echo ""
echo "  5. Open http://localhost:5173"
echo "     Login: demo@taxpro.ai / TaxProDemo123!"
echo ""
echo "========================================"
