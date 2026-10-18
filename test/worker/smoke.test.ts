import { describe, expect, it } from 'vitest';
import { Browser, seedProject } from './helpers';

describe('smoke', () => {
    it('renders the home page and the portal for an owner', async () => {
        const browser = new Browser();
        const home = await browser.get('/');
        expect(home.status).toBe(200);
        expect(await home.text()).toContain('請開啟開發團隊給你的專案連結');
        const seeded = await seedProject();
        await browser.asOwner(seeded);
        const portal = await browser.get(`/p/${seeded.project.slug}`);
        expect(portal.status).toBe(200);
        expect(await portal.text()).toContain('問題清單');
    });
});
