import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/workspace/makefun/bring-the-humans/package.json');
const { chromium } = require('playwright-core');

const OUT = '/home/hatch/workspace/makefun/token-radar-01/entry/out';
const SHOTS = '/home/hatch/workspace/makefun/token-radar-01/entry/screenshots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

// 1 — the board: scroll it into view so the table (not just the hero) fills the frame
await page.goto('file://' + OUT + '/dashboard/index.html');
await page.waitForTimeout(800);
await page.locator('#controls').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '/1-board.png' });
console.log('1-board.png done');

// 2 — a protocol detail view (rank 1). The ?shot= query forces a real reload:
// same-document hash navigation alone would not re-run the page.
await page.goto('file://' + OUT + '/dashboard/index.html?shot=2#p=steakhouse-financial');
await page.waitForTimeout(800);
await page.screenshot({ path: SHOTS + '/2-detail.png' });
console.log('2-detail.png done');

// 3 — a filtered view (Dexs only), scrolled to the board
await page.goto('file://' + OUT + '/dashboard/index.html?shot=3#category=Dexs');
await page.waitForTimeout(800);
await page.locator('#controls').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + '/3-filtered.png' });
console.log('3-filtered.png done');

await browser.close();
