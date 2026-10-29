import { expect, test } from './fixtures';

// The seed the Playwright agents run before planning or generating (docs: test-agents): the project fixtures sign in
// this worker's customer and set up CardCom's stand-in, then the customer's home screen is open.
test.describe('Test group', () => {
  test('seed', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app/);
  });
});
