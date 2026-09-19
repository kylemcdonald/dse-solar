import type { GraphRuntime } from './systemGraph';

/** Inputs shared by the offline schematic solver and its interactive renderer.
 * A schematic does not imply certified physical routing or fault protection. */
export type DiagramRuntime = Pick<GraphRuntime, 'graph' | 'devices' | 'deviceById' | 'conductors' | 'conductorByKey' | 'glands' | 'routes' | 'routeById'>;
