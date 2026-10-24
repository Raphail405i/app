import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function fillProject(page: Page, name: string, client: string) {
  const form = page.getByRole('dialog');
  await form.getByLabel('Project name').fill(name);
  await form.getByLabel('Client or company').fill(client);
  await form.getByLabel('Agreed budget').fill('4000');
  await form.getByLabel('Currency').selectOption('EUR');
  await form.getByRole('button', { name: 'Create project', exact: true }).click();
}

async function fillChange(page: Page, title: string, status: 'draft' | 'pending' = 'pending', amount = '450') {
  const form = page.getByRole('dialog');
  await form.getByLabel('What’s the extra work?').fill(title);
  await form.getByLabel('A little more detail').fill('One additional responsive page with one revision round.');
  await form.getByLabel('Additional fee (project currency)').fill(amount);
  await form.getByLabel('Additional days').fill('3');
  await form.getByLabel('Next step').selectOption(status);
  await form.getByRole('button', { name: 'Create request', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A clear agreement', exact: true })).toBeVisible();
}

test('demo search, filters and locally persisted project/request creation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('You’re exploring a demo workspace.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^Pending/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).not.toContainText('Social media asset pack');
  await page.getByRole('button', { name: 'All requests', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search requests' }).fill('motion');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Motion design add-on');
  await page.getByRole('textbox', { name: 'Search requests' }).clear();

  await page.locator('nav').getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await fillProject(page, 'Demo illustration', 'Demo Client');
  await expect(page.getByRole('heading', { name: 'Demo illustration' })).toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'New change request', exact: true }).click();
  await page.getByRole('dialog').locator('select[name=projectId]').selectOption({ label: 'Demo illustration · Demo Client · EUR' });
  await fillChange(page, 'Demo additional illustration', 'draft');
  await expect(page.getByRole('dialog').getByText('Demo additional illustration', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Client approval link', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page.getByRole('textbox', { name: 'Search requests' }).fill('Demo additional illustration');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Demo Client');
});

test('real account, scoped workspace, client approval, free limit and sign-in persistence', async ({ page, browser }) => {
  const email = `owner-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-2026';
  await page.goto('/');
  await page.getByRole('button', { name: 'Create your free workspace', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Your name').fill('Test Owner');
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Create free workspace', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'A fresh start for clearer work' })).toBeVisible();

  await page.locator('nav').getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await fillProject(page, 'Customer website', 'Real Test Client');
  await expect(page.getByRole('heading', { name: 'Customer website' })).toBeVisible();

  // The free-tier cap must be enforced by the server and surfaced in the UI.
  await page.locator('nav').getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await fillProject(page, 'Second project', 'Other Client');
  await expect(page.getByRole('alert')).toContainText('free plan includes one project');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.locator('nav').getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'New change request', exact: true }).click();
  await fillChange(page, 'Extra contact page', 'pending', '850.50');
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Client approval link', exact: true })).toBeVisible();
  const approvalURL = await dialog.getByRole('textbox', { name: 'Client approval link', exact: true }).inputValue();
  expect(approvalURL).toMatch(/^http:\/\/127\.0\.0\.1:3001\/approve\/[0-9a-f]{64}$/);

  const client = await browser.newContext();
  try {
    const clientPage = await client.newPage();
    await clientPage.goto(approvalURL);
    await expect(clientPage.getByRole('heading', { name: 'Extra contact page' })).toBeVisible();
    await expect(clientPage.locator('.approval-totals')).toContainText('€850.50');
    await clientPage.getByLabel('Your name').fill('Jamie Client');
    await clientPage.getByLabel('Your decision').selectOption('approved');
    await clientPage.getByRole('button', { name: 'Confirm my decision', exact: true }).click();
    await expect(clientPage.getByRole('heading', { name: 'Thanks. That’s clear.' })).toBeVisible();
    await clientPage.reload();
    await expect(clientPage.getByText('This request has already been answered.', { exact: false })).toBeVisible();
    await expect(clientPage.getByRole('button', { name: 'Confirm my decision' })).toHaveCount(0);
  } finally {
    await client.close();
  }

  await page.reload();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Approved');
  await expect(page.locator('tbody')).toContainText('€850.50');
  await page.getByRole('button', { name: /^Extra contact page/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Approved by Jamie Client');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.demo-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Create your free workspace', exact: true }).click();
  await page.locator('.auth-switch').getByRole('button', { name: 'Sign in', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(page.locator('tbody')).toContainText('Extra contact page');
  await expect(page.getByRole('heading', { name: 'Customer website' })).toBeVisible();

  await page.locator('nav').getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(page.getByText('Live billing is not connected yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make room for more', exact: true })).toBeDisabled();
});

test('mobile navigation and dashboard remain within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little clarity. A lot of momentum.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  await page.locator('nav').getByRole('button', { name: /^Change requests/ }).click();
  await expect(page.getByRole('heading', { name: 'Change requests', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('nav').getByRole('button', { name: 'Subscription', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good work deserves good tools.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
