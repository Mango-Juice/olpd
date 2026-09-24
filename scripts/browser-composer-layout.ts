import { chromium, expect } from '@playwright/test';

// Delayed requests are explicit transport fixtures, not live model accuracy checks.
const browser = await chromium.launch();
try {
  for (const width of [1440, 390, 320]) {
    for (const chapter of [1, 2]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      let release!: () => void;
      const delayed = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/api/**', async (route) => {
        await delayed;
        await route.abort().catch(() => undefined);
      });
      try {
        await page.goto(`http://localhost:5173/${chapter === 2 ? '?qa=1' : ''}`);
        if (chapter === 1) await page.getByRole('button', { name: '이야기 SKIP', exact: true }).click();
        else await page.locator('.roadmap-stop').filter({ has: page.getByRole('heading', { name: '비에 잠긴 회랑', exact: true }) })
          .getByRole('button', { name: /들어가기|이어 걷기/ }).click();
        const input = page.locator(chapter === 1 ? '#instruction' : '#campaign-instruction');
        await input.fill('짐상자가 보이면 점프해');
        await page.evaluate(() => document.fonts.ready);
        const submit = page.locator('.composer button[type="submit"]');
        await submit.scrollIntoViewIfNeeded();
        const before = (await submit.boundingBox())!;
        await input.press('Enter');
        await expect(submit).toContainText('읽고 있어요');
        const pending = (await submit.boundingBox())!;
        for (const key of ['x', 'width', 'height'] as const) expect(Math.abs(before[key] - pending[key]), `${chapter}장 ${width}px ${key}`).toBeLessThan(1);
        // Focusing the textarea may scroll the viewport; horizontal alignment and size must stay fixed.
        await expect(page.getByRole('button', { name: '취소', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.getByRole('button', { name: '취소', exact: true }).click();
        await expect(submit).toContainText('기억하고 출발');
      } finally { release(); await context.close(); }
    }
  }
  console.log('PASS pending composer button stays aligned in Chapters 1/2 at 1440/390/320px; cancellation works; 0 paid calls');
} finally { await browser.close(); }
