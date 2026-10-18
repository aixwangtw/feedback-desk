import type { FC } from 'hono/jsx';
import type { Project, Report } from '../lib/models';
import { PUBLIC_MAX_SCREENSHOTS, PUBLIC_MAX_IMAGE_BYTES } from '../lib/uploads';
import { paths } from '../routes/paths';
import { ErrorList, Layout, StatusBadge, Time, type ViewContext } from './components';

export const HONEYPOT_FIELD = 'contact_website';
export const TURNSTILE_FIELD = 'cf-turnstile-response';

const INPUT = 'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10';
const INPUT_WITH_PLACEHOLDER = 'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10';

export const LoginPage: FC<{
    v: ViewContext;
    project: Project;
    isOwnerLogin: boolean;
    username: string;
    password: string;
    error?: string;
    success?: string;
    showLogout: boolean;
}> = ({ v, project, isOwnerLogin, username, password, error, success, showLogout }) => {
    const labels = v.cfg.labels;
    return (
        <Layout v={v} title={`登入｜${project.name}`} project={project} showLogout={showLogout} success={success}>
            <section class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <p class="text-sm font-semibold text-teal-700">{project.name}</p>
                {isOwnerLogin ? (
                    <>
                        <h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-950">{labels.owner}登入</h1>
                        <p class="mt-2 text-sm leading-6 text-slate-600">這個頁面需要{labels.owner}權限，請輸入{labels.owner}帳號密碼。</p>
                    </>
                ) : (
                    <>
                        <h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-950">登入問題清單</h1>
                        <p class="mt-2 text-sm leading-6 text-slate-600">連線逾時或尚未登入，請輸入帳號密碼；也可以直接使用{labels.owner}提供的專屬連結。</p>
                    </>
                )}

                <form method="post" action={paths.login(project.slug)} class="mt-6 grid gap-5">
                    {isOwnerLogin ? <input type="hidden" name="login_page" value="owner" /> : null}
                    {error ? <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div> : null}
                    <div>
                        <label for="username" class="mb-2 block text-sm font-semibold text-slate-800">帳號</label>
                        <input id="username" name="username" value={username} required maxlength={50} autocomplete="username" autocapitalize="none" autofocus class={INPUT} />
                    </div>
                    <div>
                        <label for="password" class="mb-2 block text-sm font-semibold text-slate-800">密碼</label>
                        <input id="password" name="password" type="password" value={password} required maxlength={200} autocomplete="current-password" class={INPUT} />
                    </div>
                    <button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">登入</button>
                </form>
            </section>
        </Layout>
    );
};

export const HomePage: FC<{ v: ViewContext }> = ({ v }) => (
    <Layout v={v} title={v.cfg.home.title}>
        <section class="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
            <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-teal-700 text-xl font-bold text-white shadow-sm">回</span>
            <p class="mt-6 text-sm font-semibold text-teal-700">{v.cfg.home.eyebrow}</p>
            <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950">{v.cfg.home.heading}</h1>
            <p class="mt-4 text-sm leading-7 text-slate-600">{v.cfg.home.body}</p>
        </section>
    </Layout>
);

export interface PublicFormState {
    errors: string[];
    title?: string;
    description?: string;
    reporter_name?: string;
}

export const PublicHomePage: FC<{
    v: ViewContext;
    project: Project;
    myReports: Report[];
    turnstileSiteKey: string | null;
    form?: PublicFormState;
}> = ({ v, project, myReports, turnstileSiteKey, form }) => {
    const publicConfig = v.cfg.publicReporting;
    return (
        <Layout v={v} title={v.cfg.home.title} maxWidth="max-w-3xl">
            <div class="grid gap-6">
                <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                    <p class="text-sm font-semibold text-teal-700">{v.cfg.home.eyebrow}</p>
                    <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950">{v.cfg.home.heading}</h1>
                    {publicConfig.intro ? <p class="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600" data-public-intro>{publicConfig.intro}</p> : null}
                    <p class="mt-4 text-sm leading-7 text-slate-600">送出後會得到一個私密網址，用它可以回來查看處理進度、補充說明。不需要註冊，也不用留 email。</p>
                    {publicConfig.githubUrl || publicConfig.blogUrl ? (
                        <p class="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
                            {publicConfig.githubUrl ? <a href={publicConfig.githubUrl} target="_blank" rel="noopener noreferrer" class="text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950" data-public-github>GitHub</a> : null}
                            {publicConfig.blogUrl ? <a href={publicConfig.blogUrl} target="_blank" rel="noopener noreferrer" class="text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950" data-public-blog>部落格文章</a> : null}
                        </p>
                    ) : null}
                    {publicConfig.notice ? <p class="mt-4 text-sm text-slate-600" data-public-notice>{publicConfig.notice}</p> : null}
                </section>

                {myReports.length > 0 ? (
                    <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" data-my-reports>
                        <h2 class="text-base font-semibold text-slate-950">你送出的單</h2>
                        <p class="mt-1 text-xs text-slate-500">只有這個瀏覽器看得到這份清單。換瀏覽器請用當初存下的私密網址。</p>
                        <ul class="mt-4 divide-y divide-slate-100">
                            {myReports.map((report) => (
                                <li class="flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div class="min-w-0">
                                        <a href={paths.report(project.slug, report.public_id)} class="block truncate text-sm font-semibold text-teal-800 hover:underline" data-my-report-link>{report.title}</a>
                                        <Time v={v} at={report.created_at} class="text-xs text-slate-500" />
                                    </div>
                                    <StatusBadge status={report.status} />
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}

                <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                    <h2 class="text-base font-semibold text-slate-950">回報問題</h2>

                    <ErrorList errors={form?.errors ?? []} class="mt-4" />

                    <form method="post" action={paths.publicStore()} class="mt-5 grid gap-5" data-public-report-form data-upload-form>
                        <div>
                            <label for="title" class="mb-2 block text-sm font-semibold text-slate-800">標題 <span class="text-rose-600">*</span></label>
                            <input id="title" name="title" value={form?.title ?? ''} required maxlength={160} class={INPUT_WITH_PLACEHOLDER} />
                        </div>
                        <div>
                            <label for="description" class="mb-2 block text-sm font-semibold text-slate-800">說明 <span class="text-rose-600">*</span></label>
                            <textarea id="description" name="description" required maxlength={10000} rows={6} placeholder="請說明操作步驟、預期結果與實際結果。" class={`${INPUT_WITH_PLACEHOLDER} resize-y leading-6`}>{form?.description ?? ''}</textarea>
                        </div>
                        <div>
                            <label for="reporter_name" class="mb-2 block text-sm font-semibold text-slate-800">怎麼稱呼你 <span class="font-normal text-slate-500">（選填）</span></label>
                            <input id="reporter_name" name="reporter_name" value={form?.reporter_name ?? ''} maxlength={50} class={INPUT_WITH_PLACEHOLDER} />
                        </div>
                        <div>
                            <label for="screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 上傳截圖<input id="screenshots" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="public-preview" data-upload-url={`${paths.uploads(project.slug)}?purpose=public`} data-upload-name="upload_ids[]" data-upload-max={String(PUBLIC_MAX_SCREENSHOTS)} data-upload-max-bytes={String(PUBLIC_MAX_IMAGE_BYTES)} /></label>
                            <span class="ml-2 text-xs text-slate-500">選填，最多 {PUBLIC_MAX_SCREENSHOTS} 張，每張 5 MB，jpg、png、webp。</span>
                            <div id="public-preview" class="mt-3 grid grid-cols-3 gap-3" aria-live="polite"></div>
                        </div>

                        <div aria-hidden="true" class="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                            <label for={HONEYPOT_FIELD}>Website</label>
                            <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabindex={-1} autocomplete="off" />
                        </div>

                        {turnstileSiteKey ? (
                            <>
                                <div class="cf-turnstile" data-sitekey={turnstileSiteKey} data-turnstile></div>
                                <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                            </>
                        ) : null}

                        <div>
                            <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出回報</button>
                        </div>
                    </form>
                </section>
            </div>
        </Layout>
    );
};

export const MessagePage: FC<{ v: ViewContext; status: number; title: string; body: string }> = ({ v, status, title, body }) => (
    <Layout v={v} title={`${title}｜${v.cfg.home.title}`}>
        <section class="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
            <p class="text-sm font-semibold text-teal-700">{status}</p>
            <h1 class="mt-2 text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
            <p class="mt-4 text-sm leading-7 text-slate-600">{body}</p>
        </section>
    </Layout>
);

export interface DeviceRequest {
    code: string;
    clientName: string;
    requestedAt: string;
    requesterIp: string | null;
}

const DEVICE_WARNING = (
    <div role="alert" class="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900" data-device-warning>
        如果你剛才沒有在自己的終端機執行 feedback-desk login，請不要授權。授權後，對方可以用你的身分讀取所有專案的回報單、寫調整說明、改狀態與管理帳號。
    </div>
);

export const DevicePage: FC<{
    v: ViewContext;
    developer: { name: string; username: string } | null;
    state: 'login' | 'enter' | 'confirm' | 'approved' | 'denied';
    request?: DeviceRequest;
    error?: string;
    username?: string;
}> = ({ v, developer, state, request, error, username }) => {
    const labels = v.cfg.labels;
    const errorBox = error ? <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div> : null;
    return (
        <Layout v={v} title={`授權命令列工具｜${v.cfg.home.title}`}>
            <section class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" data-device-page>
                <p class="text-sm font-semibold text-teal-700">Feedback Desk CLI</p>
                <h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-950">授權命令列工具</h1>
                {state === 'approved' ? (
                    <p class="mt-4 text-sm leading-6 text-slate-600" data-device-approved>已授權。回到終端機就能繼續，這個分頁可以關閉。</p>
                ) : state === 'denied' ? (
                    <p class="mt-4 text-sm leading-6 text-slate-600" data-device-denied>已拒絕這次授權，終端機那邊會顯示失敗。</p>
                ) : state === 'login' ? (
                    <>
                        <p class="mt-2 text-sm leading-6 text-slate-600">請用{labels.owner}個人帳號登入，登入後輸入終端機顯示的授權碼。</p>
                        {DEVICE_WARNING}
                        <form method="post" action="/device/login" class="mt-6 grid gap-5">
                            {errorBox}
                            <div>
                                <label for="username" class="mb-2 block text-sm font-semibold text-slate-800">帳號</label>
                                <input id="username" name="username" value={username ?? ''} required maxlength={50} autocomplete="username" autocapitalize="none" autofocus class={INPUT} />
                            </div>
                            <div>
                                <label for="password" class="mb-2 block text-sm font-semibold text-slate-800">密碼</label>
                                <input id="password" name="password" type="password" required maxlength={200} autocomplete="current-password" class={INPUT} />
                            </div>
                            <button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">登入</button>
                        </form>
                    </>
                ) : state === 'enter' ? (
                    <>
                        <p class="mt-2 text-sm leading-6 text-slate-600">{developer ? `已用 ${developer.name}（${developer.username}）登入。` : ''}請輸入終端機上顯示的授權碼（8 個英文字母）。</p>
                        {DEVICE_WARNING}
                        <form method="post" action="/device/confirm" class="mt-6 grid gap-5">
                            {errorBox}
                            <div>
                                <label for="code" class="mb-2 block text-sm font-semibold text-slate-800">授權碼</label>
                                <input id="code" name="code" value="" required maxlength={9} autocomplete="off" autocapitalize="characters" spellcheck={false} placeholder="XXXX-XXXX" autofocus class={`${INPUT} font-mono text-lg tracking-widest`} data-device-code />
                            </div>
                            <button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2" data-device-continue>下一步</button>
                        </form>
                    </>
                ) : (
                    <>
                        {DEVICE_WARNING}
                        <dl class="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm" data-device-request>
                            <div><dt class="text-xs text-slate-500">授權碼</dt><dd class="mt-0.5 font-mono font-semibold tracking-widest text-slate-900">{request?.code}</dd></div>
                            <div><dt class="text-xs text-slate-500">申請端自填的名稱（可以任意填寫，不能當作身分證明）</dt><dd class="mt-0.5 font-medium text-slate-900">{request?.clientName}</dd></div>
                            <div><dt class="text-xs text-slate-500">申請時間</dt><dd class="mt-0.5 font-medium text-slate-900">{request ? <Time v={v} at={request.requestedAt} /> : null}（<Time v={v} at={request?.requestedAt ?? ''} relative />）</dd></div>
                            {request?.requesterIp ? <div><dt class="text-xs text-slate-500">申請來源 IP（前段）</dt><dd class="mt-0.5 font-mono text-slate-900">{request.requesterIp}</dd></div> : null}
                        </dl>
                        <form method="post" action="/device/approve" class="mt-6 grid gap-5">
                            {errorBox}
                            <input type="hidden" name="code" value={request?.code ?? ''} />
                            <div class="flex gap-3">
                                <button type="submit" name="decision" value="approve" class="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2" data-device-approve>授權</button>
                                <button type="submit" name="decision" value="deny" class="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-device-deny>拒絕</button>
                            </div>
                        </form>
                    </>
                )}
            </section>
        </Layout>
    );
};
