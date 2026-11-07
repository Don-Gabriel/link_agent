// Shared editorial implementation; this adapter supplies the existing PostgreSQL-backed model client.
import * as core from './judge-core';
import { complete } from './llm';
export * from './judge-core';
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
export const judgeCandidates = (...args: Tail<Parameters<typeof core.judgeCandidates>>) => core.judgeCandidates(complete, ...args);
