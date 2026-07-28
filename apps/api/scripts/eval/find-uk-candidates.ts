import '../../src/config/env.js';
import { searchCompany, getAccountsFilings, getDocumentUrl } from './companies-house-client.js';

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: npx tsx scripts/eval/find-uk-candidates.ts "<company name>"');
    process.exit(1);
  }

  console.log(`Searching for: "${name}"\n`);
  const results = await searchCompany(name);

  if (results.length === 0) {
    console.log('No companies found.');
    return;
  }

  console.log('Matches:');
  for (const r of results) {
    const status = r.company_status === 'active' ? '' : ` (${r.company_status})`;
    console.log(`  ${r.company_number.padEnd(10)} ${r.title}${status}  [${r.company_type}]`);
  }
  console.log();

  const top = results[0];
  console.log(`Filing history for: ${top.title} (${top.company_number})\n`);

  const filings = await getAccountsFilings(top.company_number);

  if (filings.length === 0) {
    console.log('No accounts filings found.');
    return;
  }

  for (const f of filings) {
    const flag = f.mayLackTaxNote ? ' ⚠ may lack a tax note' : '';
    console.log(`  ${f.date}  ${f.description.slice(0, 80)}${flag}`);

    if (f.documentMetadataUrl) {
      const doc = await getDocumentUrl(f.documentMetadataUrl);
      if (doc.pdfUrl) console.log(`         PDF: ${doc.pdfUrl}`);
      if (doc.ixbrlUrl) console.log(`         iXBRL: ${doc.ixbrlUrl}`);
    }
    console.log();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
