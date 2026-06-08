import { z } from 'zod';
import { Jurisdiction } from './jurisdiction';

// Per D21 (and the state-machine diagram in docs/diagrams/architecture.md).
export const CoverageStatus = z.enum([
  'not_covered',
  'expanding',
  'live',
  'stale',
  'refreshing',
]);
export type CoverageStatus = z.infer<typeof CoverageStatus>;

// The partition axis. `domain` is free-string for now: D10 names central
// horizontals (tax, secretarial, core labour) but doesn't lock the full
// taxonomy. Tighten once the taxonomy stabilizes.
export const ModuleCoordinate = z.object({
  jurisdiction: Jurisdiction,
  domain: z.string().min(1),
});
export type ModuleCoordinate = z.infer<typeof ModuleCoordinate>;

// A coordinate together with the specific version. Used in depends_on so a
// module pins to a specific version of each dependency.
export const ModuleVersionedCoordinate = z.object({
  jurisdiction: Jurisdiction,
  domain: z.string().min(1),
  version: z.string().min(1),
});
export type ModuleVersionedCoordinate = z.infer<
  typeof ModuleVersionedCoordinate
>;

// Per docs/specs/03-architecture.md "Object schemas":
//   Module { coordinate, version, depends_on[], coverage_status }
// Per D21: coordinate and version are separate fields. Vertical modules
// compose horizontals via depends_on (e.g. pharma depends on labour+EHS+tax)
// rather than copying their content.
export const Module = z.object({
  coordinate: ModuleCoordinate,
  version: z.string().min(1),
  depends_on: z.array(ModuleVersionedCoordinate),
  coverage_status: CoverageStatus,
});
export type Module = z.infer<typeof Module>;

// Helper: render a versioned coordinate as "IN-KA/labour/v1".
export function formatModuleCoordinate(c: ModuleVersionedCoordinate): string {
  return `${c.jurisdiction}/${c.domain}/${c.version}`;
}
