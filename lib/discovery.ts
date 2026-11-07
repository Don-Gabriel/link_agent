import { discover as discoverCore, type DiscoverOptions } from './discovery-core';
import { recordFeedResult } from './feedhealth';
export * from './discovery-core';
export const discover = (options:DiscoverOptions={}) => discoverCore(recordFeedResult,options);
