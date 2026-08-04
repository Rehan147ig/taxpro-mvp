import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const ADMIN_EMAIL = 'demo@taxpro.ai';
export const PARTNER_EMAIL = 'partner@taxpro.ai';
export const PASSWORD = 'TaxProDemo123!';

// The app defaults to a demo "authenticated" landing in local dev. Real API
// calls need a genuine JWT, so login always signs out first when needed and
// then performs a real authentication.
export async function login(page: Page, email = ADMIN_EMAIL, password = PASSWORD) {
  await page.goto('/');
  const signOut = page.getByRole('button', { name: 'Sign Out' });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  }
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
