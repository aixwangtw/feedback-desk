import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { Browser, seedClientAccount, seedDeveloper, seedProject } from './helpers';

/**
 * Switching projects needs no second login for team accounts; client accounts stay on their own
 * project, even when another project has an account with the same username and password.
 */
async function seedThreeProjects() {
    const questionBank = await seedProject({ name: '題庫', clientUsername: 'chen', clientPassword: 'chen-password-1234567' });
    const ending = await seedProject({ name: 'Ending', clientUsername: 'ending', clientPassword: 'ending-password-1234567' });
    const internal = await seedProject({ name: '內部', clientUsername: 'nick-internal', clientPassword: 'same-password-everywhere' });
    // Same person, same username and password on the question bank: must not open internal.
    await seedClientAccount(questionBank.project, 'nick-internal', 'same-password-everywhere');
    return { questionBank, ending, internal };
}

const portal = (slug: string) => `/p/${slug}?tab=all`;

describe('switching projects without logging in again', () => {
    it('a team account signed in on one project opens every project and sees the switcher', async () => {
        const { questionBank, ending, internal } = await seedThreeProjects();
        const { developer, password } = await seedDeveloper();
        const browser = new Browser();
        expect((await browser.loginAs(questionBank.project.slug, developer.username, password)).status).toBe(302);

        for (const seeded of [ending, internal, questionBank]) {
            const response = await browser.get(portal(seeded.project.slug));
            expect(response.status).toBe(200);
            expect(await response.text()).toContain('切換專案');
        }
    });

    it('a client account only opens its own project, and switching back needs no login', async () => {
        const { questionBank, ending, internal } = await seedThreeProjects();
        const browser = new Browser();
        expect((await browser.loginAs(questionBank.project.slug, 'chen', 'chen-password-1234567')).status).toBe(302);

        const own = await browser.get(portal(questionBank.project.slug));
        expect(own.status).toBe(200);
        expect(await own.text()).not.toContain('切換專案');
        for (const seeded of [ending, internal]) {
            const response = await browser.get(portal(seeded.project.slug));
            expect(response.status).toBe(302);
            expect(response.headers.get('location')).toBe(`/p/${seeded.project.slug}/login`);
        }
        expect((await browser.get(portal(questionBank.project.slug))).status).toBe(200);
        expect((await browser.get('/owner/projects')).status).toBe(302);
    });

    it('the same username and password on another project does not open internal', async () => {
        const { questionBank, internal } = await seedThreeProjects();
        const browser = new Browser();
        expect((await browser.loginAs(questionBank.project.slug, 'nick-internal', 'same-password-everywhere')).status).toBe(302);

        expect((await browser.get(portal(questionBank.project.slug))).status).toBe(200);
        expect((await browser.get(portal(internal.project.slug))).status).toBe(302);
    });

    it('the internal client cannot open other projects', async () => {
        const { questionBank, ending, internal } = await seedThreeProjects();
        const browser = new Browser();
        expect((await browser.loginAs(internal.project.slug, 'nick-internal', 'same-password-everywhere')).status).toBe(302);

        expect((await browser.get(portal(internal.project.slug))).status).toBe(200);
        expect((await browser.get(portal(questionBank.project.slug))).status).toBe(302);
        expect((await browser.get(portal(ending.project.slug))).status).toBe(302);
    });

    it('an owner entry link stays limited to its own project', async () => {
        const { questionBank, internal } = await seedThreeProjects();
        const browser = await new Browser().asOwner(questionBank);

        expect((await browser.get(portal(questionBank.project.slug))).status).toBe(200);
        expect((await browser.get(portal(internal.project.slug))).status).toBe(302);
    });

    it('logging out of one project signs the team account out of every project', async () => {
        const { questionBank, ending, internal } = await seedThreeProjects();
        const { developer, password } = await seedDeveloper();
        const browser = new Browser();
        await browser.loginAs(questionBank.project.slug, developer.username, password);
        expect((await browser.get(portal(ending.project.slug))).status).toBe(200);

        await browser.post(`/p/${questionBank.project.slug}/logout`);
        for (const seeded of [questionBank, ending, internal]) {
            expect((await browser.get(portal(seeded.project.slug))).status).toBe(302);
        }
    });

    it('the global logout also clears project logins', async () => {
        const { questionBank, ending } = await seedThreeProjects();
        const { developer, password } = await seedDeveloper();
        const browser = new Browser();
        await browser.loginAs(ending.project.slug, developer.username, password);

        await browser.post('/owner/logout');
        expect((await browser.get(portal(ending.project.slug))).status).toBe(302);
        expect((await browser.get(portal(questionBank.project.slug))).status).toBe(302);
    });

    it('a failed or rate-limited team login opens nothing', async () => {
        const { questionBank, internal } = await seedThreeProjects();
        const { developer, password } = await seedDeveloper();
        const browser = new Browser();
        for (let i = 0; i < 5; i++) {
            expect((await browser.loginAs(questionBank.project.slug, developer.username, 'wrong')).status).toBe(422);
        }
        expect((await browser.loginAs(questionBank.project.slug, developer.username, password)).status).toBe(429);
        expect((await browser.get(portal(internal.project.slug))).status).toBe(302);
    });

    it('changing the team password ends the cross-project login', async () => {
        const { questionBank, internal } = await seedThreeProjects();
        const { developer, password } = await seedDeveloper();
        const browser = new Browser();
        await browser.loginAs(questionBank.project.slug, developer.username, password);
        expect((await browser.get(portal(internal.project.slug))).status).toBe(200);

        await env.DB.prepare("UPDATE developers SET password_hash = 'pbkdf2_sha256$10000$AAAA$BBBB' WHERE id = ?").bind(developer.id).run();
        expect((await browser.get(portal(internal.project.slug))).status).toBe(302);
    });
});
