import { IRC_MAPPING_SYSTEM_PROMPT as v1_mapping_irc, TYPE_CLASSIFICATION_PROMPT as v1_mapping_type } from './v1/mapping-agent.js';

export const PROMPTS = {
  'mapping-agent-stage1-v1': async () => v1_mapping_type,
  'mapping-agent-stage2-v1': async () => v1_mapping_irc,
  'mapping-agent-stage2-v2': async () => v1_mapping_irc,
  'parser-agent-v1': async () => 'TaxPro Parser Agent v1 — extracts structured trial balance from raw text.',
  'audit-defense-v1': async () => 'TaxPro Audit Defense Agent v1 — drafts ASC 740 audit workpapers.',
  'credit-miner-v1': async () => 'TaxPro Credit Miner Agent v1 — identifies R&D and energy tax credits.',
} as const;

export type PromptVersion = keyof typeof PROMPTS;
export const DEFAULT_PROMPT_VERSION: PromptVersion = 'mapping-agent-stage1-v1';

export async function resolvePrompt(version: PromptVersion): Promise<string> {
  const loader = PROMPTS[version];
  if (!loader) throw new Error(`Unknown prompt version: ${version}`);
  return loader();
}
