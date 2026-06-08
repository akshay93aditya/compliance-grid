# Central Government Coverage

This directory is the central-government slice of the Source Index. Central
entries use `jurisdiction: IN` and cover sources where national compliance
requirements are published, updated, operationalized, or clarified.

## Covered in this wave

- Agriculture: PPQS, FCI, ICAR, NCDC
- Aviation: DGCA, AERA, BCAS, AAI
- Competition: CCI
- Consumer and legal metrology: Department of Consumer Affairs, NCDRC
- Corporate and insolvency: MCA, NCLT, NCLAT, IBBI
- Customs and indirect tax: CBIC root, CBIC GST, CBIC Tax Information, ICEGATE
- Data and digital: MeitY, CERT-In, UIDAI, NIXI, IAMAI (secondary), NASSCOM (industry)
- Education (new domain): UGC, AICTE, CBSE
- Energy: CEA, CERC, PNGRB, Ministry of Power, MNRE, BEE, Grid Controller of India, DGH, IREDA
- Environment: MoEFCC, CPCB, PARIVESH, NGT, CWC, CGWB
- Financial regulators: RBI, SEBI, IRDAI, PFRDA, NHB, FIU-IND, DRT, IBA, Insurance Ombudsman, FIMMDA, FEDAI, MFIN, ANMI, NABARD, DICGC, IIBF, IBAI
- Food and pharma: FSSAI, CDSCO, NPPA, IPC
- Foreign trade and export controls: DGFT, APEDA, EIC, SEZ India, MPEDA, Tea Board, Coffee Board, Spices Board, Rubber Board, Pharmexcil
- Governance and audit (new domain): CVC, CAG, CIC, MoSPI, NITI Aayog
- Health (new domain): NMC, Pharmacy Council, Dental Council, Indian Nursing Council
- Industrial safety: PESO, DGMS, AERB, DGFASLI
- Industry chambers (secondary trackers): CII, FICCI, ASSOCHAM, SIAM
- Industry (government bodies): DPIIT, MSME, NSWS, IBM, STPI
- Intellectual property: IP India, Copyright Office, IPRS
- Labour: Ministry of Labour, Shram Suvidha, EPFO, ESIC, Labour Bureau
- Maritime: DG Shipping, IWAI
- Media and broadcasting: MIB, PIB, ASCI
- Procurement and approvals: GeM, NSWS
- Real estate (new domain): HUDCO
- Securities: SEBI, BSE, NSE, NSDL, CDSL, NCDEX, MCXCCL, NoticeBlue, SAT, AMFI
- Standards and warehousing: BIS, WDRA
- Tax: GST, Income Tax, e-way bill, e-invoice, ITAT, CESTAT, Taxmann, LKS
- Telecom: DoT, TRAI, TEC
- Transport (new domain): NHAI, MoRTH, Indian Railways

## Secondary and market-infrastructure coverage

Central compliance changes also surface through non-government public sources
that are important for discovery and cross-checking:

- Market infrastructure: BSE notices and circulars, NSDL circulars, NCDEX
  circulars, MCXCCL circulars, NPCI UPI circulars
- Statutory professional bodies: ICSI standards, ICAI, ICMAI
- Secondary trackers and public aggregators: NoticeBlue, TeamLease RegTech,
  India Briefing, TaxGuru GST updates
- Legal news + case-law (Phase B-1): Indian Kanoon, LiveLaw,
  Bar and Bench, Mondaq India
- Tax aggregators (Phase B-1): Taxmann
- Law-firm regulatory commentary (Phase B-2): Cyril Amarchand
  Mangaldas, AZB and Partners, Khaitan and Co, Trilegal, Shardul
  Amarchand Mangaldas, J Sagar Associates, Nishith Desai Associates,
  Lakshmikumaran and Sridharan (LKS, tax-focused)
- Industry chambers + SROs (Phase B-2): CII, FICCI, ASSOCHAM,
  NASSCOM, SIAM, IBA, AMFI

These entries use `trust_tier: secondary`. They can help answer "where is it
updated?" and "how do we find it quickly?", but committed CKG obligations should
still cite the official circular, regulator, gazette, statute, or rule document
that carries the legal claim.

## Access reality

Some central sources are verified as important but not extraction-ready:

- `irdai-gov-in`, `cdsco-gov-in`, `msme-gov-in`, `dgshipping-gov-in`,
  `cbic-gov-in`, and `einvoice-gst-gov-in` need browser or manual access work.
- `mcxccl-circulars` is an important market-infrastructure source, but curl
  received HTTP 403 on 2026-06-05. Keep it blocked until a browser/access review
  confirms permitted extraction behavior.
- `pib-gov-in` (Press Information Bureau) returned HTTP 403 on probe 2026-06-05.
  Recorded as `access.status: blocked` and `verification.status: blocked`.
  High-value source if a respectful crawl pattern can be negotiated; currently
  index-only.
- `sat-gov-in` (Securities Appellate Tribunal) returned HTTP 503 on probe
  2026-06-05. Recorded as `verification.status: blocked` pending re-probe to
  classify the outage as transient or structural.
- Transactional portals such as ICEGATE, GeM, NSWS, PARIVESH, e-way bill, and
  e-invoice should index public manuals, advisories, notices, and form guides
  before any authenticated workflow extraction is attempted.
- `requires_browser: true` means "use the browser-acquire path or inspect
  rendered network calls." It does not mean the source is currently
  extraction-ready.

## Known central gaps needing verified discovery

These should not be added until their official URL is verified:

- ~~SEZ official source. `sezindia.nic.in` did not resolve on 2026-06-05.~~
  Resolved: `sezindia.gov.in` returned HTTP 200 on 2026-06-06 and was added
  in Phase B-2.
- New DGMS portal. `www.dgms.gov.in/UserView/index?mid=1261` returned HTTP 404
  to curl on 2026-06-05, so `dgms.net` is indexed as the reachable source.
- TDSAT (`tdsat.gov.in`), CCPA (`ccpa.gov.in`), and PHDCCI (`phdcci.in`) did
  not resolve on the 2026-06-05 / 2026-06-06 probes; deferred until a working
  URL is found.
- TAMP (`tamp.gov.in`), Press Council (`presscouncil.gov.in`, `pressci.gov.in`),
  NBDSA (`nbdsa.in`), MoHUA (`mohua.gov.in`, `mohua.nic.in`),
  AYUSH (`ayush.nic.in`), DGHS (`dghs.gov.in`, `main.dghs.gov.in`),
  NABL (`nabl.qci.org.in`), Sagarmala (`sagarmala.gov.in`), and HUDCO main
  (`hudco.org`) all failed to resolve on probes 2026-06-06 — investigate
  alternate canonical URLs before adding. HUDCO is added via the resolving
  `hudco.org.in`.
- Any additional sectoral authorities found later must follow the same rule:
  verify URL first, then record access status separately from reachability.
