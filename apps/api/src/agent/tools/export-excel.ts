import { generateProvisionWorkbook } from '../../modules/export/excel-generator.js';

const parameters = {
  type: 'object',
  properties: {
    period: { type: 'string', description: 'The provision period in YYYY-MM-DD format' },
    bookIncome: { type: 'number', description: 'Net book income' },
    currentTaxExpense: { type: 'number', description: 'Current tax expense' },
    deferredTaxExpense: { type: 'number', description: 'Deferred tax expense' },
    totalTaxExpense: { type: 'number', description: 'Total tax expense' },
    effectiveTaxRate: { type: 'number', description: 'Effective tax rate as decimal' },
    statutoryRate: { type: 'number', description: 'Statutory rate as decimal' },
    taxPayable: { type: 'number', description: 'Tax payable' },
    valuationAllowance: { type: 'number', description: 'Valuation allowance' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
  },
  required: ['period', 'bookIncome', 'currentTaxExpense', 'deferredTaxExpense', 'totalTaxExpense', 'effectiveTaxRate', 'statutoryRate', 'taxPayable'],
  additionalProperties: false,
};

export const exportExcel = {
  spec: { description: 'Generate an Excel (.xlsx) workpaper with 4 tabs (Summary, Current Tax, Deferred Tax, ETR Reconciliation) from provision results. Returns base64.', parameters },
  execute: async (args: Record<string, any>) => {
    const buffer = await generateProvisionWorkbook({
      period: args.period, bookIncome: args.bookIncome, currentTaxExpense: args.currentTaxExpense,
      deferredTaxExpense: args.deferredTaxExpense, totalTaxExpense: args.totalTaxExpense,
      effectiveTaxRate: args.effectiveTaxRate, statutoryRate: args.statutoryRate,
      taxPayable: args.taxPayable, valuationAllowance: args.valuationAllowance ?? 0,
      createdAt: args.createdAt ?? new Date().toISOString(),
    });

    return { filename: `taxpro-provision-${args.period}.xlsx`, size: buffer.length, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: buffer.toString('base64') };
  },
};
