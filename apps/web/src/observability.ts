import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace, metrics } from '@opentelemetry/api';

const SUPERLOG_ENDPOINT = 'https://intake.superlog.sh';
const SUPERLOG_PUBLIC_TOKEN = 'sl_public_yoczlfTB0ch_ZE1FvXLxMeuHKJQdrXnAopQKUb14L64';

function superlogHeaders(token: string): Record<string, string> {
  return { 'x-api-key': token };
}

const isLocal =
  typeof window !== 'undefined' && window.location.hostname === 'localhost';

const resource = resourceFromAttributes({
  'service.name': 'taxpro-web',
  'service.version': '0.1.0',
  'deployment.environment.name': isLocal ? 'local' : 'production',
});

const headers = superlogHeaders(SUPERLOG_PUBLIC_TOKEN);

// ── Traces ──
const traceProvider = new WebTracerProvider({ resource });
// The Web SDK types omit addSpanProcessor in some versions; use any cast
(traceProvider as any).addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: `${SUPERLOG_ENDPOINT}/v1/traces`,
      headers,
    }),
  ),
);
traceProvider.register({ contextManager: new ZoneContextManager() });

// ── Metrics ──
const meterProvider = new MeterProvider({ resource });
// The SDK types omit addMetricReader in some versions; use any cast
(meterProvider as any).addMetricReader(
  new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${SUPERLOG_ENDPOINT}/v1/metrics`,
      headers,
    }),
    exportIntervalMillis: 30_000,
  }),
);
metrics.setGlobalMeterProvider(meterProvider);

// ── Logs ──
const logExporter = new OTLPLogExporter({
  url: `${SUPERLOG_ENDPOINT}/v1/logs`,
  headers,
});
const loggerProvider = new LoggerProvider({ resource });
// The SDK types omit addLogRecordProcessor in some versions; use any cast
(loggerProvider as any).addLogRecordProcessor(
  new (BatchLogRecordProcessor as any)(logExporter),
);

// ── Auto-instrumentation ──
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation(),
    new DocumentLoadInstrumentation(),
  ],
});

// ── Module-scope tracer, meter, and counters ──
export const webTracer = trace.getTracer('taxpro-web');
const meter = metrics.getMeter('taxpro-web');

export const pageViewCounter = meter.createCounter('page.views', {
  description: 'Page views by route',
});

export const webProvisionRunCounter = meter.createCounter('provision.runs', {
  description: 'Provision runs initiated from the web UI',
});
