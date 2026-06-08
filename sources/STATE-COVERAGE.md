# State And UT Coverage

This tracker records the alphabetical expansion of state-level Source Index
coverage. State and union-territory entries use `jurisdiction: IN-XX` and
`governance_level: state` unless they are local-body sources.

## Started

- `IN-AN` Andaman and Nicobar Islands: state portal/gazette updates, labour,
  pollution consent, e-services
- `IN-AP` Andhra Pradesh: e-gazette, single-desk industries, factories and
  boilers, pollution control
- `IN-AR` Arunachal Pradesh: gazette/printing, EODB, labour, pollution control
- `IN-AS` Assam: gazette, EODB, labour, factories/EODB handoff, pollution
  control
- `IN-BR` Bihar: e-gazette, labour, single-window, pollution control
- `IN-CH` Chandigarh: administration portal, labour, EODB, pollution consent
- `IN-CT` Chhattisgarh: e-gazette, single-window, labour portal, environment
  conservation board
- `IN-DL` Delhi: e-gazette/state portal, labour, industries, pollution control
- `IN-DN` Dadra and Nagar Haveli and Daman and Diu: administration portal,
  labour, OCMMS, single-window
- `IN-GA` Goa: printing press e-gazette, labour, pollution control
- `IN-GJ` Gujarat: e-gazette, IFP, labour, pollution control
- `IN-HP` Himachal Pradesh: Rajpatra, labour, single-window, pollution control
- `IN-HR` Haryana: state e-gazette page, labour, single-window, pollution
  control
- `IN-JH` Jharkhand: e-gazette, Shramadhan labour, single-window, pollution
  control
- `IN-JK` Jammu and Kashmir: government press/Rajpatra, single-window, OCMMS
- `IN-KA` Karnataka continuation: e-Rajyapatra and Invest Karnataka/KUM
- `IN-KL` Kerala: COMPOSE/e-gazette, Labour Commissioner/LCAS, K-SWIFT,
  pollution control
- `IN-LA` Ladakh: e-gazette and EODB
- `IN-LD` Lakshadweep: administration portal, labour department, pollution
  control, OCMMS
- `IN-MH` Maharashtra continuation: e-gazette, labour, MAITRI
- `IN-ML` Meghalaya: state portal, Invest Meghalaya, e-services, pollution
  control
- `IN-MN` Manipur: e-gazette, EODB, labour, pollution control
- `IN-MP` Madhya Pradesh: state portal, labour, Invest MP, MPPCB
- `IN-MZ` Mizoram: gazette/printing, labour, EODB, pollution control
- `IN-NL` Nagaland: e-gazette, labour, EODB, pollution control
- `IN-OD` Odisha: e-gazette search, labour, GO-SWIFT, pollution control
- `IN-PB` Punjab: orders/notifications, labour, Business First, OCMMS
- `IN-PY` Puducherry: stationery/printing gazette surface, labour, IGB,
  pollution control
- `IN-RJ` Rajasthan: Rajnivesh legal/update and single-window, labour, pollution
  control
- `IN-SK` Sikkim: state portal gazettes, labour portal access probe, pollution
  control
- `IN-TG` Telangana: e-gazette, labour, TG-iPASS, pollution control
- `IN-TN` Tamil Nadu continuation: Stationery/Printing gazettes, labour,
  single-window, DISH
- `IN-TR` Tripura: GAPS/gazette, labour, Industries and Commerce, pollution
  control
- `IN-UP` Uttar Pradesh: e-gazette access probe, labour access probe,
  Nivesh Mitra, pollution control access probe
- `IN-UK` Uttarakhand: gazette access probe, labour, Invest Uttarakhand,
  pollution control access probe
- `IN-WB` West Bengal: labour, Silpa Sathi, pollution control

## Next Alphabetical Batch

- Revisit blocked state/UT sources and fill missing direct gazette endpoints.

## Notes

- A URL returning HTTP 200 is not enough. Each source must still record whether
  extraction is static, browser-rendered, form-based, blocked, or only
  reachability-verified.
- Gazette/state portal entries are preferred for state Acts, rules,
  notifications, orders, and amendments.
- Transactional EODB/single-window portals are indexed because business
  compliance obligations are often operationalized through licenses, renewals,
  returns, inspections, and certificates.
