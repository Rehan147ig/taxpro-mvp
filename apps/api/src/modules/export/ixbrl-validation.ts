/**
 * iXBRL structural conformance validation.
 *
 * Checks a generated XBRL/iXBRL document against structural rules the
 * Companies House / HMRC filing stack expects:
 *  - correct root element and namespace declarations (XBRL instance or
 *    inline XBRL per http://www.xbrl.org/2008/inlineXBRL),
 *  - the schemaRef locks the UK GAAP FRS 102 2023-01-01 taxonomy version,
 *  - every fact carries contextRef/unitRef/decimals and resolves to a
 *    defined context and unit in the same document,
 *  - context periods are ISO dates consistent with the document metadata,
 *  - numeric fact values are finite with 2 decimal places.
 *
 * Honesty: this is a structural/well-formedness conformance check, not a
 * schema (XSD) validation against the taxonomy itself, and not a Companies
 * House filing validation — those remain with the CH iXBRL validation
 * service at filing time.
 */

export interface IxbrlValidationResult {
  valid: boolean;
  checksRun: number;
  violations: string[];
}

export interface IxbrlValidationInput {
  format: 'instance' | 'inline';
  periodStart: string;
  periodEnd: string;
  facts: Array<{ tag: string; value: number; context: string; unit: string }>;
  content: string;
  schemaRef: string;
}

export const FRS102_SCHEMA_LOCK = 'ukgaap-frs102-2023-01-01.xsd';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (s: string): boolean => ISO_RE.test(s) && !Number.isNaN(Date.parse(s));

export function validateIxbrlDocument(doc: IxbrlValidationInput): IxbrlValidationResult {
  const violations: string[] = [];
  const checksRun: string[] = [];
  const c = doc.content;
  const ok = (id: string, cond: boolean, message: string) => {
    checksRun.push(id);
    if (!cond) violations.push(message);
  };

  if (doc.format === 'instance') {
    ok('root', /^<\?xml/.test(c), 'instance document must start with an XML declaration');
    ok('root', c.includes('<xbrl xmlns="http://www.xbrl.org/2003/instance"'), 'instance root <xbrl> with the XBRL 2003 instance namespace is missing');
    ok('root', c.includes('xmlns:ukgaap="http://www.hmrc.gov.uk/ukgaap/frs102/taxonomy"'), 'ukgaap namespace declaration missing');
    ok('root', c.includes('xmlns:iso4217='), 'iso4217 namespace declaration missing');
  } else {
    ok('root', c.includes('<html'), 'inline document must have an <html> root');
    ok('root', c.includes('xmlns:ix="http://www.xbrl.org/2008/inlineXBRL"'), 'iXBRL ix namespace declaration missing');
    ok('root', c.includes('xmlns:ukgaap="http://www.hmrc.gov.uk/ukgaap/frs102/taxonomy"'), 'ukgaap namespace declaration missing');
    ok('root', c.includes('<ix:header>'), 'ix:header block missing');
  }

  ok('schemaRef', doc.schemaRef.includes(FRS102_SCHEMA_LOCK), `schemaRef must lock the ${FRS102_SCHEMA_LOCK} taxonomy version`);
  if (doc.format === 'instance') {
    ok('schemaRef', c.includes(`schemaRef="${doc.schemaRef}"`), 'instance content must declare the schemaRef matching the document metadata');
  }

  const contextIds = new Set(
    doc.format === 'instance'
      ? [...c.matchAll(/<context id="([^"]+)">/g)].map(m => m[1])
      : [...c.matchAll(/<ix:context id="([^"]+)">/g)].map(m => m[1]),
  );
  const unitIds = new Set(
    doc.format === 'instance'
      ? [...c.matchAll(/<unit id="([^"]+)">/g)].map(m => m[1])
      : [...c.matchAll(/<ix:unit id="([^"]+)">/g)].map(m => m[1]),
  );

  ok('contexts', contextIds.size > 0, 'no contexts defined');
  ok('contexts', contextIds.size === (doc.format === 'instance'
    ? [...c.matchAll(/<context id="/g)].length
    : [...c.matchAll(/<ix:context id="/g)].length), 'context ids must be unique');
  ok('units', unitIds.size > 0, 'no units defined');
  ok('units', unitIds.size === (doc.format === 'instance'
    ? [...c.matchAll(/<unit id="/g)].length
    : [...c.matchAll(/<ix:unit id="/g)].length), 'unit ids must be unique');

  const factOpenTags = doc.format === 'instance'
    ? [...c.matchAll(/<ukgaap:[A-Za-z]+\s[^>]*>/g)].map(m => m[0])
    : [...c.matchAll(/<ix:nonFraction\s[^>]*>/g)].map(m => m[0]);

  ok('facts', factOpenTags.length > 0, 'no tagged facts found in the document');
  for (const tag of factOpenTags) {
    const contextRef = /contextRef="([^"]+)"/.exec(tag)?.[1];
    const unitRef = /unitRef="([^"]+)"/.exec(tag)?.[1];
    const decimals = /decimals="([^"]+)"/.exec(tag)?.[1];
    if (!contextRef || !contextIds.has(contextRef)) {
      violations.push(`fact ${tag.slice(0, 80)} references undefined context '${contextRef}'`);
    }
    if (!unitRef || !unitIds.has(unitRef)) {
      violations.push(`fact ${tag.slice(0, 80)} references undefined unit '${unitRef}'`);
    }
    if (decimals !== '2') {
      violations.push(`fact ${tag.slice(0, 80)} must declare decimals="2"`);
    }
  }

  const values = doc.format === 'instance'
    ? [...c.matchAll(/<ukgaap:[A-Za-z]+[^>]*>([^<]+)<\/ukgaap:/g)].map(m => m[1])
    : [...c.matchAll(/<ix:nonFraction[^>]*>([^<]+)<\/ix:nonFraction>/g)].map(m => m[1]);
  for (const v of values) {
    if (!/^-?\d+\.\d{2}$/.test(v.trim())) {
      violations.push(`numeric fact value '${v.trim()}' must be a finite number with 2 decimal places`);
    }
  }

  ok('dates', isIso(doc.periodStart) && isIso(doc.periodEnd), `document period must be ISO dates (YYYY-MM-DD): ${doc.periodStart} to ${doc.periodEnd}`);
  if (doc.format === 'instance') {
    const m = /<startDate>([^<]+)<\/startDate><endDate>([^<]+)<\/endDate>/.exec(c);
    ok('dates', !!m && m[1] === doc.periodStart && m[2] === doc.periodEnd,
      `context period (${m ? `${m[1]} to ${m[2]}` : 'none'}) must match the document period (${doc.periodStart} to ${doc.periodEnd})`);
  } else {
    const m = /<ix:start>([^<]+)<\/ix:start><ix:end>([^<]+)<\/ix:end>/.exec(c);
    ok('dates', !!m && m[1] === doc.periodStart && m[2] === doc.periodEnd,
      `context period (${m ? `${m[1]} to ${m[2]}` : 'none'}) must match the document period (${doc.periodStart} to ${doc.periodEnd})`);
  }

  ok('entity', doc.format === 'instance'
    ? c.includes('<identifier scheme="http://www.companieshouse.gov.uk/">')
    : c.includes('<ix:identifier scheme="http://www.companieshouse.gov.uk/">'),
    'company identifier with the Companies House scheme missing');

  return { valid: violations.length === 0, checksRun: checksRun.length, violations };
}
