import { describe, expect, it } from 'vitest';
import { buildCtOnlineSubmission, ctoFromCt600, GOVTALK_NS, CT_NS, CT_SCHEMA_VERSION } from './cto-xml.js';

const INPUT = {
  utr: '8596148860',
  companyName: 'Acme Trading Ltd',
  registrationNumber: '12345678',
  periodStart: '2021-04-01',
  periodEnd: '2022-03-31',
  companyType: '6',
  turnover: 100000,
  chargeableProfits: 100000,
  taxAtMainRate: 0,
  taxAtSmallProfitsRate: 19000,
  marginalRelief: 0,
  taxPayable: 19000,
};

function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const tagRe = /<\/?([\w:.-]+)(?:\s[^>]*)?\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const full = m[0];
    const name = m[1];
    if (full.endsWith('/>')) continue;
    if (full.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) throw new Error(`Mismatched close tag </${name}> (expected </${open}>)`);
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) throw new Error(`Unclosed tags: ${stack.join(', ')}`);
}

describe('buildCtOnlineSubmission', () => {
  it('mirrors the official GovTalk envelope structure', () => {
    const s = buildCtOnlineSubmission(INPUT);
    assertWellFormed(s.xml);
    expect(s.xml).toContain(`<GovTalkMessage xmlns="${GOVTALK_NS}"`);
    expect(s.xml).toContain('<EnvelopeVersion>2.0</EnvelopeVersion>');
    expect(s.xml).toContain('<Class>HMRC-CT-CT600</Class>');
    expect(s.xml).toContain('<Qualifier>request</Qualifier>');
    expect(s.xml).toContain('<Function>submit</Function>');
    expect(s.xml).toContain('<Transformation>XML</Transformation>');
    expect(s.xml).toContain('<GatewayTest>1</GatewayTest>');
    expect(s.xml).toContain(`<Key Type="UTR">8596148860</Key>`);
    expect(s.xml).toContain(`<IRenvelope xmlns="${CT_NS}">`);
    expect(s.xml).toContain(`<SchemaVersion>${CT_SCHEMA_VERSION}</SchemaVersion>`);
    expect(s.xml).toContain('<TopElementName>CompanyTaxReturn</TopElementName>');
    expect(s.xml).toContain('<CompanyTaxReturn ReturnType="new">');
    expect(s.xml).toContain('<PeriodCovered>\n\t\t\t\t\t\t<From>2021-04-01</From>\n\t\t\t\t\t\t<To>2022-03-31</To>');
  });

  it('prices the small profits band at 19%', () => {
    const s = buildCtOnlineSubmission(INPUT);
    expect(s.xml).toContain('<TaxRate>19.00</TaxRate>');
    expect(s.xml).toContain('<Tax>19000.00</Tax>');
    expect(s.xml).toContain('<CorporationTax>19000.00</CorporationTax>');
    expect(s.xml).toContain('<NetCorporationTaxLiability>19000.00</NetCorporationTaxLiability>');
  });

  it('emits marginal relief alongside the main-rate charge', () => {
    const s = buildCtOnlineSubmission({
      ...INPUT,
      chargeableProfits: 125000,
      taxAtMainRate: 31250,
      taxAtSmallProfitsRate: 0,
      marginalRelief: 1875,
      taxPayable: 29375,
    });
    assertWellFormed(s.xml);
    expect(s.xml).toContain('<TaxRate>25.00</TaxRate>');
    expect(s.xml).toContain('<Tax>31250.00</Tax>');
    expect(s.xml).toContain('<MarginalRelief>1875.00</MarginalRelief>');
    expect(s.xml).toContain('<CorporationTax>29375.00</CorporationTax>');
    expect(s.xml).toContain('<TaxPayable>29375.00</TaxPayable>');
  });

  it('omits marginal relief element when zero and stays small-profits', () => {
    const s = buildCtOnlineSubmission(INPUT);
    expect(s.xml).not.toContain('<MarginalRelief>');
  });

  it('flags test vs production via GatewayTest', () => {
    const prod = buildCtOnlineSubmission({ ...INPUT, gatewayTest: false });
    expect(prod.xml).toContain('<GatewayTest>0</GatewayTest>');
  });

  it('escapes XML-sensitive company details', () => {
    const s = buildCtOnlineSubmission({ ...INPUT, companyName: 'A&B <Co>' });
    expect(s.xml).not.toContain('<Co>');
    expect(s.xml).toContain('A&amp;B &lt;Co&gt;');
  });

  it('declares the return as in-progress until the accountant accepts', () => {
    const s = buildCtOnlineSubmission(INPUT);
    expect(s.xml).toContain('<AcceptDeclaration>no</AcceptDeclaration>');
    expect(s.xml).toContain('<Status>In progress</Status>');
  });

  it('validates the UTR and figures', () => {
    expect(() => buildCtOnlineSubmission({ ...INPUT, utr: '123' })).toThrow(/10 digits/);
    expect(() => buildCtOnlineSubmission({ ...INPUT, marginalRelief: -1 })).toThrow(/negative/);
  });
});

describe('ctoFromCt600', () => {
  it('maps a CT600 return into the CTO submission', () => {
    const ct600 = {
      company: { companyName: 'Acme', utr: '8596148860', companiesHouseNumber: '12345678' },
      period: { start: '2021-04-01', end: '2022-03-31' },
      computed: { totalTaxCharge: 19000, taxPayable: 19000 },
      boxes: [
        { box: 5, name: 'Profits', value: 100000 },
        { box: 10, name: 'Taxable', value: 100000 },
        { box: 12, name: 'Main rate', value: 0 },
        { box: 13, name: 'Small profits', value: 19000 },
        { box: 14, name: 'Marginal relief', value: 0 },
      ],
    };
    const s = ctoFromCt600(ct600 as any);
    assertWellFormed(s.xml);
    expect(s.filename).toBe('taxpro-ct600-2022-03-31.xml');
    expect(s.contentType).toBe('text/xml');
  });
});
