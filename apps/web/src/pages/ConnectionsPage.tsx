import React, { useEffect, useState } from 'react';
import { connections as connApi, imports as importApi } from '../api/client';

interface Connection {
  id: string;
  label: string;
  accountId: string;
  realm: string;
  syncStatus: string;
  lastSyncAt: string | null;
  createdAt: string;
}

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadConns = async () => {
    try {
      const data = await connApi.list();
      setConns(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConns(); }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Data Sources</h2>
          <p className="text-sm text-gray-500 mt-1">Import GL data now; connect ERPs as customer demand pulls them in.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          {showForm ? 'Cancel' : '+ Add Connection'}
        </button>
      </div>

      <CsvImportPanel />

      <div className="flex justify-between items-center mt-8 mb-4">
        <h3 className="font-semibold">ERP Connections</h3>
      </div>

      {showForm && <ConnectionForm onSaved={() => { setShowForm(false); loadConns(); }} />}

      {loading ? (
        <p className="text-gray-500">Loading connections...</p>
      ) : conns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-2">No connections yet</p>
          <p className="text-sm text-gray-400">Add your NetSuite account to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {conns.map((conn) => (
            <div key={conn.id} className="bg-white rounded-xl border border-gray-200 p-4 flex justify-between items-center">
              <div>
                <p className="font-medium">{conn.label}</p>
                <p className="text-sm text-gray-500">
                  Account: {conn.accountId} · Realm: {conn.realm}
                </p>
                <p className="text-xs text-gray-400">
                  Status: {conn.syncStatus}
                  {conn.lastSyncAt && ` · Last sync: ${new Date(conn.lastSyncAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={async () => {
                  await connApi.sync(conn.id);
                  loadConns();
                }}
                className="text-sm text-brand-600 hover:underline"
              >
                Sync Now
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CsvImportPanel() {
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [source, setSource] = useState('csv');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setMessage('');
    setError('');
  };

  const loadTemplate = async () => {
    setCsv(await importApi.trialBalanceTemplate());
    setFileName('taxpro-trial-balance-template.csv');
    setMessage('Template loaded. Edit or replace it with your trial balance export.');
    setError('');
  };

  const handleImport = async () => {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const result = await importApi.trialBalance({ csv, source });
      setMessage(`Imported ${result.importedRows} trial-balance rows and ${result.accounts} accounts.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex justify-between gap-4 items-start mb-4">
        <div>
          <h3 className="font-semibold">Universal GL Import</h3>
          <p className="text-sm text-gray-500 mt-1">
            Upload a trial balance CSV from Excel, QuickBooks, Xero, Sage, SAP, Oracle, or a warehouse export.
          </p>
        </div>
        <button
          onClick={loadTemplate}
          className="text-sm text-brand-600 hover:underline whitespace-nowrap"
          type="button"
        >
          Load template
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <label className="col-span-2">
          <span className="text-xs text-gray-500 uppercase font-medium">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => handleFile(event.target.files?.[0])}
            className="mt-1 block w-full text-sm"
          />
          {fileName && <span className="text-xs text-gray-400">{fileName}</span>}
        </label>
        <label>
          <span className="text-xs text-gray-500 uppercase font-medium">Source label</span>
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
      </div>

      <textarea
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
        placeholder="entity,entityName,accountNumber,accountName,accountType,period,periodEnd,debit,credit,balance,currency"
        className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div className="flex justify-between items-center mt-4">
        <p className="text-xs text-gray-500">Required columns: accountName, accountType, period, and balance or debit/credit.</p>
        <button
          onClick={handleImport}
          disabled={loading || !csv.trim()}
          className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          type="button"
        >
          {loading ? 'Importing...' : 'Import Trial Balance'}
        </button>
      </div>

      {message && <p className="text-sm text-green-600 mt-3">{message}</p>}
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </section>
  );
}

function ConnectionForm({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
    label: '', accountId: '', consumerKey: '', consumerSecret: '',
    tokenId: '', tokenSecret: '', realm: '', baseUrl: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await connApi.create(form);
      onSaved();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 mb-6 grid grid-cols-2 gap-4">
      {Object.entries(form).map(([key, val]) => (
        <div key={key}>
          <label className="text-xs text-gray-500 uppercase font-medium">{key.replace(/([A-Z])/g, ' $1')}</label>
          <input
            type={key.includes('secret') ? 'password' : 'text'}
            value={val}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
        </div>
      ))}
      <div className="col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-brand-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Connection'}
        </button>
      </div>
    </form>
  );
}
