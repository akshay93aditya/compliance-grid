import type { ObligationType } from '../schemas/obligation';

// Per D8: canonical key is (instrument, section, obligation_type, jurisdiction).
// Jurisdiction is derived via instrument_id -> Instrument.jurisdiction, so the
// minted id encodes the three independent inputs.
//
// Format uses '|' as a separator. instrument_id is allowed to contain '/'
// (e.g. 'IN-KA/factories-rules-1969'), so '/' is unsafe; '|' is rare in our
// id-space. Section may be empty (whole-instrument obligations); we emit an
// empty middle segment in that case so the format stays sortable and parseable.
//
// Examples:
//   { instrument_id: 'IN/companies-act-2013', section: undefined, type: 'filing' }
//     -> 'IN/companies-act-2013||filing'
//   { instrument_id: 'IN-KA/factories-rules-1969', section: 'r.105', type: 'filing' }
//     -> 'IN-KA/factories-rules-1969|r.105|filing'
export function canonicalize(input: {
  instrument_id: string;
  section?: string | null;
  type: ObligationType;
}): string {
  if (!input.instrument_id || input.instrument_id.length === 0) {
    throw new Error('canonicalize: instrument_id must be a non-empty string');
  }
  if (!input.type || input.type.length === 0) {
    throw new Error('canonicalize: type must be a non-empty string');
  }
  return `${input.instrument_id}|${input.section ?? ''}|${input.type}`;
}
