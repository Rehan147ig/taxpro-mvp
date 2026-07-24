#!/bin/bash
# Initialize the taxpro database
# This runs automatically on first container start

set -e

echo "[Init] Database setup complete for ${POSTGRES_DB}"
