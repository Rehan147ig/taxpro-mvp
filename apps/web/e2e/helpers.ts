import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const ADMIN_EMAIL = 'demo@taxpro.ai';
export const PARTNER_EMAIL = 'partner@taxpro.ai';
export const PASSWORD = 'TaxProDemo123!';

export async function login(page: Page, email = ADMIN_EMAIL, password = PASSWORD) {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
