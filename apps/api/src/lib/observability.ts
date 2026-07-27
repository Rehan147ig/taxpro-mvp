import { trace, metrics } from '@opentelemetry/api';

export const tracer = trace.getTracer('taxpro-api');

const meter = metrics.getMeter('taxpro-api');

export const provisionRunCounter = meter.createCounter('provision.runs', {
  description: 'Provision runs by outcome',
});

export const agentRunCounter = meter.createCounter('agent.runs', {
  description: 'AI subagent runs by workflow and outcome',
});

export const reviewResolutionCounter = meter.createCounter('review.resolutions', {
  description: 'Review item resolutions by resolution type',
});

export const packageExportCounter = meter.createCounter('package.exports', {
  description: 'Workpaper package exports by outcome',
});
