# Research register — initial pass, 2026-10-02

Primary-source research supports candidate mechanisms and product comparison, not a guarantee
that this app improves grades or diagnoses every misconception. Vendor features below are
reported public capabilities, not independently tested performance or a comprehensive market
survey. No tools were installed and no competitor account was exercised.

## Learning and student modeling

**R01 — Retrieval practice.** Karpicke & Blunt, Science (2011), DOI 10.1126/science.1199327.
[Primary paper abstract](https://pubmed.ncbi.nlm.nih.gov/21252317/).
The experiment found retrieval benefits for meaningful learning and inference on studied science
texts. Design implication: include attempts without the answer visible, not only rereading.
Do not generalize this as 'concept maps never help' or as proof of this app's effectiveness.

**R02 — Self-explanation.** Chi et al., Cognitive Science (1994), DOI 10.1207/s15516709cog1803_3.
[Publisher abstract](https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog1803_3).
Prompted self-explanations improved understanding in a small school-text experiment. It supports
studying teach-back, not declaring that fluent paraphrase proves mastery or that every slide
requires a long spoken assessment.

**R03 — AI dependence.** Bastani et al., PNAS (2025), DOI 10.1073/pnas.2422633122.
[Primary article](https://doi.org/10.1073/pnas.2422633122).
A high-school mathematics experiment found that unguided AI help could improve assisted work
while harming subsequent unassisted performance; a guarded tutor largely mitigated the harm.
Scope: specific tutor designs and setting, not a verdict on every newer model or learning task.

**R04 — Structured AI tutoring.** Kestin et al., Scientific Reports (2025), DOI 10.1038/s41598-025-97652-6.
[Primary article](https://doi.org/10.1038/s41598-025-97652-6).
A study involving 194 undergraduate physics students and two lessons found greater learning
gains for its carefully designed AI condition. It used structured tasks and expert solutions.
This supports testing the instructional design, not assuming an arbitrary source-chat bot works.

**R05 — FSRS/Anki scheduling.** [Anki manual](https://docs.ankiweb.net/deck-options).
FSRS models forgetting and adapts scheduling from review history; scheduling is not equivalent
to identifying a missing prerequisite. Preserve successful recall versus failure semantics and
review burden. Candidate use here is scheduling only; no existing Anki collection is accessed.

**R06 — Knowledge tracing.** Corbett & Anderson, *Knowledge tracing: Modeling the acquisition of
procedural knowledge*, DOI 10.1007/BF01099821.
[Publisher abstract](https://link.springer.com/article/10.1007/BF01099821).
Estimates skill knowledge from performance in a modeled programming tutor. It motivates
skill-level evidence, but fitted/calibrated competence probabilities are not automatically
available for arbitrary lecture content. Begin with interpretable observations.

## Current products and the resulting product hypothesis

**R07 — RemNote.** [Lecture recorder](https://www.remnote.com/feature/lecture-recorder),
[recording help](https://help.remnote.com/en/articles/14498332-recording-and-transcribing-lectures),
[Guided Learn](https://help.remnote.com/en/articles/15724936-guided-learn-mode).
Documents timestamped transcripts, playback-linked notes, AI study materials and guided study
with topic progress. Lesson: basic recording/transcript/cards/progress is not a unique bundle.
No hands-on evidence here establishes its accuracy or missing capabilities.

**R08 — StudyFetch.** [Teach-back workflow](https://www.studyfetch.com/feynman-technique).
Documents source-based explanation, spoken teach-back and questions targeting gaps. Lesson:
teach-back is also not unique by itself. Our hypothesis must be tested on correction accuracy,
full source interoperability and longitudinal learning evidence, not a label.

**R15 — Genio Notes.** [Product page](https://genio.co/notes).
Documents integrated notes/slides/media, timestamps, annotations and learning tools. Lesson:
context-preserving media UX matters. Plan-specific/beta status varies and is not a promised
feature of this app.

**R16 — Scholium.** [Vendor changelog](https://www.scholium.org/changelog).
Documents a slide-alignment beta and cross-document linking. Treat these as vendor claims,
not independently verified quality or proof that every advertised workflow is currently usable.
They are enough to avoid claiming slide-linked playback is novel.

The proposed differentiation is the combined quality of precise, correctable cross-material
anchors; compatibility with the user's course repositories; and uncertainty-aware remediation
that improves later independent work. This is a product hypothesis, not an established market gap.

## Alignment and reusable implementation candidates

**R09 — MaViLS.** Anderer et al., Interspeech 2024, arXiv:2409.16765.
[Paper and abstract](https://arxiv.org/abs/2409.16765).
Combines speech/text/image signals for video–slide alignment and reports variation across
lectures. It suggests a multimodal, sequence-aware candidate approach. Reported matching
performance is not an exact timestamp guarantee for audio-only personal recordings.

**R10 — PDF.js.** [Official project](https://mozilla.github.io/pdf.js/).
A candidate web PDF parser/viewer. Rendering a page does not resolve semantic relations or
extract every formula/figure correctly. Validate source anchors in the actual reader.

**R11 — WhisperX.** [Maintainer repository](https://github.com/m-bain/whisperX).
Provides speech transcription/alignment with word-level timestamps and documents limitations,
including overlap and alignment coverage. Reuse supplied timestamps first; selecting a model
or regenerating transcripts requires a need and evaluation. It is not a slide-matching engine.

**R12 — ts-fsrs.** [Maintainer repository](https://github.com/open-spaced-repetition/ts-fsrs).
Candidate maintained TypeScript scheduler implementation. Inspect/pin/license-check/test the
actual version before use. No dependency installation or benchmark was performed here.

**R13 — Docling.** [Official documentation](https://docling-project.github.io/docling/).
Candidate structured-document ingestion tooling. Evaluate representative PDFs/PPTX/equations
rather than assuming all educational sources parse correctly. Do not OCR already adequate text.

**R14 — WCAG 2.2.** [W3C quick reference](https://www.w3.org/WAI/WCAG22/quickref/).
Use specific accessibility requirements to test interactions. Citation of a standard is not
conformance certification. The actual UI, assistive-tech experience and media remain untested.

## Private-source basis and qualification

U1 and U2: the two handwritten images supplied in this conversation. U3: the current user
message. They directly request the capabilities listed in the requirements register.

P01: `repository-standard.md`, prepared 2026-09-05, proposed/not deployed. Retrieved portions
cover preserved original bytes/names, lecture-versus-session identities, learning records,
source catalog, and explicit shared-concept relations. Do not treat the draft as a current
filesystem audit or an authorization to reorganize data.

P02: course-learning rollout prompts (`step-4b-main-paste-prompt.txt`,
`step-4d-main-paste-prompt.txt`, `step-5-shared-learning-paste-prompt.txt`, and related retrieved
snippets). They preserve optional learning modes, existing records, one source of authority,
and explicit limits on recorded historical test results. No live student competency or course
installation is inferred from these prompts.

P03: current Seed Repo README, identifying 0.5.0-rc.1 and the discovery → research → approved
specification → implementation workflow. This packet follows that process; it does not claim
to have executed or patched that starter.

An installed-repository search for BE562 returned no matches in the accessible GitHub set.
That does not mean the user lacks a course workspace: prior materials describe local/Drive-backed
paths, and a course workspace need not be hosted on GitHub. Actual roots, files and schemas
still require a representative sample or explicitly authorized connector identity.

## 0.2.0 update — event dispatch and current operational basis

P04 is the newly supplied `Pasted text.txt` operational report. Unlike the earlier proposed
repository standard, it describes an inspected installation and specific summary-freshness issues.
This discovery read the report, not the live course files. Its current-learning contract is retained
in [workspace compatibility](../project/existing-workspace-contract.md); actual schemas and active
permissions still need inspection. No source or learning record was migrated or repaired.

R17-R30 cover the new native event, CLI, subscription-backed and watcher research in
[agent-dispatch feasibility](agent-dispatch-feasibility.md). Sources were checked 2026-10-02.
Capabilities are provider descriptions, not verified on the user's account. Transport, auth,
plan eligibility, context access and semantic teaching quality require separate evidence.

## 0.3.0 whole-project review

[The focused provider recheck](dispatch-recheck-2026-10-02.md) retains the distinction between
primary documentation and native account/runtime verification. The 30 proposed questions and
trade-offs are design recommendations, not newly measured learning results. No application or
course-write scenario has been executed.

## P05 — Returned current-system audit

`Pasted text(1).txt`, dated 2026-10-02, answers Q001-Q108 with explicit OBS/CODE/CFG/HIST/DOC
classifications, complete reported lecture metadata and preserved writer semantics. It is the
current discovery basis over the older operation report P04. Reading it here is not independently
rerunning its commands or obtaining access to the referenced files/accounts. See
[audit provenance](audit-evidence.json), [reconciliation](../reviews/audit-reconciliation-2026-10-02.md),
and [the narrow public platform recheck](platform-boundaries-2026-10-02.md).
