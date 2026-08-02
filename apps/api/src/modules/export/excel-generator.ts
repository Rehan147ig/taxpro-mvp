import Excel from 'exceljs';

export interface ProvisionExportDetail {
  summary?: Record<string, number>;
  currentTax?: {
    bookIncome: number;
    totalPermanentAdjustments: number;
    taxableIncome: number;
    federalTaxRate: number;
    federalTax: number;
    marginalRelief?: number;
    stateTax: number;
    totalTaxBeforeCredits: number;
    taxCredits: number;
    totalTaxAfterCredits: number;
    estimatedPayments: number;
    nolUtilization?: number;
    taxPayable?: number;
  };
  deferredTax?: {
    totalOpeningDTA: number;
    totalOpeningDTL: number;
    totalClosingDTA: number;
    totalClosingDTL: number;
    netDeferredTaxExpense: number;
    lines: Array<{
      timingCategory: string;
      openingBalance: number;
      currentYearChange: number;
      taxRate: number;
      deferredTaxAmount: number;
      reversals: number;
      closingBalance: number;
      dtType: string;
    }>;
  };
  etr?: {
    statutoryRate: number;
    statutoryTax: number;
    effectiveTaxRate: number;
    totalTaxExpense: number;
    lines: Array<{ description: string; amount: number; taxImpact: number; rateImpact: number }>;
  };
  rollforward?: {
    deferredTaxRollforward: Array<{
      timingCategory: string;
      openingBalance: number;
      currentYearChange: number;
      taxRate: number;
      deferredTaxAmount: number;
      reversals: number;
      closingBalance: number;
      dtType: string;
    }>;
    nolRollforward: Record<string, number>;
    creditRollforward: Record<string, number>;
    valuationAllowance: Record<string, number>;
  };
  journalEntries?: Array<{
    type: string;
    entityId: string;
    period: string;
    lines: Array<{ accountId: string; debit: number; credit: number; memo?: string }>;
    totalDebit: number;
    totalCredit: number;
  }>;
  lineItems?: {
    permanentDifferences: Array<{ label: string; amount: number }>;
    temporaryDifferences: Array<{ accountId: string; label?: string; difference: number; timingCategory: string }>;
  };
  jurisdiction?: string;
}

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
  detail?: ProvisionExportDetail | null;
}

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

export async function generateProvisionWorkbook(data: ProvisionExportData): Promise<Buffer> {
  const wb = new Excel.Workbook();
  wb.creator = 'TaxPro';
  // Deterministic metadata: derive from the immutable run's createdAt so the
  // same input always produces the same bytes (byte-reproducible packages).
  const created = new Date(data.createdAt);
  const fixedTs = Number.isNaN(created.getTime()) ? new Date(0) : created;
  wb.created = fixedTs;
  wb.modified = fixedTs;

  addSummaryTab(wb, data);
  addCurrentTaxTab(wb, data);
  addDeferredTaxTab(wb, data);
  addETRTab(wb, data);
  addJournalEntriesTab(wb, data);
  addLineItemsTab(wb, data);

  const buf = await wb.xlsx.writeBuffer();
  return normalizeZipTimestamps(Buffer.from(buf), fixedTs);
}

// exceljs' internal JSZip stamps every zip entry with Date.now() (2s DOS
// granularity), which breaks byte-reproducibility for locked runs even though
// the workbook metadata is pinned. Rewrite the DOS time/date fields in every
// local file header and central directory entry from the immutable run's
// createdAt (UTC), so identical input always produces identical bytes —
// regardless of wall clock or machine timezone.
function normalizeZipTimestamps(buf: Buffer, ts: Date): Buffer {
  const dos = toDosTime(ts);
  const writeStamp = (off: number) => {
    buf.writeUInt16LE(dos.time, off);
    buf.writeUInt16LE(dos.date, off + 2);
  };
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === 0x04034b50) writeStamp(i + 10); // local file header
    else if (buf.readUInt32LE(i) === 0x02014b50) writeStamp(i + 12); // central directory entry
  }
  return buf;
}

function toDosTime(d: Date): { time: number; date: number } {
  const year = Math.max(d.getUTCFullYear(), 1980);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

function styleHeaderRow(ws: Excel.Worksheet) {
  const header = ws.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
}

function addSummaryTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  styleHeaderRow(ws);

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
    { metric: 'Jurisdiction', value: data.detail?.jurisdiction ?? 'US_ASC740' },
    { metric: 'Created At', value: data.createdAt },
  ];

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = r.metric;
    row.getCell(2).value = r.value;
    if (typeof r.value === 'number') {
      row.getCell(2).numFmt = '#,##0.00';
    }
    if (r.metric === 'Total Tax Expense' || r.metric === 'Jurisdiction') {
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

  styleHeaderRow(ws);

  const d = data.detail?.currentTax;
  const permanent = data.detail?.lineItems?.permanentDifferences ?? [];
  const statutoryRate = d?.federalTaxRate ?? data.statutoryRate;

  const rows: { component: string; amount: string | number; rate: string }[] = [
    { component: 'Book Income (Pretax)', amount: d?.bookIncome ?? data.bookIncome, rate: '' },
    { component: '', amount: '', rate: '' },
    ...permanent.map(p => ({ component: `Permanent Difference: ${p.label}`, amount: p.amount, rate: '' })),
    { component: 'Total Permanent Adjustments', amount: d?.totalPermanentAdjustments ?? 0, rate: '' },
    { component: '', amount: '', rate: '' },
    { component: 'Taxable Income', amount: d?.taxableIncome ?? data.bookIncome, rate: `${(statutoryRate * 100).toFixed(1)}%` },
    { component: '', amount: '', rate: '' },
    { component: 'Federal Tax', amount: d?.federalTax ?? (data.bookIncome * statutoryRate), rate: `${(statutoryRate * 100).toFixed(1)}%` },
    { component: 'State Tax (net of fed benefit)', amount: d?.stateTax ?? 0, rate: '' },
    { component: 'Total Tax Before Credits', amount: d?.totalTaxBeforeCredits ?? 0, rate: '' },
    { component: 'Tax Credits', amount: d?.taxCredits ?? 0, rate: '' },
    { component: 'NOL Utilization', amount: d?.nolUtilization ?? 0, rate: '' },
    { component: '', amount: '', rate: '' },
    { component: 'Total Current Tax Expense', amount: d?.totalTaxAfterCredits ?? data.currentTaxExpense, rate: '' },
    { component: 'Less: Estimated Payments', amount: d?.estimatedPayments ?? 0, rate: '' },
    { component: '', amount: '', rate: '' },
    { component: 'Tax Payable (Receivable)', amount: d?.taxPayable ?? data.taxPayable, rate: '' },
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
    { header: 'Reversals', key: 'reversals', width: 20 },
    { header: 'Rate', key: 'rate', width: 10 },
    { header: 'Closing Balance', key: 'closing', width: 20 },
    { header: 'Type', key: 'type', width: 12 },
  ];

  styleHeaderRow(ws);

  const lines = data.detail?.deferredTax?.lines ?? [];

  if (lines.length > 0) {
    for (const line of lines) {
      const row = ws.addRow({
        category: line.timingCategory,
        opening: line.openingBalance,
        change: line.currentYearChange,
        reversals: line.reversals,
        rate: `${(line.taxRate * 100).toFixed(1)}%`,
        closing: line.closingBalance,
        type: line.dtType,
      });
      row.getCell(2).numFmt = '#,##0.00';
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(4).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
    }
  } else {
    // Aggregate fallback when no per-category lines are stored
    const closingDTA = data.deferredTaxExpense > 0 ? 0 : Math.abs(data.deferredTaxExpense);
    const closingDTL = data.deferredTaxExpense > 0 ? data.deferredTaxExpense : 0;
    const rows = [
      { category: 'Deferred Tax Assets (DTA)', opening: 0, change: closingDTA, closing: closingDTA, type: 'aggregate' },
      { category: 'Deferred Tax Liabilities (DTL)', opening: 0, change: closingDTL, closing: closingDTL, type: 'aggregate' },
    ];
    rows.forEach(r => {
      const row = ws.addRow({ category: r.category, opening: r.opening, change: r.change, closing: r.closing, type: r.type });
      row.getCell(2).numFmt = '#,##0.00';
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
    });
  }

  ws.addRow({});
  const totalRow = ws.addRow({
    category: 'Net Deferred Tax Expense',
    closing: data.detail?.deferredTax?.netDeferredTaxExpense ?? data.deferredTaxExpense,
  });
  totalRow.getCell(1).font = { bold: true };
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(6).numFmt = '#,##0.00';
}

function addETRTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const ws = wb.addWorksheet('ETR Reconciliation', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Amount', key: 'amount', width: 20 },
    { header: 'Rate Impact', key: 'rate', width: 15 },
  ];

  styleHeaderRow(ws);

  const lines = data.detail?.etr?.lines ?? [];

  if (lines.length > 0) {
    for (const line of lines) {
      const row = ws.addRow({
        description: line.description,
        amount: line.amount,
        rate: `${(line.rateImpact * 100).toFixed(2)}%`,
      });
      row.getCell(2).numFmt = '#,##0.00';
    }
  } else {
    const federalRate = data.statutoryRate;
    const otherImpact = data.effectiveTaxRate - federalRate;
    const rows = [
      { description: 'Federal Statutory Rate', amount: federalRate * data.bookIncome, rate: `${(federalRate * 100).toFixed(1)}%` },
      { description: 'State Taxes (net of federal benefit)', amount: 0, rate: '0.00%' },
      { description: 'Permanent Differences', amount: 0, rate: `${(Math.max(0, otherImpact) * 100).toFixed(2)}%` },
      { description: 'Tax Credits', amount: 0, rate: '0.00%' },
      { description: 'Other Adjustments', amount: 0, rate: '0.00%' },
    ];
    rows.forEach(r => {
      const row = ws.addRow({ description: r.description, amount: r.amount, rate: r.rate });
      if (r.amount) row.getCell(2).numFmt = '#,##0.00';
    });
  }

  ws.addRow({});
  const totalRow = ws.addRow({
    description: 'Effective Tax Rate',
    amount: data.totalTaxExpense,
    rate: `${(data.effectiveTaxRate * 100).toFixed(2)}%`,
  });
  totalRow.eachCell(cell => { cell.font = { bold: true }; });
  totalRow.getCell(2).numFmt = '#,##0.00';
}

function addJournalEntriesTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const entries = data.detail?.journalEntries ?? [];
  if (entries.length === 0) return;

  const ws = wb.addWorksheet('Journal Entries', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Entry Type', key: 'type', width: 22 },
    { header: 'Account', key: 'account', width: 32 },
    { header: 'Debit', key: 'debit', width: 18 },
    { header: 'Credit', key: 'credit', width: 18 },
    { header: 'Memo', key: 'memo', width: 40 },
  ];

  styleHeaderRow(ws);

  for (const entry of entries) {
    const startRow = ws.rowCount + 1;
    for (const line of entry.lines) {
      ws.addRow({
        type: entry.type,
        account: line.accountId,
        debit: line.debit > 0 ? line.debit : 0,
        credit: line.credit > 0 ? line.credit : 0,
        memo: line.memo ?? '',
      });
    }
    const totalRow = ws.addRow({
      type: `${entry.type} TOTAL`,
      debit: entry.totalDebit,
      credit: entry.totalCredit,
    });
    totalRow.getCell(1).font = { bold: true };
    totalRow.getCell(3).numFmt = '#,##0.00';
    totalRow.getCell(4).numFmt = '#,##0.00';
    ws.addRow({});
  }

  // Apply number formats to all data rows
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const credit = row.getCell(4).value;
    const debit = row.getCell(3).value;
    if (typeof credit === 'number') row.getCell(4).numFmt = '#,##0.00';
    if (typeof debit === 'number') row.getCell(3).numFmt = '#,##0.00';
  });
}

function addLineItemsTab(wb: Excel.Workbook, data: ProvisionExportData) {
  const lineItems = data.detail?.lineItems;
  const tempItems = lineItems?.temporaryDifferences ?? [];
  if (tempItems.length === 0) return;

  const ws = wb.addWorksheet('Line Items', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Label', key: 'label', width: 40 },
    { header: 'Amount', key: 'amount', width: 20 },
    { header: 'Category', key: 'category', width: 24 },
  ];

  styleHeaderRow(ws);

  for (const pd of lineItems?.permanentDifferences ?? []) {
    ws.addRow({ type: 'Permanent', label: pd.label, amount: pd.amount, category: '' });
  }
  for (const td of tempItems) {
    ws.addRow({
      type: 'Timing',
      label: td.label ?? td.accountId,
      amount: td.difference,
      category: td.timingCategory,
    });
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const amount = row.getCell(3).value;
    if (typeof amount === 'number') row.getCell(3).numFmt = '#,##0.00';
  });
}
