import { z } from 'zod';
import { callJsonModel } from '../../eve/model-client.js';
import { Jurisdiction } from '@taxpro/tax-engine';

const AUDIT_FLAG_SCHEMA = z.object({
  flags: z.array(z.object({
    severity: z.enum(['critical', 'warning', 'info']),
    category: z.enum(['variance', 'compliance', 'disclosure', 'consistency']),
    description: z.string(),
    detail: z.string(),
    recommendation: z.string(),
    etrDeltaBp: z.number().optional(),
  })),
});

export interface AuditFlag {
  severity: 'critical' | 'warning' | 'info';
  category: 'variance' | 'compliance' | 'disclosure' | 'consistency';
  description: string;
  detail: string;
  recommendation: string;
  etrDeltaBp?: number;
}

export interface AuditInput {
  bookIncome: string;
  disclosedETR: string;
  computedETR: string;
  deferredTaxLines: Array<Record<string, unknown>>;
  permanentDifferences: Array<Record<string, unknown>>;
  jurisdiction: Jurisdiction;
}

export async function auditProvision(input: AuditInput): Promise<AuditFlag[]> {
  const complianceRules = input.jurisdiction === Jurisdiction.UK_FRS102_S29
    ? `FRS 102 Section 29 compliance checks:
- Deferred tax assets must not be discounted
- Deferred tax assets must be recognised only when recovery is probable
- Deferred tax assets shown as debtors, liabilities as provisions
- Uncertain tax treatment: most-likely amount or expected value approach
- VAT-excluded turnover for relevant calculations
- Business combination: adjust goodwill for deferred tax on acquired assets`
    : `ASC 740 compliance checks:
- Deferred tax assets require valuation allowance assessment
- ETR reconciliation must explain difference from statutory rate 21%
- Temporary differences reverse in predictable patterns
- Tax positions require more-likely-than-not threshold`;

  const system = `You are a tax provision audit agent. Review the provision calculation for:
1. Variance analysis: flag ETR differences > 2% from benchmark
2. Jurisdiction compliance: check against the specific GAAP/tax rules
3. Disclosure completeness: verify all required sections are present
4. Consistency: check for internal consistency across sections

${complianceRules}

Flags have severity: critical (must fix), warning (investigate), info (note).`;

  const result = await callJsonModel({
    system,
    user: `Audit this ${input.jurisdiction} tax provision:

Book Income: ${input.bookIncome}
Disclosed ETR: ${input.disclosedETR}
Computed ETR: ${input.computedETR}
Deferred Tax Lines: ${JSON.stringify(input.deferredTaxLines)}
Permanent Differences: ${JSON.stringify(input.permanentDifferences)}`,
    temperature: 0.0,
    maxTokens: 4096,
    promptVersion: 'audit-v1',
    schema: AUDIT_FLAG_SCHEMA,
  });

  return result.parsed.flags;
}
