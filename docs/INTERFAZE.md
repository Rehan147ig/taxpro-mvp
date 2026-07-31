# Interfaze PDF Ingestion

## Overview

TaxPro supports multimodal PDF/Excel/CSV upload for trial balance extraction via Interfaze's OpenAI-compatible vision API.

## How It Works

1. Upload a PDF, Excel or CSV file to `POST /api/upload/trial-balance`
2. If `AI_PROVIDER=interfaze` and `INTERFAZE_API_KEY` is set, the file is sent as a base64 data URI to Interfaze's `POST /v1/chat/completions` endpoint (`interfaze-beta` model) with an extraction prompt
3. The model returns trial balance rows as a strict JSON array (`choices[0].message.content`), with raw OCR text available under `precontext[0].result.extracted_text`
4. Rows are normalized and persisted to `entities`, `accounts` and `trial_balance` tables

## Configuration

```bash
# .env
AI_PROVIDER=interfaze
INTERFAZE_API_KEY=ifz_xxxxxxxxxxxx
INTERFAZE_ENDPOINT=https://api.interfaze.ai/v1
INTERFAZE_MODEL=interfaze-beta   # optional, defaults to interfaze-beta
```

## Supported File Types

- `.pdf` — PDF documents (scanned or digital; passed through to the vision model)
- `.xlsx` / `.xls` — Excel spreadsheets
- `.csv` — CSV trial balance files

Maximum upload size: 25MB.

## Fallback

If Interfaze is not configured, the endpoint returns a helpful error directing users to the CSV import endpoint (`POST /api/import/trial-balance`) for text-based trial balance ingestion.

## Example

```bash
curl -X POST https://taxpro.up.railway.app/api/upload/trial-balance \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@trial_balance_dec2025.pdf"
```

Response:

```json
{
  "source": "interfaze-multimodal",
  "fileName": "trial_balance_dec2025.pdf",
  "importedRows": 42,
  "accounts": 42,
  "entityId": "…",
  "nextStep": "Run AI mapping, then \"Provision\" to calculate tax."
}
```

If no rows are detected, the raw OCR text is returned under `parsed.ocrText` for debugging.
