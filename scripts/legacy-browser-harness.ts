import type { Page } from "@playwright/test";

const productionEntry = /from\s+["']\/src\/CampaignShell\.tsx(?:\?[^"']*)?["']/;
const legacyEntry = 'from "/src/App.tsx"';

/**
 * Keep Chapter 1 browser regressions on the original standalone App while the
 * production entry renders CampaignShell. The Vite-transformed entry retains
 * its React StrictMode, fonts, and stylesheet imports; only its root component
 * import is redirected for this page.
 */
export async function installLegacyBrowserHarness(page: Page): Promise<void> {
  await page.route("**/src/main.tsx*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(productionEntry, legacyEntry);
    if (body === source) {
      throw new Error(
        "Legacy browser harness could not find the CampaignShell entry import.",
      );
    }
    await route.fulfill({ response, body });
  });
}
