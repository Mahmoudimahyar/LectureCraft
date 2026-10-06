# Current UI requirement index — tutoring, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| tutoring:REQ-101 | US021 | Get help when busy | UI11 |
| tutoring:REQ-102 | US022 | Choose depth after help | UI11 |
| tutoring:REQ-103 | US023 | Learn in layers | UI12 |
| tutoring:REQ-104 | US024 | Control tutor initiative | UI12 |
| tutoring:REQ-105 | US025 | Explain in my own words | UI13 |
| tutoring:REQ-106 | US026 | Keep complete evidence | UI13 |
| tutoring:REQ-107 | US027 | Speak a teach-back | UI14 |
| tutoring:REQ-108 | US028 | Control voice privacy | UI14 |
| tutoring:REQ-109 | US029 | Practice under clear conditions | UI15 |
| tutoring:REQ-110 | US030 | Get help without corrupting an attempt | UI15 |
| tutoring:REQ-111 | US031 | Find the cause of a mistake | UI16 |
| tutoring:REQ-112 | US032 | Limit diagnostic detours | UI16 |
| tutoring:REQ-113 | US033 | Dispute a mistaken assessment | UI17 |
| tutoring:REQ-114 | US034 | Separate corrections from new attempts | UI17 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Source-grounded tutoring and misconception repair

## User intent

Ask about the current slide/figure, explain the material in one's own words, connect it to
other concepts, and obtain useful correction. When answering incorrectly, receive help aimed
at the cause rather than another unsupported answer or endless repetition of the same card.

## Proposed tutoring policy

The current task mode and learner intent determine how active the tutor should be. Browse/ask
mode answers a question using selected sources and labels external explanatory additions.
Guided learning can invite a short explanation or prediction. Practice/assessment records
whether sources, hints or full solutions were exposed. No quiz is mandatory merely to read a
slide. Preserve the prior preference for user-selected modes and just-in-time assistance.

Use the current source anchor, relevant prerequisite concepts, reliable reference material
and necessary prior attempt evidence. Do not stream every earlier chat or the entire textbook
into each response. Distinguish instructor claims, source summaries, system-generated material
and independently verified reference answers. A transcript and recording of the same speech
are not two independent confirmations.

For diagrams/equations, check the actual figure or formula context. Missing labels, illegible
images or ambiguous problem wording trigger clarification. Source-grounded does not mean every
source is correct: expose conflicts and uncertainty rather than overriding a slide with the
model's unsupported preferred answer. The student can challenge feedback.

## Feedback contract

Identify the learner's specific claim, what is correct, what needs correction or was not
assessed, the evidence/rubric used, and one useful next step. Assess content, not eloquence.
Equivalent valid explanations/formulations should be accepted. Spoken-input recognition errors
must be corrected before using that response as strong learner-state evidence.

Use deterministic checks for supported calculations, algebraic constraints, units and task
structure when adequate. Open-ended judgments use versioned rubrics/reference answers and
an abstain/uncertain path. Correct-answer false negatives and confidently accepted misconceptions
are explicit benchmark failures. Confidence in a grader is distinct from confidence about a
learner's knowledge. Do not train a private teacher model by default.

## Bounded gap investigation

1. Preserve the actual response and assistance metadata.
2. Identify one or more plausible error explanations: prerequisite gap, concept confusion,
   formula/notation recall, procedural slip, misread prompt, ambiguous question, or input/AI error.
3. Ask a brief discriminating question when it is useful and the learner selected guided work.
   Do not declare a root cause from a single response or a request for help.
4. Show a targeted source explanation/example, optionally stepping down to the prerequisite.
5. Ask a different application or explanation to check the repair, not the just-revealed wording.
6. Save evidence and uncertainty; suggest a later independent check. Immediate assisted success
   does not become proof of retained competence. The user can skip or stop diagnostic detours.

Initial diagnostic depth/time limits are OPEN; a small bounded number of probes per detour is
proposed to avoid replacing efficient study with an interrogation. The system must explain why
it is revisiting a prerequisite and provide a direct route back to the slide/task.

## Hypothetical example

A student reverses the condition in a probability statement. The tutor should first distinguish
notation reversal from a probability-concept error using a small discriminating example. If the
condition/sample space is misunderstood, explain that prerequisite with the relevant source and
then present a fresh scenario. Do not immediately label all probability knowledge weak or generate
20 cards. This is an example flow, not an assessment of this user.

## Learning-evidence boundary

Self-explanation and retrieval-practice research inform this design [R01–R02]. Studies of AI
tutoring show both harmful unguarded answer dependence and benefits in carefully structured
settings [R03–R04]. They do not establish this app's effects. The outcome to measure is later
independent performance and task transfer, not polished conversation or answers accepted by AI.

## Preserve current tutoring modes and writer

The supplied operational report confirms learn/assess/produce/maintain modes and per-skill
outcomes. Use those existing mode semantics rather than deriving mode from an interface tab.
An Ask question need not open a quiz. Provider-generated correction proposals are not actual
new learner responses. Real source/attempt access and course-specific assistance rules constrain
each workflow. Native memories or unrelated chats cannot substitute for referenced course evidence.

## Full response and assessment compatibility — 0.6.0
Save submitted prompt/response once as an immutable sidecar under the current operational run
area, before inference. The tutor reply is a separate later immutable message. Verify the locator's
actual bytes, item and course/question/family/assessment binding; the current validator checks
only its string shape. Do not add error diagnosis to not_observed or widen the skills in a correction.
Use existing canonical writers; global ROOT makes installed BE 505 fixture redirection unsafe.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | Requirement (stories) |
|---|---|
| R1-P1 | The tutor's standing rules are built from a clause-level projection of the common tutoring policy and the current course files. Each clause keeps its source hash, span, id, category and applicability; excluded clauses keep a reason (US021–US026). |
| R1-P2 | Unrelated private context is removed clause by clause, never by withholding or sending a whole file. |
| R1-P3 | A projection cannot relax a course restriction. A changed source or an unresolved required rule area is exposed as a policy gap, never silently dropped and never replaced by the whole file. |
| R1-P4 | Rule areas that must be representable: mode and pacing, direct help, optional diagnostics, assistant-error and speech-recognition uncertainty, alternatives, assistance, source versus added clarification, owner save. |
| R1-P5 | A citation attached to a reply is not support for every sentence. Replies may itemize support per segment; a segment claiming course support without a valid supplied source is shown as added explanation. No ritual uncertainty wording (US021, US023). |
| R1-P6 | The spent pilot thread and ledger are never reused; no check in this amendment sends to a model. |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0 (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged. R2 reopens no native tutoring grant and adds no tutoring requirement of its own: no check of this amendment sends to a model or to the tutor, the spent pilot stays spent (R1-P6), and R1-P1 to R1-P5 stay in force. Two checks defined in other packets touch the Tutor tab and are listed here so that the tutoring tasks carry them:

| Check | Where defined | What it means for the Tutor tab (stories · flow) |
|---|---|---|
| R2-S8 | [evidence-alignment](../evidence-alignment/requirements.md) | On a structural page (title or section) the Tutor tab stays usable for a question the learner chooses to ask, but shows no prompt or requirement to explain the page back and offers no generated practice for it (US025, US029 · UI13, UI15). The learner would notice a failure as being asked to "explain this slide" on a cover page. |
| R2-V9 | [workspace-access](../workspace-access/requirements.md) | A draft in the composer, with its pinned source context, survives a theme change, an outline collapse, a panel resize, a tab change and a pane change (US025, US026 · UI13). The learner would notice a failure as typed text or its context chip disappearing. |

Tutor is the first of the five context tabs (R2-V3); its three interaction choices and their meaning are unchanged.
