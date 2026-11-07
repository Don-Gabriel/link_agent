// Shared editorial implementation; this adapter supplies the existing PostgreSQL-backed model client.
import * as core from './writer-core';
import { complete } from './llm';
export * from './writer-core';
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
export const writePost = (...args: Tail<Parameters<typeof core.writePost>>) => core.writePost(complete, ...args);
export const rewriteDraft = (...args: Tail<Parameters<typeof core.rewriteDraft>>) => core.rewriteDraft(complete, ...args);
export const writeFollowUp = (...args: Tail<Parameters<typeof core.writeFollowUp>>) => core.writeFollowUp(complete, ...args);
export const polishCustomPost = (...args: Tail<Parameters<typeof core.polishCustomPost>>) => core.polishCustomPost(complete, ...args);
