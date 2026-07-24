import Excel from 'exceljs';

interface ProvisionExportData {
  period: string;
  bookIncome: number;
  currentTaxExpense: number;
  deferredTaxExpense: number;
  totalTaxExpense: number;
  effectiveTaxRate: number;
  statutoryRate: number;
  taxPayable: number;
  valuationAllowance: number;
  createdAt: string;
}

export async function generateProvisionWorkbook(data: ProvisionExportData): Promise<Buffer> {
  const wb = new Excel.Workbook();
  wb.creator = 'TaxPro';
  wb.created = new Date();

  addSummaryTab(wb, data);
  addCurrentTaxTab(wb, data);
  addDeferredTaxTab(wb, data);
  addETRTab(wb, data);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function addSummaryTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  // Style the header
  const header = ws.getRow(1);
  header.font = { bold: true, size: 12 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const rows: { metric: string; value: string | number }[] = [
    { metric: 'Period', value: data.period },
    { metric: 'Status', value: 'draft' },
    { metric: 'Book Income', value: data.bookIncome },
    { metric: 'Current Tax Expense', value: data.currentTaxExpense },
    { metric: 'Deferred Tax Expense', value: data.deferredTaxExpense },
    { metric: 'Total Tax Expense', value: data.totalTaxExpense },
    { metric: 'Effective Tax Rate', value: `${(data.effectiveTaxRate * 100).toFixed(2)}%` },
    { metric: 'Statutory Rate', value: `${(data.statutoryRate * 100).toFixed(2)}%` },
    { metric: 'Tax Payable', value: data.taxPayable },
    { metric: 'Valuation Allowance', value: data.valuationAllowance },
    { metric: 'Created At', value: data.createdAt },
  ];

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = r.metric;
    row.getCell(2).value = r.value;
    // Style number fields
    if (typeof r.value === 'number') {
      row.getCell(2).numFmt = '#,##0.00';
    }
    // Bold the total row
    if (r.metric === 'Total Tax Expense') {
      row.getCell(1).font = { bold: true };
      row.getCell(2).font = { bold: true };
    }
  });
}

function addCurrentTaxTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const ws = wb.addWorksheet('Current Tax', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Component', key: 'component', width: 35 },
    { header: 'Amount', key: 'amount', width: 20 },
    { header: 'Rate', key: 'rate', width: 15 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };

  // Compute derived amounts
  const taxableIncome = data.bookIncome; // simplified — in real flow permanent adjustments would be subtracted
  const federalTax = taxableIncome * data.statutoryRate;
  const stateTax = 0; // not stored per-run, default to 0

  const rows: { component: string; amount: string | number; rate: string }[] = [
    { component: 'Book Income (Pretax)', amount: data.bookIncome, rate: '' },
    { component: 'Permanent Differences', amount: 0, rate: '' },
    { component: 'Taxable Income', amount: taxableIncome, rate: `${(data.statutoryRate * 100).toFixed(1)}%` },
    { component: '', amount: '', rate: '' },
    { component: 'Federal Tax', amount: federalTax, rate: `${(data.statutoryRate * 100).toFixed(1)}%` },
    { component: 'State Tax (net of fed benefit)', amount: stateTax, rate: '' },
    { component: 'Tax Credits', amount: 0, rate: '' },
    { component: 'NOL Utilization', amount: 0, rate: '' },
    { component: '', amount: '', rate: '' },
    { component: 'Total Current Tax Expense', amount: data.currentTaxExpense, rate: '' },
    { component: 'Less: Estimated Payments', amount: 0, rate: '' },
    { component: '', amount: '', rate: '' },
    { component: 'Tax Payable (Receivable)', amount: data.taxPayable, rate: '' },
  ];

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = r.component;
    if (typeof r.amount === 'number') {
      row.getCell(2).value = r.amount;
      row.getCell(2).numFmt = '#,##0.00';
    } else {
      row.getCell(2).value = '';
    }
    row.getCell(3).value = r.rate;

    if (r.component.startsWith('Total') || r.component.startsWith('Tax Payable')) {
      row.getCell(1).font = { bold: true };
      row.getCell(2).font = { bold: true };
    }
  });
}

function addDeferredTaxTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const ws = wb.addWorksheet('Deferred Tax', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Category', key: 'category', width: 35 },
    { header: 'Opening Balance', key: 'opening', width: 20 },
    { header: 'Current Year Change', key: 'change', width: 20 },
    { header: 'Closing Balance', key: 'closing', width: 20 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };

  // With no prior-year breakdown stored, show aggregate DTA/DTL
  const openingDTA = 0;
  const closingDTA = data.deferredTaxExpense > 0 ? 0 : Math.abs(data.deferredTaxExpense);
  const openingDTL = 0;
  const closingDTL = data.deferredTaxExpense > 0 ? data.deferredTaxExpense : 0;

  const rows = [
    { category: 'Deferred Tax Assets (DTA)', opening: openingDTA, change: closingDTA - openingDTA, closing: closingDTA },
    { category: '', opening: 0, change: 0, closing: 0 },
    { category: 'Deferred Tax Liabilities (DTL)', opening: openingDTL, change: closingDTL - openingDTL, closing: closingDTL },
    { category: '', opening: 0, change: 0, closing: 0 },
    { category: 'Net Deferred Tax Expense', opening: 0, change: data.deferredTaxExpense, closing: data.deferredTaxExpense },
  ];

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = r.category;
    if (r.category) {
      row.getCell(2).value = r.opening;
      row.getCell(2).numFmt = '#,##0.00';
      row.getCell(3).value = r.change;
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(4).value = r.closing;
      row.getCell(4).numFmt = '#,##0.00';
    }
    if (r.category.startsWith('Net')) {
      row.getCell(1).font = { bold: true };
      row.getCell(4).font = { bold: true };
    }
  });
}

function addETRTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const ws = wb.addWorksheet('ETR Reconciliation', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Amount', key: 'amount', width: 20 },
    { header: 'Rate Impact', key: 'rate', width: 15 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };

  const federalRate = data.statutoryRate;
  const stateImpact = 0;
  const otherImpact = data.effectiveTaxRate - federalRate;

  const rows = [
    { description: 'Federal Statutory Rate', amount: federalRate * data.bookIncome, rate: `${(federalRate * 100).toFixed(1)}%` },
    { description: 'State Taxes (net of federal benefit)', amount: 0, rate: `${(stateImpact * 100).toFixed(2)}%` },
    { description: 'Permanent Differences', amount: 0, rate: `${(Math.max(0, otherImpact - stateImpact) * 100).toFixed(2)}%` },
    { description: 'Tax Credits', amount: 0, rate: '0.00%' },
    { description: 'Other Adjustments', amount: 0, rate: '0.00%' },
    { description: '', amount: 0, rate: '' },
    { description: 'Effective Tax Rate', amount: data.totalTaxExpense, rate: `${(data.effectiveTaxRate * 100).toFixed(2)}%` },
  ];

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = r.description;
    if (r.amount) {
      row.getCell(2).value = r.amount;
      row.getCell(2).numFmt = '#,##0.00';
    } else {
      row.getCell(2).value = '';
    }
    row.getCell(3).value = r.rate;

    if (r.description === 'Effective Tax Rate') {
      row.getCell(1).font = { bold: true };
      row.getCell(2).font = { bold: true };
      row.getCell(3).font = { bold: true };
    }
  });
}
