import React, { useState } from 'react';
import { provision as provApi } from '../api/client';

export default function EveAdvisor() {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');

  const ask = async () => {
    if (!prompt.trim()) return;
    setAnswer('Thinking...');
    try {
      const res = await provApi.eveAsk(prompt);
      setAnswer(res.answer + (res.suggestedAction ? `\n\nSuggested action: ${res.suggestedAction}` : ''));
    } catch {
      setAnswer('Tax Advisor is currently unavailable. Try again later.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shrink-0 shadow-sm">
      <h3 className="font-semibold mb-3 text-gray-800">Tax Advisor</h3>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="Ask a technical tax question..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button onClick={ask} className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700 transition">
          Ask
        </button>
      </div>
      {answer && (
        <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap max-h-48 overflow-auto">
          {answer}
        </div>
      )}
    </div>
  );
}
