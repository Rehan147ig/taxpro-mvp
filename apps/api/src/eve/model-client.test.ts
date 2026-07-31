import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';

const { __setEnv, env: __env } = vi.hoisted(() => {
  const vals: Record<string, string | undefined> = {};
  return {
    __setEnv(k: string, v: string | undefined) {
      if (v === undefined) delete vals[k];
      else vals[k] = v;
    },
    env: new Proxy(vals, {
      get(_, prop) {
        if (typeof prop !== 'string') return undefined;
        return prop in vals ? vals[prop] : undefined;
      },
    }),
  };
});

vi.mock('../config/env.js', () => ({ env: __env }));

import { resetAiConfig } from '../config/ai.js';
import { callJsonModel, configureEveClient, ModelRequestError, InvalidOutputError } from './model-client.js';
import { z } from 'zod';

const schema = z.object({
  ok: z.boolean(),
  value: z.number(),
  label: z.string(),
});

function startMock(handler: (req: any, res: any) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function jsonOk(content: string): Promise<Server> {
  return startMock((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }).then(({ server }) => server);
}

function baseUrl(port: number) {
  return `http://127.0.0.1:${port}/v1`;
}

beforeEach(() => {
  resetAiConfig();
  configureEveClient({ retryDelaysMs: [5, 5], timeoutMs: 2000 });
  __setEnv('AI_BASE_URL', undefined);
  __setEnv('AI_API_KEY', 'sk-test');
  __setEnv('AI_MODEL', 'test-model');
});

afterEach(async () => {
  configureEveClient({});
  resetAiConfig();
});

describe('callJsonModel — direct OpenAI-compatible client', () => {
  it('returns parsed, raw, provider and model on success', async () => {
    const server = await jsonOk(JSON.stringify({ ok: true, value: 42, label: 'hello' }));
    const port = (server.address() as { port: number }).port;
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      const res = await callJsonModel({
        schema,
        system: 'sys',
        user: 'u',
        promptVersion: 'test-v1',
      });
      expect(res.parsed).toEqual({ ok: true, value: 42, label: 'hello' });
      expect(res.provider).toBe('openai');
      expect(res.model).toBe('test-model');
      expect(res.raw).toContain('"ok"');
    } finally {
      server.close();
    }
  });

  it('fails with InvalidOutputError on malformed JSON', async () => {
    const server = await jsonOk('not-json-{');
    const port = (server.address() as { port: number }).port;
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      await expect(callJsonModel({ schema, system: 's', user: 'u', promptVersion: 'v' }))
        .rejects.toBeInstanceOf(InvalidOutputError);
    } finally {
      server.close();
    }
  });

  it('fails with InvalidOutputError when JSON does not match the zod schema', async () => {
    const server = await jsonOk(JSON.stringify({ ok: 'not-a-bool', value: 'x', label: 1 }));
    const port = (server.address() as { port: number }).port;
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      await expect(callJsonModel({ schema, system: 's', user: 'u', promptVersion: 'v' }))
        .rejects.toBeInstanceOf(InvalidOutputError);
    } finally {
      server.close();
    }
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const { server, port } = await startMock((_req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end('{"error":"rate limited"}');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true, value: 7, label: 'retried' }) } }] }));
      }
    });
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      const res = await callJsonModel({ schema, system: 's', user: 'u', promptVersion: 'v' });
      expect(calls).toBe(2);
      expect(res.parsed.value).toBe(7);
    } finally {
      server.close();
    }
  });

  it('raises ModelRequestError after retries are exhausted on 5xx', async () => {
    let calls = 0;
    const { server, port } = await startMock((_req, res) => {
      calls++;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"boom"}');
    });
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      await expect(callJsonModel({ schema, system: 's', user: 'u', promptVersion: 'v' }))
        .rejects.toMatchObject({ name: 'ModelRequestError', status: 500 });
      expect(calls).toBe(3); // initial + 2 retries
    } finally {
      server.close();
    }
  });

  it('times out when the provider is slow', async () => {
    configureEveClient({ retryDelaysMs: [1, 1], timeoutMs: 150, maxRetries: 1 });
    const { server, port } = await startMock((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      }, 500);
    });
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      await expect(callJsonModel({ schema, system: 's', user: 'u', promptVersion: 'v' }))
        .rejects.toBeInstanceOf(ModelRequestError);
    } finally {
      server.close();
    }
  });

  it('rejects non-retryable 400 immediately without retrying', async () => {
    let calls = 0;
    const { server, port } = await startMock((_req, res) => {
      calls++;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"bad request"}');
    });
    try {
      __setEnv('AI_BASE_URL', baseUrl(port));
      await expect(callJsonModel({ schema, system: 's', user: 'u', promptVersion: 'v' }))
        .rejects.toMatchObject({ name: 'ModelRequestError', status: 400 });
      expect(calls).toBe(1);
    } finally {
      server.close();
    }
  });
});
