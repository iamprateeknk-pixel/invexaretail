export type ControlPlaneWebhookTarget = {
    id: string;
    name: string;
    url: string;
    signingSecret: string;
    createdAt: string;
};
export declare function resolveCompanyIdFromEvent(data?: Record<string, unknown>): string | undefined;
export declare function listControlPlaneWebhookTargets(companyId: string, eventType: string): ControlPlaneWebhookTarget[];
