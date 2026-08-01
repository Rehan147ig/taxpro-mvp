import { test, expect } from '@playwright/test';
import { login, PARTNER_EMAIL } from './helpers';

test('operator workflow: provision -> review -> partner sign-off -> lock -> audit -> export', async ({ browser }) => {
  // ── Admin session: run a provision ──
  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();
  await login(page);

  await page.getByRole('link', { name: 'Provision', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tax Provision' })).toBeVisible();

  // Use a fresh period so the backend's approved/locked-run deduplication
  // cannot turn this UI test into an empty-review-path test on reruns.
  const periodSeed = Math.floor(Date.now() / 1000);
  const testYear = 2030 + Math.floor(periodSeed / 12) % 20;
  const testMonth = (periodSeed % 12) + 1;
  const testMonthText = String(testMonth).padStart(2, '0');
  const testPeriod = `${testYear}-${testMonthText}`;
  const testPeriodStart = `${testPeriod}-01`;
  const monthInput = page.locator('input[type="month"]').first();
  await monthInput.fill(testPeriod);
  await page.getByRole('button', { name: 'Run Provision' }).click();
  await expect(page.getByText('Calculating...')).toBeVisible();

  await expect(page.getByRole('link', { name: 'Open in Review →' })).toBeVisible({ timeout: 150_000 });
  const runIdFromUrl = await page.getByRole('link', { name: 'Open in Review →' }).getAttribute('href');
  expect(runIdFromUrl).toMatch(/\/runs\//);

  // ── Run detail: resolve the deterministic review item ──
  await page.getByRole('link', { name: 'Open in Review →' }).click();
  await expect(page.getByRole('heading', { name: /Provision/ })).toBeVisible();

  // ── Verify review items are displayed (should have at least one) ──
  await expect(page.getByText(/missing depreciation metadata|Review AI mapping|Missing tax mapping/i).first()).toBeVisible({ timeout: 15_000 });

  for (let i = 0; i < 8; i++) {
    const approve = page.getByRole('button', { name: 'Approve AI Choice' }).first();
    try {
      await approve.waitFor({ state: 'visible', timeout: 5000 });
      await approve.click();
      await page.waitForTimeout(400);
    } catch {
      break;
    }
  }
  await expect(page.getByRole('button', { name: 'Submit for Approval' })).toBeVisible();

  // ── Navigate to AI Findings page and verify it loads ──
  await page.getByRole('link', { name: 'AI Findings' }).click();
  await expect(page.getByRole('heading', { name: /AI|Findings|Agent/ }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('body')).not.toContainText('Error loading', { timeout: 5_000 });
  await page.getByRole('link', { name: 'Back to Run Detail' }).click();

  // ── Submit for partner approval ──
  await page.getByRole('button', { name: 'Submit for Approval' }).click();
  await expect(page.getByRole('button', { name: 'Partner Sign-off' })).toBeVisible({ timeout: 30_000 });

  // ── Partner (separate session) opens the run and signs off ──
  const partnerContext = await browser.newContext();
  const pPage = await partnerContext.newPage();
  await login(pPage, PARTNER_EMAIL);

  await pPage.getByRole('link', { name: 'Review', exact: true }).click();
  const runRow = pPage.locator('tbody tr').filter({ hasText: testPeriodStart }).first();
  await runRow.click();
  await expect(pPage.getByRole('button', { name: 'Partner Sign-off' })).toBeVisible();
  await pPage.getByRole('button', { name: 'Partner Sign-off' }).click();
  await expect(pPage.getByRole('button', { name: 'Lock Final Provision' })).toBeVisible({ timeout: 30_000 });
  await partnerContext.close();

  // ── Admin locks the final provision (reload to see the partner's approval) ──
  await page.reload();
  await expect(page.getByRole('button', { name: 'Lock Final Provision' })).toBeVisible({ timeout: 30_000 });
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Lock Final Provision' }).click();
  await expect(page.getByText('Locked', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // ── Locked state: TB mapping controls are read-only ──
  await page.getByRole('button', { name: 'GL Trial Balance' }).click();
  await expect(page.locator('table select')).toHaveCount(0, { timeout: 15_000 });

  // ── Mutation after lock is rejected with 409 (API-level proof) ──
  const adminToken = await page.evaluate(() => localStorage.getItem('taxpro_token'));
  const adminRequest = await adminContext.request;
  const authHeader = { Authorization: `Bearer ${adminToken}` };
  const runId = runIdFromUrl!.replace('/runs/', '');
  const mappings = await (await adminRequest.get('/api/mapping/mappings', { headers: authHeader })).json();
  expect(Array.isArray(mappings)).toBe(true);
  const accountId = mappings[0]?.accountId ?? mappings[0]?.id;
  expect(accountId).toBeTruthy();
  const overrideResp = await adminRequest.post(`/api/mapping/mappings/${accountId}/override`, {
    headers: authHeader,
    data: { taxAccountType: 'PERM_OTHER', bookTreatment: 'permanent', provisionRunId: runId },
  });
  expect(overrideResp.status()).toBe(409);

  // ── Audit trail records the whole lifecycle ──
  await page.getByRole('link', { name: 'Audit Events' }).click();
  await expect(page.getByText('run.locked').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('submitted_for_approval')).toBeVisible();
  await expect(page.getByText('partner.approved')).toBeVisible();

  // ── Export package downloads a valid ZIP with content verification ──
  await page.getByRole('link', { name: 'Back to Run Detail' }).click();
  await page.getByRole('link', { name: 'Exports' }).click();
  await expect(page.getByRole('heading', { name: 'Export Package' })).toBeVisible();

  // Verify export page shows validation-ready language (not filing-ready)
  const exportPageText = await page.textContent('body');
  expect(exportPageText).not.toMatch(/filing.ready|filing is ready|submit to HMRC/i);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Package (.zip)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const fullBuf = Buffer.concat(chunks);

  // Verify download is non-empty
  expect(fullBuf.length).toBeGreaterThan(100);

  // Verify ZIP magic bytes
  const head = fullBuf.subarray(0, 4);
  expect(head.subarray(0, 2).toString('latin1')).toBe('PK');

  // Verify the ZIP contains expected entries (basic check)
  const fileContent = fullBuf.toString('latin1');
  expect(fileContent).toContain('manifest.json');
  expect(fileContent).toContain('review-items.csv');
  expect(fileContent).toContain('approval-trail.json');

  // ── Dashboard shows provision run status ──
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('2026-01-01').first()).toBeVisible({ timeout: 10_000 });

  await adminContext.close();
});
