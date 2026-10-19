/** URL builders, the counterpart of Laravel's named routes. */
const enc = encodeURIComponent;

export const paths = {
    home: () => '/',
    publicStore: () => '/public-reports',
    portal: (slug: string) => `/p/${enc(slug)}`,
    clientAccess: (slug: string) => `/p/${enc(slug)}/access`,
    login: (slug: string) => `/p/${enc(slug)}/login`,
    logout: (slug: string) => `/p/${enc(slug)}/logout`,
    uploads: (slug: string) => `/p/${enc(slug)}/uploads`,
    reportsStore: (slug: string) => `/p/${enc(slug)}/reports`,
    conversations: (slug: string) => `/p/${enc(slug)}/conversations`,
    conversation: (slug: string, publicId: string) => `/p/${enc(slug)}/conversations/${enc(publicId)}`,
    report: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}`,
    reportUpdate: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/update`,
    reportDestroy: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/delete`,
    reportClientDestroy: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/client-delete`,
    reportRestore: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/restore`,
    reportStatus: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/status`,
    reportDialogs: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/dialogs`,
    reportActivity: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/activity`,
    reportMessages: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/messages`,
    reportAdjustment: (slug: string, publicId: string) => `/p/${enc(slug)}/reports/${enc(publicId)}/adjustment`,
    attachment: (slug: string, publicId: string, attachmentId: number) => `/p/${enc(slug)}/reports/${enc(publicId)}/attachments/${attachmentId}`,
    ownerAccess: (slug: string) => `/owner/${enc(slug)}/access`,
    ownerLogin: (slug: string) => `/owner/${enc(slug)}/login`,
    ownerIndex: (slug: string) => `/owner/${enc(slug)}`,
    device: () => '/device',
};

export function withQuery(path: string, query: Record<string, string | number | null | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined && value !== '') {
            params.set(key, String(value));
        }
    }
    const search = params.toString();
    return search === '' ? path : `${path}?${search}`;
}
