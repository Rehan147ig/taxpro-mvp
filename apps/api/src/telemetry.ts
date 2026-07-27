import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';

// Superlog OTLP intake + public ingest token (project-scoped, write-only —
// safe in source like a PostHog token or Sentry DSN).
const SUPERLOG_ENDPOINT = 'https://intake.superlog.sh';
const SUPERLOG_PUBLIC_TOKEN = 'sl_public_yoczlfTB0ch_ZE1FvXLxMeuHKJQdrXnAopQKUb14L64';

function superlogHeaders(token: string): Record<string, string> {
  return { 'x-api-key': token };
}

const headers = superlogHeaders(SUPERLOG_PUBLIC_TOKEN);

const repoUrl = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
  ? `https://github.com/${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
  : process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : undefined;

const revision = process.env.VERCEL_GIT_COMMIT_SHA
  ?? process.env.RAILWAY_GIT_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? process.env.SOURCE_COMMIT
  ?? process.env.GIT_COMMIT
  ?? process.env.HEROKU_SLUG_COMMIT;

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': 'taxpro-api',
    'service.version': '0.1.0',
    'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    ...(repoUrl ? { 'vcs.repository.url.full': repoUrl } : {}),
    ...(revision ? { 'vcs.ref.head.revision': revision } : {}),
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${SUPERLOG_ENDPOINT}/v1/traces`,
    headers,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${SUPERLOG_ENDPOINT}/v1/metrics`,
      headers,
    }),
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: `${SUPERLOG_ENDPOINT}/v1/logs`,
        headers,
      }),
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations(),
    new PinoInstrumentation(),
  ],
});

declare global {
  // eslint-disable-next-line no-var
  var __taxproTelemetryStarted: boolean | undefined;
}

if (!globalThis.__taxproTelemetryStarted) {
  sdk.start();
  globalThis.__taxproTelemetryStarted = true;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!globalThis.__taxproTelemetryStarted) return;
  globalThis.__taxproTelemetryStarted = false;
  await sdk.shutdown();
}
