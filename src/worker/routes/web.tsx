import { Hono } from 'hono';
import { isStatus, statusLabel, STATUSES, type ReportStatus } from '../../shared/status';
import { charLength, charSlice } from '../../shared/text';
import { config, turnstileEnabled } from '../env';
import { DUMMY_PASSWORD_HASH, sha256Hex, timingSafeEqualString, verifyPassword } from '../lib/crypto';
import { attachmentsForReport, statusEventsForReport, findClientAccount, findClientAccountInProject, findDeveloper, findDeveloperByUsername, findProjectBySlug, listClientAccounts, findReportInProject, likeContains, listDevelopers, listProjects, messagesForReport } from '../lib/db';
import { CLIENT_VISIBLE_SQL, isPublicReport, type Attachment, type ClientAccount, type Developer, type Message, type Project, type Report } from '../lib/models';
import { attempt, clear, clientIp, hit, tooManyAttempts, type Limit } from '../lib/rate-limit';
import {
    statusChangeNotice,
    addMessage,
    adjustmentNewForClientSql,
    parseStoredFiles,
    PORTAL_TABS,
    waitingSideSql,
    type PortalTab,
    type WaitingSide,
    changeStatus,
    chatCounts,
    clientLabel,
    creatorClientNameSql,
    viewerReadAtColumnSql,
    type ClientViewer,
    countRemovable,
    createReport,
    creatorLabel,
    deleteReport,
    conversationOrderSql,
    statusPriorityOrderSql,
    hasUnreadMessagesSql,
    latestMessageSql,
    markRead,
    MAX_DESCRIPTION,
    MAX_MESSAGE,
    MAX_REPORTER_NAME,
    MAX_TITLE,
    messageAuthorName,
    messagesCountSql,
    sequenceNumber,
    setClientDeleted,
    statusCounts,
    updateReport,
    viewerUnreadSql,
} from '../lib/reports';
import {
    findClaimableUploads,
    MAX_IMAGE_BYTES,
    MAX_SCREENSHOTS,
    PUBLIC_MAX_IMAGE_BYTES,
    PUBLIC_MAX_SCREENSHOTS,
    pendingPublicUploads,
    pruneStaleUploads,
    storeImageStream,
    UploadError,
} from '../lib/uploads';
import { formatAbsolute, nowIso } from '../../shared/time';
import { messagePreview, shortTime } from '../../shared/conversation';
import { isAwaitingReply } from '../../shared/chat-tabs';
import { GlobalLoginPage, HomePage, HONEYPOT_FIELD, LoginPage, ProjectsOverviewPage, PublicHomePage, TURNSTILE_FIELD, type PublicFormState } from '../views/pages';
import { PortalPage, ReportDialogs, editCategoryOptions, type DialogRow, type PortalFormState, type PortalRow } from '../views/portal';
import { ConversationFragment, DetailSide, DraftsSection, messageAuthorLabel, ReportPage, Thread } from '../views/report';
import { albumItems } from '../lib/album';
import { ADJUSTMENT_WEB_DISABLED, completionSentNotice } from '../../shared/completion';
import { requestCompletion } from '../lib/completion';
import { isSafeLocalPath } from '../lib/access';
import { abort, backUrl, currentPathWithQuery, field, origin, readForm, viewContext, wantsJson, type AppContext, type AppEnv } from './context';
import { paths } from './paths';
import { projectCategories } from '../../shared/categories';
import { verifyTurnstile } from '../lib/turnstile';
import { isDeveloperSideCreator, withAgent } from '../lib/agents';
import { claimReport, releaseReport, ServiceError, workState, writeHandoff, type TeamContext } from '../lib/team';
import { discardDraft, draftsForReport, findDraft, sendDraft, updateDraft, type DraftView, type MessageDraft } from '../lib/drafts';
import { clientNotifications, teamNotifications, type Notifications } from '../lib/notifications';

export const web = new Hono<AppEnv>();

const PER_PAGE = 50;
/** Column sorts; anything else (including the old latest_message_at links) is the default 'conversation' order. */
/** 分類篩選的「未分類」：沒有分類的舊單。 */
const UNCATEGORIZED = '_none';

const SORTS = ['title', 'status', 'created_at', 'latest_activity_at'] as const;

async function projectOr404(c: AppContext): Promise<Project> {
    const project = await findProjectBySlug(c.env.DB, c.req.param('slug') ?? '');
    if (!project) {
        abort(404);
    }
    return project;
}

async function reportOr404(c: AppContext, project: Project): Promise<Report> {
    const report = await findReportInProject(c.env.DB, project.id, c.req.param('publicId') ?? '');
    if (!report) {
        abort(404);
    }
    return report;
}

/** Visitors without project access go to the login page; signed-in visitors lacking the role get 403. */
async function deny(c: AppContext, project: Project, intended?: string): Promise<Response> {
    const access = c.get('access');
    if ((await access.canManage(project)) || wantsJson(c)) {
        abort(403);
    }
    await access.setIntendedUrl(intended ?? (c.req.method === 'GET' ? currentPathWithQuery(c) : paths.portal(project.slug)));
    return c.redirect(paths.login(project.slug), 302);
}

/** Laravel throttle:N,1 keyed by IP. */
async function throttle(c: AppContext, name: string, max: number, period = 60): Promise<void> {
    const retryAfter = await attempt(c.env.DB, [{ key: `${name}|${clientIp(c.req.raw)}`, max, period }], c.get('now'));
    if (retryAfter !== null) {
        abort(429, '', { 'Retry-After': String(retryAfter) });
    }
}

/** The viewer side in ETags: the team, one client account, or the shared client side. */
function viewerKey(isOwner: boolean, viewer: ClientViewer): string {
    return isOwner ? 'owner' : viewer ? `client:${viewer.id}` : 'client';
}

/** Creator shown on the report page and its dialogs: account names for team and client accounts. */
async function reportCreatorLabel(c: AppContext, project: Project, report: Report): Promise<string> {
    const [developer, account] = await Promise.all([
        report.creator_type === 'developer' && report.creator_developer_id ? findDeveloper(c.env.DB, report.creator_developer_id) : Promise.resolve(null),
        report.creator_type === 'client' && report.creator_client_account_id ? findClientAccount(c.env.DB, report.creator_client_account_id) : Promise.resolve(null),
    ]);
    return withAgent(creatorLabel(c.env, report, project, developer?.name ?? null, account?.name ?? null), report.creator_agent, isDeveloperSideCreator(report.creator_type));
}

function attachmentUrlFor(project: Project, report: Report) {
    return (attachment: Attachment) => paths.attachment(project.slug, report.public_id, attachment.id);
}

/** The project the home page collects public reports into, when both switches are on. */
async function publicProject(c: AppContext): Promise<Project | null> {
    const slug = config(c.env).publicReporting.homeProject;
    if (slug === '') {
        return null;
    }
    const project = await findProjectBySlug(c.env.DB, slug);
    return project && project.public_reporting_enabled === 1 ? project : null;
}

function uploadIds(form: URLSearchParams, name: string): string[] {
    return form.getAll(name).map((id) => id.trim()).filter((id) => id !== '');
}

function validateText(errors: string[], value: string, label: string, max: number, required = true): void {
    if (required && value === '') {
        errors.push(`${label} 為必填。`);
    } else if (charLength(value) > max) {
        errors.push(`${label} 不能超過 ${max} 個字元。`);
    }
}

/**
 * 頁首通知鈴鐺：統一登入的團隊帳號看全部專案；專案的團隊看這個專案；客戶看她在這個專案看得到的單。
 * 沒有登入身分（公開頁、登入頁、單張單的回報者）時回 null，不顯示鈴鐺。
 */
async function bellFor(c: AppContext, project: Project | null): Promise<Notifications | null> {
    const access = c.get('access');
    if (await access.globalDeveloper()) {
        const { results } = await c.env.DB.prepare('SELECT id FROM projects').all<{ id: number }>();
        return teamNotifications(c.env.DB, results.map((row) => row.id));
    }
    if (!project || !(await access.canManage(project))) {
        return null;
    }
    if (await access.isOwner(project)) {
        return teamNotifications(c.env.DB, [project.id]);
    }
    return clientNotifications(c.env.DB, project.id, await access.clientViewer(project));
}

const STALE_UPLOAD_MESSAGE = '截圖上傳已失效或不屬於這裡，請重新選擇檔案。';

// ---------------------------------------------------------------- home & public reporting

web.get('/', async (c) => {
    const v = viewContext(c);
    const project = await publicProject(c);
    if (!project) {
        return c.html(<HomePage v={v} />);
    }
    return c.html(await renderPublicHome(c, project));
});

async function renderPublicHome(c: AppContext, project: Project, form?: PublicFormState) {
    const access = c.get('access');
    const cfg = config(c.env);
    return (
        <PublicHomePage
            v={viewContext(c)}
            project={project}
            myReports={await access.rememberedPublicReports(project)}
            turnstileSiteKey={turnstileEnabled(c.env) ? cfg.publicReporting.turnstileSiteKey : null}
            form={form}
        />
    );
}

function publicSubmitLimits(c: AppContext): Limit[] {
    const cfg = config(c.env).publicReporting;
    const ip = clientIp(c.req.raw);
    return [
        { key: `public-submit-minute|${ip}`, max: cfg.perMinute, period: 60 },
        { key: `public-submit-hour|${ip}`, max: cfg.perHour, period: 3600 },
    ];
}

/** 免登入入口沿用公開回報的限流設定，計數與公開回報分開。 */
function guestSubmitLimits(c: AppContext): Limit[] {
    const cfg = config(c.env).publicReporting;
    const ip = clientIp(c.req.raw);
    return [
        { key: `guest-submit-minute|${ip}`, max: cfg.perMinute, period: 60 },
        { key: `guest-submit-hour|${ip}`, max: cfg.perHour, period: 3600 },
    ];
}

function guestMessageLimits(c: AppContext): Limit[] {
    const cfg = config(c.env).publicReporting;
    const ip = clientIp(c.req.raw);
    return [
        { key: `guest-message-minute|${ip}`, max: cfg.messagePerMinute, period: 60 },
        { key: `guest-message-hour|${ip}`, max: cfg.messagePerHour, period: 3600 },
    ];
}

web.post('/public-reports', async (c) => {
    const project = await publicProject(c);
    if (!project) {
        abort(404);
    }
    const retryAfter = await attempt(c.env.DB, publicSubmitLimits(c), c.get('now'));
    if (retryAfter !== null) {
        abort(429, '', { 'Retry-After': String(retryAfter) });
    }
    const form = await readForm(c);
    if (field(form, HONEYPOT_FIELD) !== '') {
        return c.redirect(paths.home(), 302);
    }

    const title = field(form, 'title');
    const description = field(form, 'description');
    const reporterName = field(form, 'reporter_name');
    const ids = uploadIds(form, 'upload_ids[]');
    const errors: string[] = [];
    validateText(errors, title, '標題', MAX_TITLE);
    validateText(errors, description, '說明', MAX_DESCRIPTION);
    validateText(errors, reporterName, '稱呼', MAX_REPORTER_NAME, false);
    if (ids.length > PUBLIC_MAX_SCREENSHOTS) {
        errors.push(`截圖最多 ${PUBLIC_MAX_SCREENSHOTS} 張。`);
    }
    const uploads = errors.length === 0 ? await findClaimableUploads(c.env.DB, ids, { projectId: project.id, purpose: 'public', reportId: null }) : [];
    if (uploads === null) {
        errors.push(STALE_UPLOAD_MESSAGE);
    }
    if (errors.length === 0 && turnstileEnabled(c.env)) {
        const passed = await verifyTurnstile(c.env, form.get(TURNSTILE_FIELD), clientIp(c.req.raw));
        if (!passed) {
            errors.push('人機驗證沒有通過，請重新驗證後再送出。');
        }
    }
    if (errors.length > 0 || uploads === null) {
        return c.html(await renderPublicHome(c, project, { errors, title, description, reporter_name: reporterName }), 422);
    }

    const { report, reporterToken } = await createReport(
        c.env,
        project,
        { title, description, reporter_name: reporterName !== '' ? reporterName : null, uploads },
        { creator_type: 'public', creator_developer_id: null },
        c.get('now'),
    );
    const access = c.get('access');
    await access.grantReporter(report);
    await access.rememberPublicReport(report, reporterToken);
    access.setFlash({ private_report_url: `${origin(c)}${paths.report(project.slug, report.public_id)}?access=${reporterToken}` });
    return c.redirect(paths.report(project.slug, report.public_id), 302);
});

// ---------------------------------------------------------------- entry links & login

web.get('/p/:slug/access', async (c) => {
    await throttle(c, 'client-access', 10);
    const project = await projectOr404(c);
    const token = c.req.query('token') ?? '';
    if (token === '' || !project.client_token_hash || !timingSafeEqualString(project.client_token_hash, await sha256Hex(token))) {
        abort(403);
    }
    await c.get('access').grantClient(project);
    return c.redirect(paths.portal(project.slug), 302);
});

web.get('/owner/:slug/access', async (c) => {
    await throttle(c, 'owner-access', 10);
    const project = await projectOr404(c);
    const token = c.req.query('token') ?? '';
    if (token === '' || !timingSafeEqualString(project.owner_token_hash, await sha256Hex(token))) {
        abort(403);
    }
    await c.get('access').grantOwner(project);
    return c.redirect(paths.portal(project.slug), 302);
});

web.get('/p/:slug/login', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (await access.canManage(project)) {
        return c.redirect(await access.pullIntendedUrl(paths.portal(project.slug)), 302);
    }
    const prefill = config(c.env).loginPrefill.enabled;
    const flash = await access.flash();
    return c.html(
        <LoginPage
            v={viewContext(c)}
            project={project}
            isOwnerLogin={false}
            username={prefill ? project.login_prefill_username ?? '' : ''}
            password={prefill ? project.login_prefill_password ?? '' : ''}
            success={flash.success}
            showLogout={false}
        />,
    );
});

web.get('/owner/:slug/login', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (await access.isOwner(project)) {
        return c.redirect(await access.pullIntendedUrl(paths.ownerIndex(project.slug)), 302);
    }
    const prefill = config(c.env).loginPrefill;
    return c.html(
        <LoginPage
            v={viewContext(c)}
            project={project}
            isOwnerLogin
            username={prefill.enabled && prefill.ownerEnabled ? prefill.ownerUsername : ''}
            password={prefill.enabled && prefill.ownerEnabled ? prefill.ownerPassword : ''}
            showLogout={await access.canManage(project)}
        />,
    );
});

/** Failed attempts only: account+IP 5/minute, IP 20/minute, IP 50/hour. */
export function loginLimits(username: string, ip: string): Limit[] {
    return [
        { key: `login|${username.toLowerCase()}|${ip}`, max: 5, period: 60 },
        { key: `login-ip|${ip}`, max: 20, period: 60 },
        { key: `login-ip-hourly|${ip}`, max: 50, period: 3600 },
    ];
}

export async function checkLoginRateLimit(c: AppContext, limits: Limit[]): Promise<void> {
    const retryAfter = await tooManyAttempts(c.env.DB, limits, c.get('now'));
    if (retryAfter !== null) {
        abort(429, '', { 'Retry-After': String(retryAfter) });
    }
}

/**
 * Personal team accounts first (owner on every project), then this project's client accounts.
 * Disabled and unknown accounts take the same time and give the same error.
 */
async function authenticate(
    c: AppContext,
    project: Project,
    username: string,
    password: string,
): Promise<{ role: 'owner'; developer: Developer; account: null } | { role: 'client'; developer: null; account: ClientAccount } | null> {
    const found = await findDeveloperByUsername(c.env.DB, username);
    const developer = found && !found.disabled_at ? found : null;
    const foundAccount = found ? null : await findClientAccountInProject(c.env.DB, project.id, username);
    const account = foundAccount && !foundAccount.disabled_at ? foundAccount : null;
    const hash = developer?.password_hash ?? account?.password_hash ?? null;
    const usable = typeof hash === 'string' && hash !== '';
    const matches = await verifyPassword(password, usable ? (hash as string) : DUMMY_PASSWORD_HASH);
    if (!usable || !matches) {
        return null;
    }
    if (developer) {
        return { role: 'owner', developer, account: null };
    }
    return account ? { role: 'client', developer: null, account } : null;
}

web.post('/p/:slug/login', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    const form = await readForm(c);
    const username = field(form, 'username');
    const password = form.get('password') ?? '';
    const isOwnerLogin = form.get('login_page') === 'owner';
    const rerender = (error: string, status: 422 = 422) =>
        c.html(
            <LoginPage v={viewContext(c)} project={project} isOwnerLogin={isOwnerLogin} username={username} password="" error={error} showLogout={false} />,
            status,
        );
    if (username === '') {
        return rerender('帳號 為必填。');
    }
    if (charLength(username) > 50) {
        return rerender('帳號 不能超過 50 個字元。');
    }
    if (password === '') {
        return rerender('密碼 為必填。');
    }
    if (charLength(password) > 200) {
        return rerender('密碼 不能超過 200 個字元。');
    }
    const limits = loginLimits(username, clientIp(c.req.raw));
    await checkLoginRateLimit(c, limits);

    const result = await authenticate(c, project, username, password);
    if (!result) {
        await hit(c.env.DB, limits, c.get('now'));
        return rerender('帳號或密碼錯誤。');
    }
    await clear(c.env.DB, limits[0], c.get('now'));
    if (result.role === 'owner') {
        await access.grantDeveloper(project, result.developer);
    } else {
        await access.grantClientAccount(project, result.account);
    }
    return c.redirect(await access.pullIntendedUrl(paths.portal(project.slug)), 302);
});

web.post('/p/:slug/logout', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    await access.revoke(project);
    access.setFlash({ success: '已登出。' });
    return c.redirect(paths.login(project.slug), 302);
});

// ---------------------------------------------------------------- global owner login & projects

web.get('/login', (c) => c.redirect(paths.ownerGlobalLogin(), 302));

web.get('/owner', async (c) => {
    const access = c.get('access');
    const developer = await access.globalDeveloper();
    if (developer) {
        return c.redirect(paths.ownerProjects(), 302);
    }
    return c.redirect(paths.ownerGlobalLogin(), 302);
});

web.get('/owner/login', async (c) => {
    const access = c.get('access');
    const developer = await access.globalDeveloper();
    if (developer) {
        return c.redirect(paths.ownerProjects(), 302);
    }
    const flash = await access.flash();
    return c.html(<GlobalLoginPage v={viewContext(c)} username="" success={flash.success} />);
});

web.post('/owner/login', async (c) => {
    const access = c.get('access');
    const form = await readForm(c);
    const username = field(form, 'username');
    const password = form.get('password') ?? '';

    const rerender = (error: string, status: 422 = 422) =>
        c.html(<GlobalLoginPage v={viewContext(c)} username={username} error={error} />, status);

    if (username === '') {
        return rerender('帳號 為必填。');
    }
    if (charLength(username) > 50) {
        return rerender('帳號 不能超過 50 個字元。');
    }
    if (password === '') {
        return rerender('密碼 為必填。');
    }
    if (charLength(password) > 200) {
        return rerender('密碼 不能超過 200 個字元。');
    }

    const limits = loginLimits(username, clientIp(c.req.raw));
    await checkLoginRateLimit(c, limits);

    const developer = await findDeveloperByUsername(c.env.DB, username);
    const usable = developer && !developer.disabled_at && developer.password_hash !== '';
    const matches = await verifyPassword(password, usable ? developer.password_hash : DUMMY_PASSWORD_HASH);
    if (!usable || !matches) {
        await hit(c.env.DB, limits, c.get('now'));
        return rerender('帳號或密碼錯誤。');
    }

    await clear(c.env.DB, limits[0], c.get('now'));
    await access.grantGlobalDeveloper(developer);

    const projects = await listProjects(c.env.DB);
    const fallback = projects.length === 1 ? paths.ownerIndex(projects[0].slug) : paths.ownerProjects();
    return c.redirect(await access.pullIntendedUrl(fallback), 302);
});

web.post('/owner/logout', async (c) => {
    const access = c.get('access');
    await access.revokeGlobalDeveloper();
    access.setFlash({ success: '已登出。' });
    return c.redirect(paths.ownerGlobalLogin(), 302);
});

web.get('/owner/projects', async (c) => {
    const access = c.get('access');
    const developer = await access.globalDeveloper();
    if (!developer) {
        await access.setIntendedUrl(paths.ownerProjects());
        return c.redirect(paths.ownerGlobalLogin(), 302);
    }
    const projects = await listProjects(c.env.DB);
    const flash = await access.flash();
    const bell = await teamNotifications(c.env.DB, projects.map((project) => project.id));
    return c.html(<ProjectsOverviewPage v={viewContext(c)} developer={developer} projects={projects} success={flash.success} bell={bell} />);
});

web.get('/owner/:slug', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.isOwner(project))) {
        if (wantsJson(c)) {
            abort(403);
        }
        await access.setIntendedUrl(currentPathWithQuery(c));
        return c.redirect(paths.ownerLogin(project.slug), 302);
    }
    const status = c.req.query('status');
    return c.redirect(status ? `${paths.portal(project.slug)}?status=${encodeURIComponent(status)}` : paths.portal(project.slug), 302);
});

// ---------------------------------------------------------------- portal

async function renderPortal(c: AppContext, project: Project, form?: PortalFormState, status: 200 | 422 = 200): Promise<Response> {
    const access = c.get('access');
    const isOwner = await access.isOwner(project);
    const viewer = await access.clientViewer(project);
    const db = c.env.DB;
    const sortInput = c.req.query('sort') ?? '';
    // Default: the chat panel's order (unread first, then by the newest message).
    const sort = (SORTS as readonly string[]).includes(sortInput) ? sortInput : 'conversation';
    const direction: 'asc' | 'desc' = c.req.query('direction') === 'asc' ? 'asc' : 'desc';
    const statusInput = c.req.query('status') ?? '';
    const selectedStatus: ReportStatus | null = isStatus(statusInput) ? statusInput : null;
    // 頁籤直接對應狀態：舊網址帶 status= 時照舊只用狀態篩選、不套頁籤；否則團隊預設「等工程師」（new）、客戶預設「等客戶」（needs_input）。
    const tabInput = c.req.query('tab') ?? '';
    // 編輯失敗重新顯示時用「全部」，被編輯的單一定在畫面上，對話框才能帶著錯誤重開。
    const defaultTab: PortalTab = form?.bag === 'editReport' ? 'all' : isOwner ? 'developer' : 'client';
    const selectedTab: PortalTab | null = selectedStatus ? null : (PORTAL_TABS as readonly string[]).includes(tabInput) ? (tabInput as PortalTab) : defaultTab;
    const categories = projectCategories(project);
    const categoryInput = c.req.query('category') ?? '';
    const selectedCategory = categories.length > 0 && (categoryInput === UNCATEGORIZED || categories.includes(categoryInput)) ? categoryInput : '';
    const keyword = charSlice((c.req.query('q') ?? '').trim(), 100);
    const viewMode: 'list' | 'board' = c.req.query('view') === 'board' ? 'board' : 'list';
    const deletedInput = c.req.query('deleted') ?? '';
    const deletedFilter: 'only' | 'hide' | null = isOwner ? (deletedInput === 'only' || deletedInput === 'hide' ? deletedInput : null) : 'hide';
    // Team-side only: the client never filters by (or learns about) the team's unread state.
    const unreadOnly = isOwner && c.req.query('unread') === '1';
    const pageInput = Number.parseInt(c.req.query('page') ?? '1', 10);
    const page = Number.isFinite(pageInput) && pageInput > 1 ? pageInput : 1;

    const developers = isOwner ? await listDevelopers(db) : [];
    const developerNames = new Map(developers.map((developer) => [developer.id, developer.name]));
    const clientAccounts = isOwner ? await listClientAccounts(db, project.id) : [];
    const hasPublic = isOwner
        ? project.public_reporting_enabled === 1 ||
          (await db.prepare("SELECT 1 AS found FROM reports WHERE project_id = ? AND creator_type = 'public' LIMIT 1").bind(project.id).first()) !== null
        : false;
    const creatorOptions: Array<[string, string]> = [];
    if (isOwner) {
        creatorOptions.push(['client', clientLabel(c.env, project)]);
        for (const account of clientAccounts) {
            creatorOptions.push([`client:${account.id}`, `${clientLabel(c.env, project)}：${account.name}`]);
        }
        for (const developer of developers) {
            creatorOptions.push([`developer:${developer.id}`, developer.name]);
        }
        if (hasPublic) {
            creatorOptions.push(['public', '公開回報']);
        }
        creatorOptions.push(['shared', `${config(c.env).labels.owner}（共用）`]);
    }
    const creatorInput = isOwner ? c.req.query('creator') ?? '' : '';
    const creator = creatorOptions.some(([value]) => value === creatorInput) ? creatorInput : '';

    const filters: string[] = [];
    const bindings: unknown[] = [];
    if (creator === 'client') {
        filters.push("creator_type = 'client'");
    } else if (creator.startsWith('client:')) {
        filters.push("creator_type = 'client' AND creator_client_account_id = ?");
        bindings.push(Number(creator.slice('client:'.length)));
    } else if (creator === 'public') {
        filters.push("creator_type = 'public'");
    } else if (creator === 'shared') {
        filters.push("creator_type = 'owner_shared'");
    } else if (creator.startsWith('developer:')) {
        filters.push("creator_type = 'developer' AND creator_developer_id = ?");
        bindings.push(Number(creator.slice('developer:'.length)));
    }
    if (selectedStatus) {
        filters.push('status = ?');
        bindings.push(selectedStatus);
    }
    if (selectedTab === 'developer' || selectedTab === 'client') {
        filters.push('waiting = ?');
        bindings.push(selectedTab);
    } else if (selectedTab === 'completed') {
        filters.push("status = 'completed'");
    }
    if (selectedCategory === UNCATEGORIZED) {
        filters.push("(category IS NULL OR category = '')");
    } else if (selectedCategory !== '') {
        filters.push('category = ?');
        bindings.push(selectedCategory);
    }
    if (keyword !== '') {
        filters.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
        bindings.push(likeContains(keyword), likeContains(keyword));
    }
    if (unreadOnly) {
        filters.push(hasUnreadMessagesSql('numbered'));
    }
    if (deletedFilter === 'hide') {
        filters.push('client_deleted_at IS NULL');
    } else if (deletedFilter === 'only') {
        filters.push('client_deleted_at IS NOT NULL');
    }
    const clientOnly = isOwner ? '' : `AND ${CLIENT_VISIBLE_SQL}`;
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const orderBy =
        sort === 'conversation'
            ? `${statusPriorityOrderSql('status', isOwner)}, ${conversationOrderSql({ unread: 'unread_count', messagesCount: 'messages_count', latestMessageAt: 'latest_message_at', createdAt: 'created_at', number: 'seq' })}`
            : `${sort} ${direction}, id ${direction}`;
    const listSql = `WITH numbered AS (
            SELECT *, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS seq, ${waitingSideSql('reports')} AS waiting${isOwner ? '' : `, ${viewerReadAtColumnSql('reports', viewer)}`} FROM reports WHERE project_id = ? ${clientOnly}
        )
        SELECT * FROM (
            SELECT id, project_id, waiting, public_id, reporter_name, creator_type, creator_developer_id, creator_client_account_id, creator_agent, title, status, client_deleted_at,
                latest_activity_at, created_at, seq, COUNT(*) OVER () AS filtered_total, ${latestMessageSql('numbered')} AS latest_message_at,
                ${viewerUnreadSql('numbered', isOwner, viewer, true)} AS unread_count, ${messagesCountSql('numbered')} AS messages_count,
                ${creatorClientNameSql('numbered')} AS creator_client_name
            FROM numbered ${where}
        ) listed
        ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const totalSql = isOwner
        ? 'SELECT COUNT(*) AS total FROM reports WHERE project_id = ?'
        : `SELECT COUNT(*) AS total FROM reports WHERE project_id = ? AND ${CLIENT_VISIBLE_SQL} AND client_deleted_at IS NULL`;
    const countConditions = isOwner ? '' : `AND ${CLIENT_VISIBLE_SQL} AND client_deleted_at IS NULL`;
    const [list, total, counts, unread, tabRows] = await db.batch([
        db.prepare(listSql).bind(project.id, ...bindings, PER_PAGE, (page - 1) * PER_PAGE),
        db.prepare(totalSql).bind(project.id),
        db.prepare(`SELECT status, COUNT(*) AS aggregate FROM reports WHERE project_id = ? ${countConditions} GROUP BY status`).bind(project.id),
        isOwner ? db.prepare(`SELECT COUNT(*) AS total FROM reports WHERE project_id = ? AND ${hasUnreadMessagesSql('reports')}`).bind(project.id) : db.prepare('SELECT 0 AS total'),
        db.prepare(`SELECT ${waitingSideSql('reports')} AS waiting, COUNT(*) AS aggregate FROM reports WHERE project_id = ? ${countConditions} GROUP BY 1`).bind(project.id),
    ]);
    const tabCounts: Record<PortalTab, number> = { developer: 0, client: 0, completed: 0, all: 0 };
    for (const row of tabRows.results as Array<{ waiting: WaitingSide; aggregate: number }>) {
        tabCounts[row.waiting] += row.aggregate;
        tabCounts.all += row.aggregate;
    }
    const reports = list.results as Array<Report & { seq: number; filtered_total: number; unread_count: number; messages_count: number; creator_client_name: string | null; waiting: WaitingSide }>;
    let filteredTotal = reports[0]?.filtered_total ?? 0;
    if (reports.length === 0 && page > 1) {
        const row = await db
            .prepare(`WITH numbered AS (SELECT *, ${waitingSideSql('reports')} AS waiting FROM reports WHERE project_id = ? ${clientOnly}) SELECT COUNT(*) AS total FROM numbered ${where}`)
            .bind(project.id, ...bindings)
            .first<{ total: number }>();
        filteredTotal = row?.total ?? 0;
    }
    const statusCountMap = Object.fromEntries(STATUSES.map((value) => [value, 0])) as Record<ReportStatus, number>;
    for (const row of counts.results as Array<{ status: string; aggregate: number }>) {
        if (isStatus(row.status)) {
            statusCountMap[row.status] = row.aggregate;
        }
    }

    // 清單只有編號、標題、狀態、建立者、最後更新：不載入附件與待審留言數。
    const rows: PortalRow[] = reports.map((report) => ({
        report,
        number: report.seq,
        creatorLabel: withAgent(creatorLabel(c.env, report, project, report.creator_developer_id ? developerNames.get(report.creator_developer_id) ?? null : null, report.creator_client_name), report.creator_agent, isDeveloperSideCreator(report.creator_type)),
        unread: report.unread_count,
    }));
    // 編輯失敗重新顯示：被編輯的那張單要帶著錯誤重開對話框，所以只為它載入附件。
    const editingReport = form?.bag === 'editReport' ? reports.find((report) => report.public_id === form.editing?.publicId) : undefined;
    const editingRow = editingReport ? await dialogRow(c, project, editingReport, isOwner) : undefined;
    const flash = form ? {} : await access.flash();
    const allProjects = isOwner ? await listProjects(c.env.DB) : undefined;
    const bell = await bellFor(c, project);

    return c.html(
        <PortalPage
            v={viewContext(c)}
            project={project}
            projects={allProjects}
            isOwner={isOwner}
            rows={rows}
            totalCount={(total.results[0] as { total: number }).total}
            filteredTotal={filteredTotal}
            statusCounts={statusCountMap}
            sort={sort}
            direction={direction}
            selectedStatus={selectedStatus}
            selectedTab={selectedTab}
            tabCounts={tabCounts}
            selectedCategory={selectedCategory}
            keyword={keyword}
            viewMode={viewMode}
            deletedFilter={deletedFilter}
            unreadOnly={unreadOnly}
            unreadReportCount={isOwner ? (unread.results[0] as { total: number }).total : 0}
            creator={creator}
            creatorOptions={creatorOptions}
            page={page}
            lastPage={Math.max(1, Math.ceil(filteredTotal / PER_PAGE))}
            backPath={form ? paths.portal(project.slug) : currentPathWithQuery(c)}
            success={flash.success}
            passwordLink={await access.hasPasswordAccount(project)}
            guest={await access.isGuest(project)}
            form={form}
            editingRow={editingRow}
            bell={bell}
        />,
        status,
    );
}

web.get('/p/:slug', async (c) => {
    const project = await projectOr404(c);
    if (!(await c.get('access').canManage(project))) {
        return deny(c, project);
    }
    return renderPortal(c, project);
});

interface IssueInput {
    title: string;
    description: string;
    category: string;
    uploadIds: string[];
}

function parseIssues(form: URLSearchParams): IssueInput[] {
    const issues = new Map<string, IssueInput>();
    for (const [key, value] of form.entries()) {
        const match = /^issues\[([^\]]+)\]\[(title|description|category|upload_ids)\](\[\])?$/.exec(key);
        if (!match) {
            continue;
        }
        const issue = issues.get(match[1]) ?? { title: '', description: '', category: '', uploadIds: [] };
        if (match[2] === 'upload_ids') {
            if (value.trim() !== '') {
                issue.uploadIds.push(value.trim());
            }
        } else {
            issue[match[2] as 'title' | 'description' | 'category'] = value.trim();
        }
        issues.set(match[1], issue);
    }
    return [...issues.values()];
}

web.post('/p/:slug/reports', async (c) => {
    await throttle(c, 'reports-store', 10);
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    const isGuest = await access.isGuest(project);
    if (isGuest) {
        const retryAfter = await attempt(c.env.DB, guestSubmitLimits(c), c.get('now'));
        if (retryAfter !== null) {
            abort(429, '', { 'Retry-After': String(retryAfter) });
        }
    }
    const form = await readForm(c);
    const issues = parseIssues(form);
    const errors: string[] = [];
    const categories = projectCategories(project);
    if (isGuest && field(form, HONEYPOT_FIELD) !== '') {
        errors.push('送出失敗，請重新整理頁面後再試。');
    }
    if (issues.length === 0) {
        errors.push('問題 為必填。');
    } else if (issues.length > 20) {
        errors.push('問題 最多只能有 20 項。');
    }
    const claimed: Array<Awaited<ReturnType<typeof findClaimableUploads>>> = [];
    for (const issue of issues.slice(0, 20)) {
        validateText(errors, issue.title, '問題標題', MAX_TITLE);
        validateText(errors, issue.description, '問題說明', MAX_DESCRIPTION);
        if (categories.length > 0 && !categories.includes(issue.category)) {
            errors.push(issue.category === '' ? '分類 為必填。' : '選擇的分類無效。');
        }
        if (issue.uploadIds.length > MAX_SCREENSHOTS) {
            errors.push(`截圖 最多只能有 ${MAX_SCREENSHOTS} 項。`);
        }
    }
    if (errors.length === 0) {
        for (const issue of issues) {
            const uploads = await findClaimableUploads(c.env.DB, issue.uploadIds, { projectId: project.id, purpose: 'report', reportId: null });
            if (uploads === null) {
                errors.push(STALE_UPLOAD_MESSAGE);
                break;
            }
            claimed.push(uploads);
        }
        const allIds = issues.flatMap((issue) => issue.uploadIds);
        if (new Set(allIds).size !== allIds.length) {
            errors.push(STALE_UPLOAD_MESSAGE);
        }
    }
    if (errors.length === 0 && isGuest && turnstileEnabled(c.env)) {
        const passed = await verifyTurnstile(c.env, form.get(TURNSTILE_FIELD), clientIp(c.req.raw));
        if (!passed) {
            errors.push('人機驗證沒有通過，請重新驗證後再送出。');
        }
    }
    if (errors.length > 0) {
        return renderPortal(c, project, { bag: 'default', errors: [...new Set(errors)], issues: issues.map(({ title, description, category }) => ({ title, description, category })) }, 422);
    }
    const creator = await access.creatorFor(project);
    const author = await access.author(project);
    for (let i = 0; i < issues.length; i++) {
        const { report } = await createReport(c.env, project, { title: issues[i].title, description: issues[i].description, category: categories.length > 0 ? issues[i].category : null, uploads: claimed[i] ?? [], author }, creator, c.get('now'));
        await access.grantReporter(report);
    }
    access.setFlash({ success: `已新增 ${issues.length} 個問題。` });
    return c.redirect(paths.portal(project.slug), 302);
});

// ---------------------------------------------------------------- uploads (one file per request)

web.put('/p/:slug/uploads', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    const purpose = c.req.query('purpose') ?? '';
    const reportPublicId = c.req.query('report') ?? '';
    let maxBytes = MAX_IMAGE_BYTES;
    let reportId: number | null = null;
    // 留言（含團隊與客戶）另收 mp4 影片；開單、調整重點、公開回報只收圖片。
    let allowVideo = false;
    const ip = clientIp(c.req.raw);
    const publicLimits = (): Limit[] => {
        const cfg = config(c.env).publicReporting;
        return [
            { key: `public-upload-minute|${ip}`, max: cfg.uploadPerMinute, period: 60 },
            { key: `public-upload-hour|${ip}`, max: cfg.uploadPerHour, period: 3600 },
        ];
    };
    let limits: Limit[] = [{ key: `upload|${ip}`, max: 60, period: 60 }];

    if (purpose === 'report') {
        if (!(await access.canManage(project))) {
            abort(403);
        }
    } else if (purpose === 'adjustment') {
        if (!(await access.isOwner(project))) {
            abort(403);
        }
        reportId = (await reportByPublicIdOr404(c, project, reportPublicId)).id;
    } else if (purpose === 'message') {
        const report = await reportByPublicIdOr404(c, project, reportPublicId);
        if (!(await access.canView(project, report)) || !(await access.reportVisible(project, report))) {
            abort(403);
        }
        const isPublicReporter = isPublicReport(report) && !(await access.isOwner(project));
        if (isPublicReporter) {
            if (project.public_reporting_enabled !== 1) {
                abort(403, '這個專案已停止收件，這張單只能查看。');
            }
            maxBytes = PUBLIC_MAX_IMAGE_BYTES;
            limits = publicLimits();
        } else {
            allowVideo = true;
        }
        reportId = report.id;
    } else if (purpose === 'public') {
        const active = await publicProject(c);
        if (!active || active.id !== project.id) {
            abort(404);
        }
        maxBytes = PUBLIC_MAX_IMAGE_BYTES;
        limits = publicLimits();
    } else {
        abort(404);
    }

    const fromPublic = purpose === 'public' || maxBytes === PUBLIC_MAX_IMAGE_BYTES;
    if (fromPublic) {
        // Site-wide cap: strangers together cannot park more than this in storage.
        const cfg = config(c.env).publicReporting;
        const pending = await pendingPublicUploads(c.env.DB);
        const declared = Number(c.req.header('content-length') ?? 0) || 0;
        if (pending.count >= cfg.pendingUploadsMax || pending.bytes + declared > cfg.pendingUploadBytesMax) {
            return c.json({ message: '目前上傳量過多，請稍後再試。' }, 429, { 'Retry-After': '600' });
        }
    }
    const retryAfter = await attempt(c.env.DB, limits, c.get('now'));
    if (retryAfter !== null) {
        return c.json({ message: '上傳次數過多，請稍後再試。' }, 429, { 'Retry-After': String(retryAfter) });
    }
    try {
        const upload = await storeImageStream(c.env, c.req.raw, { projectId: project.id, reportId, purpose, maxBytes, allowVideo, nowIso: nowIso(c.get('now')) });
        if (fromPublic || Math.random() < 0.05) {
            c.executionCtx.waitUntil(pruneStaleUploads(c.env, c.get('now'), 20).catch(() => 0));
        }
        return c.json({ id: upload.id, name: upload.original_name, size: upload.size, mime_type: upload.mime_type }, 201);
    } catch (error) {
        if (error instanceof UploadError) {
            return c.json({ message: error.message }, error.status);
        }
        throw error;
    }
});

/**
 * Changes as often as the relative times ("3分鐘前") of a thread whose newest activity is at
 * `latestIso` can change: every minute within the first hour, every hour within the first day,
 * then daily. Part of the ETags of polled threads, so 304 answers do not freeze those times.
 */
export function relativeTimeBucket(latestIso: string, nowMs: number): string {
    const age = nowMs - Date.parse(latestIso);
    if (age < 3_600_000) {
        return `m${Math.floor(nowMs / 60_000)}`;
    }
    if (age < 86_400_000) {
        return `h${Math.floor(nowMs / 3_600_000)}`;
    }
    return `d${Math.floor(nowMs / 86_400_000)}`;
}

/** The thread shows the viewer's own side on the right, so the side is part of the tag. */
export function activityEtag(report: Pick<Report, 'latest_activity_at' | 'updated_at' | 'status'>, side: string, nowMs: number): string {
    return `W/"${side}|${report.latest_activity_at}|${report.updated_at}|${report.status}|${relativeTimeBucket(report.latest_activity_at, nowMs)}"`;
}

/**
 * One report's thread (messages, status changes, album, drafts) as the viewer sees it. Drafts are only
 * read for the team: the client side never queries them, so neither its HTML nor its JSON can carry them.
 * `knownDrafts` lets a caller that already read them (for its ETag) skip the second query.
 */
async function loadThread(c: AppContext, project: Project, report: Report, isOwner: boolean, knownDrafts?: DraftView[]) {
    const db = c.env.DB;
    const access = c.get('access');
    const v = viewContext(c);
    const [attachments, messages, statusEvents, drafts, canManage] = await Promise.all([
        attachmentsForReport(db, report.id),
        messagesForReport(db, report.id),
        statusEventsForReport(db, report.id),
        isOwner ? (knownDrafts ? Promise.resolve(knownDrafts) : draftsForReport(db, report.id)) : Promise.resolve([] as DraftView[]),
        access.canManage(project),
    ]);
    const messageAttachments = new Map<number, Attachment[]>();
    for (const attachment of attachments) {
        if (attachment.message_id !== null) {
            const list = messageAttachments.get(attachment.message_id) ?? [];
            list.push(attachment);
            messageAttachments.set(attachment.message_id, list);
        }
    }
    const album = albumItems({
        slug: project.slug,
        publicId: report.public_id,
        attachments,
        messages,
        authorLabel: (message) => messageAuthorLabel(v, report, message, isOwner),
        reportCreatedAt: report.created_at,
        drafts: isOwner ? drafts : null,
    });
    return {
        attachments,
        messages,
        messageAttachments,
        statusEvents,
        drafts,
        album,
        // 「通過」只給客戶端（能結案的一方），且單還沒完成。
        canApprove: !isOwner && canManage && report.status !== 'completed',
    };
}

/** ETag side for the single-report thread: the team's side also carries the drafts version (drafts show in the album). */
async function threadSide(c: AppContext, report: Report, isOwner: boolean, viewer: ClientViewer): Promise<string> {
    return isOwner ? `${viewerKey(true, viewer)}|${await draftsVersion(c.env.DB, report.id)}` : viewerKey(false, viewer);
}

async function reportByPublicIdOr404(c: AppContext, project: Project, publicId: string): Promise<Report> {
    const report = publicId === '' ? null : await findReportInProject(c.env.DB, project.id, publicId);
    if (!report) {
        abort(404);
    }
    return report;
}

// ---------------------------------------------------------------- single report

async function renderReport(
    c: AppContext,
    project: Project,
    report: Report,
    extra: { messageErrors?: string[]; messageOld?: string; draftErrors?: { id: number; errors: string[]; old: string } } = {},
    status: 200 | 422 = 200,
): Promise<Response> {
    const access = c.get('access');
    const isOwner = await access.isOwner(project);
    const viewer = await access.clientViewer(project);
    // 待審留言只給開發團隊；客戶端連查都不查（loadThread 只在團隊端讀草稿）。
    const thread = await loadThread(c, project, report, isOwner);
    const isPublic = isPublicReport(report);
    const sequence = isOwner || !isPublic ? await sequenceNumber(c.env.DB, report, !isOwner) : null;
    const hasErrors = (extra.messageErrors?.length ?? 0) > 0 || extra.draftErrors !== undefined;
    const flash = hasErrors ? {} : await access.flash();
    const developer = isOwner ? await access.currentDeveloper(project) : null;
    const work = isOwner ? await workState({ env: c.env, developer, agent: null }, report) : undefined;
    const canManage = await access.canManage(project);
    return c.html(
        <ReportPage
            v={viewContext(c)}
            project={project}
            report={report}
            sequenceNumber={sequence}
            isPublicReporter={isPublic && !isOwner}
            canManage={canManage}
            isOwner={isOwner}
            drafts={thread.drafts}
            bell={canManage ? await bellFor(c, project) : null}
            attachments={thread.attachments.filter((attachment) => attachment.kind === 'feedback' && attachment.message_id === null)}
            adjustmentAttachments={thread.attachments.filter((attachment) => attachment.kind === 'adjustment')}
            messages={thread.messages}
            messageAttachments={thread.messageAttachments}
            statusEvents={thread.statusEvents}
            album={thread.album}
            canApprove={thread.canApprove}
            attachmentUrl={attachmentUrlFor(project, report)}
            success={flash.success}
            privateReportUrl={flash.private_report_url}
            activityEtag={activityEtag(report, await threadSide(c, report, isOwner, viewer), c.get('now'))}
            creatorLabel={await reportCreatorLabel(c, project, report)}
            categories={projectCategories(project)}
            work={work}
            canClaim={developer !== null}
            {...extra}
        />,
        status,
    );
}

web.get('/p/:slug/reports/:publicId', async (c) => {
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!isPublicReport(report) && !(await access.reportVisible(project, report))) {
        abort(404);
    }
    const token = c.req.query('access') ?? '';
    if (token !== '' && (await access.validateReporterToken(report, token))) {
        await access.grantReporter(report);
        if (isPublicReport(report)) {
            await access.rememberPublicReport(report, token);
        }
        return c.redirect(paths.report(project.slug, report.public_id), 302);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    if (!(await access.canView(project, report))) {
        return deny(c, project);
    }
    // Opening the report marks it read first, so the header bell does not list the report being read.
    await markRead(c.env, report, (await access.isOwner(project)) ? 'owner' : 'client', c.get('now'), await access.clientViewer(project));
    return renderReport(c, project, report);
});

web.get('/p/:slug/reports/:publicId/activity', async (c) => {
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canView(project, report))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    // Every change shown here (messages, status) moves latest_activity_at or updated_at, so the pair
    // identifies the content (the team's side adds the drafts version: drafts show in the album);
    // an unchanged report answers 304 without loading messages.
    const isOwner = await access.isOwner(project);
    const viewer = await access.clientViewer(project);
    const etag = activityEtag(report, await threadSide(c, report, isOwner, viewer), c.get('now'));
    const cacheHeaders = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    if (c.req.header('if-none-match') === etag) {
        return c.body(null, 304, cacheHeaders);
    }
    const thread = await loadThread(c, project, report, isOwner);
    // A 304 means nothing new since the last fetch, which already marked the report read.
    await markRead(c.env, report, isOwner ? 'owner' : 'client', c.get('now'), viewer);
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    return c.html(
        <Thread
            v={viewContext(c)}
            slug={project.slug}
            report={report}
            messages={thread.messages}
            messageAttachments={thread.messageAttachments}
            attachmentUrl={attachmentUrlFor(project, report)}
            viewerIsOwner={isOwner}
            statusEvents={thread.statusEvents}
            canApprove={thread.canApprove}
            album={thread.album}
        />,
    );
});

// ---------------------------------------------------------------- chat panel

/** Longest message text read for a list preview; the preview itself is cut to 60 columns. */
const PREVIEW_SOURCE_CHARS = 300;

/**
 * Conversations of the project for the bottom-right chat panel, in the shared default order. Only
 * project members (team and client) get it; single-report and public reporters do not. Listing
 * never marks anything read.
 *
 * The panel polls this. The project's chat version of this side (moved by database triggers on every
 * change to its reports and messages, loaded with the project anyway) plus today's date for the time labels
 * answer 304 without reading the reports, which keeps D1 reads low on the free plan.
 */
web.get('/p/:slug/conversations', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    const isOwner = await access.isOwner(project);
    const viewer = await access.clientViewer(project);
    const db = c.env.DB;
    const now = c.get('now');
    const cfg = config(c.env);
    const scope = isOwner ? '' : `AND ${CLIENT_VISIBLE_SQL}`;
    const today = formatAbsolute(nowIso(now), cfg.utcOffsetMinutes).slice(0, 10);
    const etag = `W/"conv|${viewerKey(isOwner, viewer)}|${isOwner ? project.chat_version_owner : project.chat_version_client}|${today}"`;
    const cacheHeaders = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    if (c.req.header('if-none-match') === etag) {
        return c.body(null, 304, cacheHeaders);
    }

    const latest = (column: string) => `(SELECT ${column} FROM messages lm2 WHERE lm2.report_id = numbered.id ORDER BY lm2.created_at DESC, lm2.id DESC LIMIT 1)`;
    const { results } = await db
        .prepare(
            `WITH numbered AS (
                SELECT *, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS seq${isOwner ? '' : `, ${viewerReadAtColumnSql('reports', viewer)}`} FROM reports WHERE project_id = ? ${scope}
            )
            SELECT * FROM (
                SELECT public_id, title, status, client_deleted_at, created_at, seq,
                    ${latestMessageSql('numbered')} AS latest_message_at,
                    ${viewerUnreadSql('numbered', isOwner, viewer, true)} AS unread_count,
                    ${messagesCountSql('numbered')} AS messages_count,
                    ${isOwner ? '0' : adjustmentNewForClientSql('numbered', viewer, true)} AS adjustment_updated,
                    creator_type, creator_developer_id, creator_agent, reporter_name, ${creatorClientNameSql('numbered')} AS creator_client_name,
                    (SELECT d.name FROM developers d WHERE d.id = numbered.creator_developer_id) AS creator_developer_name,
                    ${latest(`substr(lm2.body, 1, ${PREVIEW_SOURCE_CHARS})`)} AS latest_body,
                    ${latest('lm2.author_type')} AS latest_author${isOwner ? ', (SELECT COUNT(*) FROM message_drafts md WHERE md.report_id = numbered.id) AS drafts_count' : ''}
                FROM numbered ${isOwner ? '' : 'WHERE client_deleted_at IS NULL'}
            ) listed
            ORDER BY ${conversationOrderSql({ unread: 'unread_count', messagesCount: 'messages_count', latestMessageAt: 'latest_message_at', createdAt: 'created_at', number: 'seq' })}`,
        )
        .bind(project.id)
        .all<Pick<Report, 'public_id' | 'title' | 'status' | 'client_deleted_at' | 'created_at' | 'creator_type' | 'reporter_name' | 'creator_agent'> & {
            creator_client_name: string | null;
            creator_developer_name: string | null;
            seq: number;
            latest_message_at: string | null;
            unread_count: number;
            messages_count: number;
            adjustment_updated: number;
            latest_body: string | null;
            latest_author: Message['author_type'] | null;
            /** Team side only. */
            drafts_count?: number;
        }>();
    let unreadTotal = 0;
    let awaitingTotal = 0;
    let draftsTotal = 0;
    const items = results.map((row) => {
        const adjustmentUpdated = row.adjustment_updated === 1;
        unreadTotal += row.unread_count;
        // 只看正式留言：待審留言（草稿）在另一張表，不算回覆。團隊端還有沒送出的草稿也算未回覆（面板會彈出提醒）。
        const drafts = isOwner ? row.drafts_count ?? 0 : 0;
        const awaitingReply = isAwaitingReply(row.status, row.latest_author, row.creator_type, isOwner) || drafts > 0;
        awaitingTotal += awaitingReply ? 1 : 0;
        draftsTotal += drafts;
        return {
            id: row.public_id,
            number: row.seq,
            title: row.title,
            status: statusLabel(row.status, cfg.statusLabels),
            deleted: row.client_deleted_at !== null,
            preview: row.latest_body !== null ? messagePreview(row.latest_body) : null,
            preview_is_mine: row.latest_author !== null && (row.latest_author !== 'reporter') === isOwner,
            latest_at: row.latest_message_at,
            latest_label: row.latest_message_at !== null ? shortTime(row.latest_message_at, now, cfg.utcOffsetMinutes) : null,
            created_at: row.created_at,
            unread: row.unread_count,
            adjustment_updated: adjustmentUpdated,
            has_update: row.unread_count > 0 || adjustmentUpdated,
            awaiting_reply: awaitingReply,
            // 待審留言數只給開發團隊；客戶端沒有這個欄位。
            ...(isOwner ? { drafts_count: drafts } : {}),
            messages_count: row.messages_count,
            creator: withAgent(creatorLabel(c.env, row, project, row.creator_developer_name, row.creator_client_name), row.creator_agent, isDeveloperSideCreator(row.creator_type)),
            thread_url: paths.conversation(project.slug, row.public_id),
            page_url: paths.report(project.slug, row.public_id),
        };
    });
    return c.json({ items, unread_total: unreadTotal, awaiting_total: awaitingTotal, ...(isOwner ? { drafts_total: draftsTotal } : {}) }, 200, cacheHeaders);
});

/** Version of a report's drafts for the team's thread ETag; '' without drafts. */
async function draftsVersion(db: D1Database, reportId: number): Promise<string> {
    const row = await db
        .prepare('SELECT COUNT(*) AS total, MAX(id) AS last_id, MAX(updated_at) AS last_update FROM message_drafts WHERE report_id = ?')
        .bind(reportId)
        .first<{ total: number; last_id: number | null; last_update: string | null }>();
    return row && row.total > 0 ? `${row.total}.${row.last_id}.${row.last_update}` : '';
}

/**
 * One conversation for the chat panel: the adjustment and the messages as server-rendered (escaped)
 * HTML. Opening it, and each refresh while it is open, marks it read for the viewer's side. An
 * unchanged report answers 304 without loading messages (that earlier answer already marked it read).
 */
web.get('/p/:slug/conversations/:publicId', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    const report = await reportOr404(c, project);
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const isOwner = await access.isOwner(project);
    const viewer = await access.clientViewer(project);
    const db = c.env.DB;
    // 待審留言只給開發團隊：草稿不動到單的時間，所以團隊端的 ETag 另外帶草稿的版本（一個小查詢）。
    const draftVersion = isOwner ? await draftsVersion(db, report.id) : '';
    // The list number is left out on purpose (it needs a count over the project); it only shifts when
    // reports are added or removed, and the next full answer picks it up.
    const etag = `W/"thread|${activityEtag(report, viewerKey(isOwner, viewer), c.get('now')).slice(3, -1)}${isOwner ? `|${draftVersion}` : ''}"`;
    const cacheHeaders = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    if (c.req.header('if-none-match') === etag) {
        return c.body(null, 304, cacheHeaders);
    }
    const isPublicReporter = isPublicReport(report) && !isOwner;
    const v = viewContext(c);
    const [thread, number, creator] = await Promise.all([
        loadThread(c, project, report, isOwner, isOwner && draftVersion === '' ? [] : undefined),
        sequenceNumber(db, report, !isOwner),
        reportCreatorLabel(c, project, report),
    ]);
    const html = await (
        <ConversationFragment
            v={v}
            slug={project.slug}
            report={report}
            messages={thread.messages}
            messageAttachments={thread.messageAttachments}
            adjustmentAttachments={thread.attachments.filter((attachment) => attachment.kind === 'adjustment')}
            statusEvents={thread.statusEvents}
            canApprove={thread.canApprove}
            album={thread.album}
            attachmentUrl={attachmentUrlFor(project, report)}
            viewerIsOwner={isOwner}
        />
    ).toString();
    // 詳情視窗右側窄欄（狀態、完成鈕、時間）：留言可能讓狀態改變，跟著對話一起更新。
    const sideHtml = await (<DetailSide v={v} slug={project.slug} report={report} isOwner={isOwner} canManage creatorLabel={isPublicReporter ? null : creator} />).toString();
    // 客戶端面板自動彈出時只「偷看」第一張（peek=1），使用者還沒操作前不標已讀，免得漏看新留言；團隊端照常標已讀。
    if (isOwner || c.req.query('peek') !== '1') {
        await markRead(c.env, report, isOwner ? 'owner' : 'client', c.get('now'), viewer);
    }
    return c.json(
        {
            // 待審留言只給開發團隊：客戶端的回應連 drafts 這個欄位都沒有。
            ...(isOwner ? { drafts_html: thread.drafts.length === 0 ? '' : await (<DraftsSection v={v} slug={project.slug} publicId={report.public_id} drafts={thread.drafts} />).toString() } : {}),
            id: report.public_id,
            number,
            title: report.title,
            status: statusLabel(report.status, config(c.env).statusLabels),
            status_value: report.status,
            side_html: sideHtml,
            deleted: report.client_deleted_at !== null,
            page_url: paths.report(project.slug, report.public_id),
            post_url: paths.reportMessages(project.slug, report.public_id),
            upload_url: `${paths.uploads(project.slug)}?purpose=message&report=${encodeURIComponent(report.public_id)}`,
            max_files: isPublicReporter ? PUBLIC_MAX_SCREENSHOTS : MAX_SCREENSHOTS,
            max_bytes: isPublicReporter ? PUBLIC_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES,
            // 留言另收 mp4 影片（每支 50 MB）；公開回報只收圖片。
            allow_video: !isPublicReporter,
            html,
        },
        200,
        cacheHeaders,
    );
});

/** Detail, edit and delete dialogs of one report, loaded by the portal page when first opened. */
web.get('/p/:slug/reports/:publicId/dialogs', async (c) => {
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const isOwner = await access.isOwner(project);
    const back = c.req.query('back') ?? '';
    const row = await dialogRow(c, project, report, isOwner);
    return c.html(
        <ReportDialogs
            v={viewContext(c)}
            row={row}
            slug={project.slug}
            isOwner={isOwner}
            backPath={isSafeLocalPath(back) ? back : paths.portal(project.slug)}
            attachmentUrl={(target, attachment) => paths.attachment(project.slug, target.public_id, attachment.id)}
            categories={projectCategories(project)}
        />,
    );
});

/** The data one report's dialogs need: its list number, creator, unread count and attachments. */
async function dialogRow(c: AppContext, project: Project, report: Report, isOwner: boolean): Promise<DialogRow> {
    const [attachments, number, label, counts] = await Promise.all([
        c.env.DB.prepare('SELECT * FROM attachments WHERE report_id = ? AND message_id IS NULL ORDER BY id').bind(report.id).all<Attachment>(),
        sequenceNumber(c.env.DB, report, !isOwner),
        reportCreatorLabel(c, project, report),
        chatCounts(c.env.DB, report, isOwner, await c.get('access').clientViewer(project)),
    ]);
    return {
        report,
        number,
        creatorLabel: label,
        attachments: attachments.results.filter((attachment) => attachment.kind === 'feedback'),
        adjustmentAttachments: attachments.results.filter((attachment) => attachment.kind === 'adjustment'),
        unread: counts.unread,
    };
}

web.get('/p/:slug/reports/:publicId/attachments/:attachmentId', async (c) => {
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const attachment = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND report_id = ?')
        .bind(Number(c.req.param('attachmentId')) || 0, report.id)
        .first<Attachment>();
    if (!attachment) {
        abort(404);
    }
    const access = c.get('access');
    if (!(await access.canView(project, report))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    return streamAttachment(c, attachment);
});

/**
 * One byte range from a Range header (`bytes=a-b`, `bytes=a-`, `bytes=-n`). Anything else (several
 * ranges, other units, junk) is ignored and the whole file is sent; a start past the end is 'unsatisfiable'.
 */
export function parseByteRange(header: string | undefined, size: number): { offset: number; length: number } | 'unsatisfiable' | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
    if (!match || (match[1] === '' && match[2] === '') || size <= 0) {
        return null;
    }
    if (match[1] === '') {
        const suffix = Number(match[2]);
        if (suffix === 0) {
            return 'unsatisfiable';
        }
        const length = Math.min(suffix, size);
        return { offset: size - length, length };
    }
    const start = Number(match[1]);
    const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (start >= size) {
        return 'unsatisfiable';
    }
    if (end < start) {
        return null;
    }
    return { offset: start, length: end - start + 1 };
}

/**
 * Streams an attachment from R2. Range requests get 206 with only that slice read from R2, so a video
 * player can seek (and Safari plays mp4 at all) without the Worker holding the file in memory.
 */
export async function streamAttachment(c: AppContext, attachment: Attachment, cacheControl = 'private, max-age=3600'): Promise<Response> {
    const headers: Record<string, string> = {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': cacheControl,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Accept-Ranges': 'bytes',
    };
    const range = parseByteRange(c.req.header('range'), attachment.size);
    if (range === 'unsatisfiable') {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${attachment.size}` } });
    }
    const object = await c.env.FILES.get(attachment.object_key, range ? { range } : undefined);
    if (!object) {
        abort(404);
    }
    if (range) {
        return new Response(object.body, {
            status: 206,
            headers: { ...headers, 'Content-Length': String(range.length), 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}` },
        });
    }
    return new Response(object.body, { headers: { ...headers, 'Content-Length': String(object.size) } });
}

web.post('/p/:slug/reports/:publicId/update', async (c) => {
    await throttle(c, 'reports-update', 30);
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const form = await readForm(c);
    const title = field(form, 'title');
    const description = field(form, 'description');
    const ids = uploadIds(form, 'upload_ids[]');
    const removeInput = form.getAll('remove_attachments[]');
    const remove = removeInput.map((value) => Number(value));
    const errors: string[] = [];
    validateText(errors, title, '問題標題', MAX_TITLE);
    validateText(errors, description, '問題說明', MAX_DESCRIPTION);
    const configuredCategories = projectCategories(project);
    const categoryOptions = configuredCategories.length > 0 ? editCategoryOptions(configuredCategories, report.category) : [];
    const category = field(form, 'category');
    if (categoryOptions.length > 0 && category !== '' && !categoryOptions.includes(category)) {
        errors.push('選擇的分類無效。');
    }
    if (ids.length > MAX_SCREENSHOTS) {
        errors.push(`截圖 最多只能有 ${MAX_SCREENSHOTS} 項。`);
    }
    let uploads: Awaited<ReturnType<typeof findClaimableUploads>> = [];
    if (errors.length === 0) {
        if (remove.some((id) => !Number.isInteger(id))) {
            errors.push('要刪除的截圖 必須是整數。');
        } else {
            const removable = await countRemovable(c.env.DB, report.id, remove, 'feedback');
            if (!removable.valid) {
                errors.push('選擇的 要刪除的截圖 無效。');
            } else if (removable.remaining + ids.length > MAX_SCREENSHOTS) {
                errors.push(`截圖總數不可超過 ${MAX_SCREENSHOTS} 張。`);
            }
        }
        uploads = await findClaimableUploads(c.env.DB, ids, { projectId: project.id, purpose: 'report', reportId: null });
        if (uploads === null) {
            errors.push(STALE_UPLOAD_MESSAGE);
        }
    }
    if (errors.length > 0 || uploads === null) {
        return renderPortal(c, project, { bag: 'editReport', errors, editing: { publicId: report.public_id, title, description, category, remove: removeInput } }, 422);
    }
    await updateReport(c.env, report, { title, description, category: categoryOptions.length > 0 ? (category === '' ? null : category) : undefined, uploads, removeAttachmentIds: remove, author: await access.author(project) }, c.get('now'));
    access.setFlash({ success: `已更新「${title}」。` });
    return c.redirect(backUrl(c, form, paths.portal(project.slug)), 302);
});

web.post('/p/:slug/reports/:publicId/delete', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.isOwner(project))) {
        return deny(c, project);
    }
    const report = await reportOr404(c, project);
    await deleteReport(c.env, report);
    access.setFlash({ success: `已刪除「${report.title}」。` });
    return c.redirect(paths.portal(project.slug), 302);
});

web.post('/p/:slug/reports/:publicId/client-delete', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.isClient(project))) {
        return deny(c, project);
    }
    const report = await reportOr404(c, project);
    if (!(await access.reportVisible(project, report)) || report.client_deleted_at !== null) {
        abort(404);
    }
    await setClientDeleted(c.env, report, true, c.get('now'));
    access.setFlash({ success: `已刪除「${report.title}」。` });
    return c.redirect(paths.portal(project.slug), 302);
});

web.post('/p/:slug/reports/:publicId/restore', async (c) => {
    const project = await projectOr404(c);
    const access = c.get('access');
    if (!(await access.isOwner(project))) {
        return deny(c, project);
    }
    const report = await reportOr404(c, project);
    const form = await readForm(c);
    await setClientDeleted(c.env, report, false, c.get('now'));
    access.setFlash({ success: `已還原「${report.title}」，${config(c.env).labels.client}端會重新看到。` });
    return c.redirect(backUrl(c, form, paths.portal(project.slug)), 302);
});

/** 詳細對話框與詳細頁的分類下拉：選了就存。權限同編輯回報單。 */
web.on(['POST', 'PATCH'], '/p/:slug/reports/:publicId/category', async (c) => {
    await throttle(c, 'reports-update', 30);
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const form = await readForm(c);
    const back = backUrl(c, form, paths.report(project.slug, report.public_id));
    const categories = projectCategories(project);
    const category = field(form, 'category');
    const problem =
        categories.length === 0
            ? '這個專案沒有設定分類。'
            : category !== '' && !editCategoryOptions(categories, report.category).includes(category)
              ? '這個分類不在專案的分類清單裡，請重新整理後再選。'
              : null;
    if (problem !== null) {
        if (wantsJson(c)) {
            return c.json({ message: problem, errors: { category: [problem] } }, 422);
        }
        access.setFlash({ success: problem });
        return c.redirect(back, 302);
    }
    const value = category === '' ? null : category;
    await c.env.DB.prepare('UPDATE reports SET category = ?, updated_at = ? WHERE id = ?').bind(value, nowIso(c.get('now')), report.id).run();
    const message = value === null ? '已改為未分類。' : `分類已改為「${value}」。`;
    if (wantsJson(c)) {
        return c.json({ category: value, message });
    }
    access.setFlash({ success: message });
    return c.redirect(back, 302);
});

web.on(['POST', 'PATCH'], '/p/:slug/reports/:publicId/status', async (c) => {
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const form = await readForm(c);
    const status = field(form, 'status');
    const isOwner = await access.isOwner(project);
    // 網頁上不能手動改狀態：留言時自動切換（等工程師／等客戶），只有客戶能按「完成」結單。
    // 排程 API 與 CLI（feedback-desk status）照舊可以改。
    const refused = `狀態會依留言自動切換；網頁上只有${config(c.env).labels.client}能按「完成」結單。`;
    if (isOwner) {
        abort(403, refused);
    }
    if (!isStatus(status)) {
        if (wantsJson(c)) {
            return c.json({ message: '選擇的 狀態 無效。', errors: { status: ['選擇的 狀態 無效。'] } }, 422);
        }
        return c.redirect(backUrl(c, form, paths.report(project.slug, report.public_id)), 302);
    }
    if (status !== 'completed') {
        abort(403, refused);
    }
    await changeStatus(c.env, report, status, c.get('now'), await access.author(project));
    const statusLabels = config(c.env).statusLabels;
    const message = `狀態已更新為「${statusLabel(status, statusLabels)}」。`;
    if (wantsJson(c)) {
        return c.json({
            status,
            label: statusLabel(status, statusLabels),
            counts: await statusCounts(c.env.DB, project.id, { includeClientDeleted: isOwner, clientCreatedOnly: !isOwner }),
            message,
        });
    }
    access.setFlash({ success: message });
    return c.redirect(backUrl(c, form, paths.report(project.slug, report.public_id)), 302);
});

/**
 * 開發團隊的「完成」：只發一則確認留言（附「通過」按鈕）請客戶確認，單維持等客戶，不會被結案。
 * 客戶端一律 403；已完成的單 422 already_completed。客戶按「通過」走上面的狀態端點。
 */
web.post('/p/:slug/reports/:publicId/request-completion', async (c) => {
    await throttle(c, 'completion', 30);
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canManage(project))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const clientName = config(c.env).labels.client;
    if (!(await access.isOwner(project))) {
        const message = `只有${config(c.env).labels.owner}能請${clientName}確認完成。`;
        if (wantsJson(c)) {
            return c.json({ message, error: 'team_only' }, 403);
        }
        abort(403, message);
    }
    const form = await readForm(c);
    const developer = await access.currentDeveloper(project);
    const back = backUrl(c, form, paths.report(project.slug, report.public_id));
    try {
        const result = await requestCompletion(
            c.env,
            report,
            { body: form.get('body') ?? '', authorName: messageAuthorName(c.env, report, true, developer?.name ?? null), author: await access.author(project) },
            c.get('now'),
        );
        const notice = completionSentNotice(config(c.env).statusLabels, clientName);
        if (wantsJson(c)) {
            return c.json({ message: notice, status: result.status, message_id: result.id }, 201);
        }
        access.setFlash({ success: notice });
    } catch (error) {
        if (error instanceof ServiceError) {
            if (wantsJson(c)) {
                return c.json({ message: error.message, error: error.code, errors: { body: [error.message] } }, error.status);
            }
            access.setFlash({ success: error.message });
        } else {
            throw error;
        }
    }
    return c.redirect(back, 302);
});

web.post('/p/:slug/reports/:publicId/messages', async (c) => {
    await throttle(c, 'messages', 30);
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.canView(project, report))) {
        return deny(c, project);
    }
    if (!(await access.reportVisible(project, report))) {
        abort(404);
    }
    const isOwner = await access.isOwner(project);
    if (await access.isGuest(project)) {
        const retryAfter = await attempt(c.env.DB, guestMessageLimits(c), c.get('now'));
        if (retryAfter !== null) {
            abort(429, '', { 'Retry-After': String(retryAfter) });
        }
    }
    const isPublicReporter = isPublicReport(report) && !isOwner;
    if (isPublicReporter && project.public_reporting_enabled !== 1) {
        abort(403, '這個專案已停止收件，這張單只能查看。');
    }
    if (isPublicReporter) {
        const cfg = config(c.env).publicReporting;
        const ip = clientIp(c.req.raw);
        const retryAfter = await attempt(
            c.env.DB,
            [
                { key: `msg-minute|${ip}`, max: cfg.messagePerMinute, period: 60 },
                { key: `msg-hour|${ip}`, max: cfg.messagePerHour, period: 3600 },
            ],
            c.get('now'),
        );
        if (retryAfter !== null) {
            abort(429, '', { 'Retry-After': String(retryAfter) });
        }
    }
    const form = await readForm(c);
    const body = field(form, 'body');
    const ids = uploadIds(form, 'upload_ids[]');
    const errors: string[] = [];
    validateText(errors, body, '訊息內容', MAX_MESSAGE);
    const maxShots = isPublicReporter ? PUBLIC_MAX_SCREENSHOTS : MAX_SCREENSHOTS;
    if (ids.length > maxShots) {
        errors.push(`截圖 最多只能有 ${maxShots} 項。`);
    }
    let uploads: Awaited<ReturnType<typeof findClaimableUploads>> = [];
    if (errors.length === 0) {
        uploads = await findClaimableUploads(c.env.DB, ids, { projectId: project.id, purpose: 'message', reportId: report.id });
        if (uploads === null) {
            errors.push(STALE_UPLOAD_MESSAGE);
        } else if (isPublicReporter) {
            const limit = config(c.env).publicReporting.maxAttachmentsPerReport;
            const row = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM attachments WHERE report_id = ?').bind(report.id).first<{ total: number }>();
            if ((row?.total ?? 0) + uploads.length > limit) {
                errors.push(`這張單的附圖總數不可超過 ${limit} 張。`);
            }
        }
    }
    if (errors.length > 0 || uploads === null) {
        if (wantsJson(c)) {
            return c.json({ message: errors[0], errors: { body: errors } }, 422);
        }
        return renderReport(c, project, report, { messageErrors: errors, messageOld: body }, 422);
    }
    const developer = await access.currentDeveloper(project);
    const account = isOwner ? null : await access.currentClientAccount(project);
    const result = await addMessage(
        c.env,
        report,
        {
            author_type: isOwner ? 'owner' : 'reporter',
            author_name: messageAuthorName(c.env, report, isOwner, developer?.name ?? null, account?.name ?? null),
            body,
            uploads,
            author: await access.author(project),
        },
        c.get('now'),
    );
    // Writing a message means the writer has seen the report, including messages before it.
    await markRead(c.env, report, isOwner ? 'owner' : 'client', c.get('now'), account);
    const notice = `訊息已送出。${isOwner && result.statusChanged ? statusChangeNotice(c.env) : ''}`;
    if (wantsJson(c)) {
        return c.json({ message: notice, status: result.status }, 201);
    }
    access.setFlash({ success: notice });
    return c.redirect(backUrl(c, form, paths.report(project.slug, report.public_id)), 302);
});

// ---------------------------------------------------------------- 待審留言（草稿）

/** 只有開發團隊能操作草稿；客戶端一律 403，別張單的草稿 404。 */
async function draftOr404(c: AppContext): Promise<{ project: Project; report: Report; draft: MessageDraft }> {
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.isOwner(project))) {
        abort(403);
    }
    const draft = await findDraft(c.env.DB, report, c.req.param('draftId') ?? '');
    if (!draft) {
        abort(404);
    }
    return { project, report, draft };
}

function draftsAnchor(project: Project, report: Report): string {
    return `${paths.report(project.slug, report.public_id)}#message-drafts`;
}

/**
 * 送出草稿：單頁的「送出」不帶 body，照草稿原文；右下角對話面板帶上輸入框裡（可能改過）的文字，
 * 要 JSON 時回 {message, status}。空白一律 422，草稿保留。
 */
web.post('/p/:slug/reports/:publicId/drafts/:draftId/send', async (c) => {
    await throttle(c, 'drafts', 30);
    const { project, report, draft } = await draftOr404(c);
    const access = c.get('access');
    const developer = await access.currentDeveloper(project);
    const form = await readForm(c);
    const editedBody = form.has('body') ? form.get('body') ?? '' : null;
    let notice: string;
    let status: ReportStatus;
    try {
        const result = await sendDraft(c.env, report, draft, { author: await access.author(project), developerName: developer?.name ?? null }, c.get('now'), editedBody);
        notice = `${result.replaced ? '已修改原留言。' : '留言已送出。'}${result.statusChanged ? statusChangeNotice(c.env) : ''}`;
        status = result.status;
    } catch (error) {
        if (error instanceof ServiceError) {
            if (wantsJson(c)) {
                return c.json({ message: error.message, errors: { body: [error.message] } }, 422);
            }
            abort(422, error.message);
        }
        throw error;
    }
    if (wantsJson(c)) {
        return c.json({ message: notice, status });
    }
    access.setFlash({ success: notice });
    return c.redirect(`${paths.report(project.slug, report.public_id)}#conversation`, 302);
});

web.post('/p/:slug/reports/:publicId/drafts/:draftId/update', async (c) => {
    await throttle(c, 'drafts', 30);
    const { project, report, draft } = await draftOr404(c);
    const access = c.get('access');
    const form = await readForm(c);
    try {
        await updateDraft(c.env, draft, form.get('body') ?? '', c.get('now'));
    } catch (error) {
        if (error instanceof ServiceError) {
            if (wantsJson(c)) {
                return c.json({ message: error.message, errors: { body: [error.message] } }, 422);
            }
            return renderReport(c, project, report, { draftErrors: { id: draft.id, errors: [error.message], old: form.get('body') ?? '' } }, 422);
        }
        throw error;
    }
    if (wantsJson(c)) {
        return c.json({ message: '待審留言已更新，尚未送出。' });
    }
    access.setFlash({ success: '待審留言已更新，尚未送出。' });
    return c.redirect(draftsAnchor(project, report), 302);
});

web.post('/p/:slug/reports/:publicId/drafts/:draftId/discard', async (c) => {
    await throttle(c, 'drafts', 30);
    const { project, report, draft } = await draftOr404(c);
    await discardDraft(c.env, draft);
    if (wantsJson(c)) {
        return c.json({ message: '已捨棄待審留言。' });
    }
    c.get('access').setFlash({ success: '已捨棄待審留言。' });
    return c.redirect(`${paths.report(project.slug, report.public_id)}#conversation`, 302);
});

/** 草稿附圖：只有開發團隊看得到；index 是草稿裡的第幾張（0 起算）。 */
web.get('/p/:slug/reports/:publicId/drafts/:draftId/files/:index', async (c) => {
    const { report, draft } = await draftOr404(c);
    const index = Number(c.req.param('index'));
    const file = Number.isInteger(index) && index >= 0 ? parseStoredFiles(draft.attachments)[index] : undefined;
    if (!file) {
        abort(404);
    }
    return streamAttachment(c, { id: 0, report_id: report.id, message_id: null, kind: 'feedback', ...file, uploader_client_account_id: null, uploader_developer_id: null, created_at: draft.created_at }, 'private, no-store');
});

/** Team context for claim and handoff actions on the web: personal team accounts only. */
async function webTeamContext(c: AppContext, project: Project): Promise<TeamContext | null> {
    const developer = await c.get('access').currentDeveloper(project);
    return developer && !developer.disabled_at ? { env: c.env, origin: origin(c), developer, now: c.get('now'), agent: null } : null;
}

web.post('/p/:slug/reports/:publicId/claim', async (c) => {
    await throttle(c, 'claim', 30);
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.isOwner(project))) {
        return deny(c, project);
    }
    const team = await webTeamContext(c, project);
    if (!team) {
        abort(403, '用個人帳號登入才能認領。');
    }
    const form = await readForm(c);
    const action = field(form, 'action');
    try {
        if (action === 'release') {
            await releaseReport(team, project.slug, report.public_id);
            access.setFlash({ success: '已釋放認領。' });
        } else {
            const result = await claimReport(team, project.slug, report.public_id, { force: action === 'takeover' });
            access.setFlash({ success: result.took_over_from ? `已接手（原本是 ${result.took_over_from}）。` : '已認領，其他人會看到你正在處理。' });
        }
    } catch (error) {
        // Someone else claimed or took it over since this page loaded.
        if (error instanceof ServiceError) {
            abort(409, error.message);
        }
        throw error;
    }
    return c.redirect(backUrl(c, form, paths.report(project.slug, report.public_id)), 302);
});

web.post('/p/:slug/reports/:publicId/handoff', async (c) => {
    await throttle(c, 'handoff', 30);
    const project = await projectOr404(c);
    const report = await reportOr404(c, project);
    const access = c.get('access');
    if (!(await access.isOwner(project))) {
        return deny(c, project);
    }
    const team = await webTeamContext(c, project);
    if (!team) {
        abort(403, '用個人帳號登入才能寫交接紀錄。');
    }
    const form = await readForm(c);
    try {
        const result = await writeHandoff(team, project.slug, report.public_id, { note: form.get('note') ?? '', release: form.get('release') === '1' });
        access.setFlash({ success: result.released ? '已儲存交接紀錄並釋放認領。' : '已儲存交接紀錄。' });
    } catch (error) {
        if (error instanceof ServiceError) {
            abort(422, error.message);
        }
        throw error;
    }
    return c.redirect(backUrl(c, form, paths.report(project.slug, report.public_id)), 302);
});

/**
 * 調整重點已停用：網頁不能再寫入，一律回 410（權限檢查照舊：非開發團隊照舊被擋）。舊內容照舊在詳情裡唯讀顯示（過去的處理說明）。
 * 巡檢 API、CLI、MCP 的寫入入口暫時保留（照常寫入並附警告），見 shared/completion.ts 的 ADJUSTMENT_DEPRECATED。
 */
web.post('/p/:slug/reports/:publicId/adjustment', async (c) => {
    await throttle(c, 'adjustment', 30);
    const project = await projectOr404(c);
    await reportOr404(c, project);
    if (!(await c.get('access').isOwner(project))) {
        return deny(c, project);
    }
    return c.json({ message: ADJUSTMENT_WEB_DISABLED, error: 'adjustment_disabled' }, 410);
});
