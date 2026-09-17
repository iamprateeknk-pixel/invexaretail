import { type ControlPlaneSnapshot } from './snapshot.js';
export declare function ensureControlPlaneSchema(): Promise<void>;
export declare function loadControlPlaneSnapshot(): Promise<ControlPlaneSnapshot | null>;
export declare function saveControlPlaneSnapshot(snapshot?: ControlPlaneSnapshot): Promise<void>;
export declare function hydrateControlPlaneFromStore(): Promise<'skipped' | 'seeded' | 'restored'>;
export declare function scheduleControlPlanePersist(): void;
export declare function flushControlPlanePersist(): Promise<void>;
