import type { EventTopic } from './event-bus.js';
/** Topics a successful mutation on this path should publish. Previews and reads publish nothing. */
export declare function topicsForMutation(method: string, path: string): EventTopic[];
/** Locations named by the request, so branch-scoped clients only hear about their own branches. */
export declare function locationIdsForMutation(path: string, body: unknown): string[] | undefined;
