# Selected implementation stack — 0.9.0

These are engineering selections for the approved direction, not a shopping list of equally undecided alternatives. Exact compatible dependency versions, full transitive locks, license notices and package integrity are generated and tested in LL002 on the development environment. No package is installed by this baseline. A made-up lockfile would be worse than a clearly unexecuted lock task.

| Component | Selection | Why / boundary |
|---|---|---|
| web | React + TypeScript + Vite | One static SPA; no SSR or hosted inference backend. [REF01](../research/build-source-register.json) |
| ui | Tailwind semantic CSS tokens + selected shadcn/Radix primitives | Reuse forms/dialogs/tabs; copied components remain our maintained code with upstream identity. Do not import a full template. [REF02](../research/build-source-register.json) |
| motion | CSS first; Motion for React for purposeful transitions | One animation engine only; reduced motion and stable media state mandatory. No GSAP/Lottie/Rive just for decoration. [REF03](../research/build-source-register.json) |
| icons | Lucide React | One icon family; textual status and accessible names still required. [REF02](../research/build-source-register.json) |
| routing | React Router library mode | Stable scoped route IDs; avoid a second routing/meta framework. [REF01](../research/build-source-register.json) |
| query | TanStack Query | Cache read projections and request receipts; no ownership of academic records. [REF05](../research/build-source-register.json) |
| local-web-state | IndexedDB via idb + normal React state | Durable draft and key storage in browser; signal storage failure and no promise beyond browser persistence. [REF12](../research/build-source-register.json) |
| pdf | PDF.js display layer | Virtualized visible pages with original colors, text selection and separate permitted overlays. No private core API. [REF04](../research/build-source-register.json) |
| media | Native audio/video + Media Chrome | Seek/pause/captions/control surface; our thin adapter enforces selected clip boundaries. [REF06](../research/build-source-register.json) |
| math | KaTeX + restricted Markdown renderer | Math and text content; raw HTML disabled and code/URL sanitization separately tested. [REF02](../research/build-source-register.json) |
| brain | Python 3.13 modular service + FastAPI for loopback-only operator/status surface | Resident same-user process; preserve exact existing publisher interpreter separately. No remote canonical-writer endpoint. [REF07](../research/build-source-register.json) |
| journal | SQLite + SQLAlchemy + Alembic | Local nonsynced work journal; migrations from day one; not another academic database. [REF08](../research/build-source-register.json) |
| schemas | JSON Schema 2020-12 + Python jsonschema + Ajv 2020 | One schema set, generated TypeScript types, explicit cross-field checks; no incompatible duplicate Zod model. [REF07](../research/build-source-register.json) |
| drive | Google Identity Services token client + Drive v3 REST | Browser direct authorized access; separate DriveFS companion scan with signed paired bundles. No copied native connector credentials. [REF11](../research/build-source-register.json) |
| signing | WebCrypto P-256 + Python cryptography | Use maintained cryptographic primitives and exact-byte manifest signatures; no handwritten crypto algorithm. [REF19](../research/build-source-register.json) |
| schedule | py-fsrs | One PC scheduling owner and explicit rating adapter; diagnosis remains distinct. [REF18](../research/build-source-register.json) |
| tests | pytest + Vitest/Testing Library + Playwright + axe-core | Unit, integration, real-browser and accessibility checks with independent acceptance. [REF01](../research/build-source-register.json) |
| component-workbench | Storybook, local only | Reusable shared UI states and both themes; never upload private materials into a hosted design service by default. [REF02](../research/build-source-register.json) |

## What we are deliberately not adding
No Streamlit, Next.js/SSR requirement, hosted LLM SDK, microservice fleet, Kubernetes, Redis/Celery, additional canonical graph database, Redux for every component, multiple animation stacks, or automatic imports of upstream agent skills. CSS/HTML and existing functions remain preferable where sufficient. Native OpenAI is the first reasoning target; unavailable transport is BLOCKED, not a silent switch to a new API conversation.

## Assets and maintenance
Use system font stacks initially; preserve source typography. No font files are included here. Add approved open-license web fonts only after a concrete design need. Lucide icon glyphs and optional charts must have text alternatives. shadcn supplies editable source, not maintenance-free installed widgets: record imported revision, license and local changes. Use public APIs; source inspection via the existing opensrc/Graphify capability is optional research, not a runtime dependency.

## Processing
Reuse the current installed academic helpers and local transcription tools before creating replacements. The new processing adapter supports approved local transcription/alignment and optional isolated office conversion. Source fidelity, hardware throughput, model weights, third-party licensing and actual binary availability are LL015/LL024 evidence gates; their absence never permits fabricated timestamps or a paid fallback.

The dated [native documentation recheck](../research/native-documentation-recheck-2026-10-04.md)
keeps installed-runtime observations separate from evolving public documentation.


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0 (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). The selections above are unchanged. Three maintained components are added for the reopened requirements; they are recorded in [component-selection.json](component-selection.json) and the [source register](../research/build-source-register.json), and their decisions are D61 and D62 in [decisions and deviations](../implementation/decisions-and-deviations.md). Exact versions, licenses and integrity are established by the repository's lock files and dependency inventory when they are installed, not by this table.

| Component | Selection | Why / boundary |
|---|---|---|
| pptx-parse | python-pptx | Slide ids, order, titles, text and hidden flag of a PowerPoint source, only when one exists, for the read-side source map. Not a renderer, no deck writes, no Office automation; ordinals are never mapped onto PDF pages by position. [REF27](../research/build-source-register.json) |
| concept-graph-view | @xyflow/react | Node-link view of a concept's neighbourhood over the existing typed read model; the typed outline stays as the keyboard-usable alternative. [REF28](../research/build-source-register.json) |
| concept-graph-layout | @dagrejs/dagre | The one layout engine. ELK only with a documented compound-layout requirement, never both. [REF29](../research/build-source-register.json) |

Still deliberately not added: a second layout engine, a hand-built canvas, a second animation or styling system, any speech package in the repository environment, any hosted transcription. Offline transcription under R2 reuses the already verified local runtime and cached model outside the repository environment, within a persisted four-hour allowance; nothing is downloaded.
