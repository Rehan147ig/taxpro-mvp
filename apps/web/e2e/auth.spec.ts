import { test, expect } from '@playwright/test';
import { login, ADMIN_EMAIL, PASSWORD } from './helpers';

test('login succeeds and the operator dashboard renders', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Getting Started')).toBeVisible();
  await expect(page.getByText('Provision Runs', { exact: true })).toBeVisible();
});

test('logout returns to the login screen', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});

test('failed login shows a generic error and stays on the login screen', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill(ADMIN_EMAIL);
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('You do not have access to this provision or its records.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});
