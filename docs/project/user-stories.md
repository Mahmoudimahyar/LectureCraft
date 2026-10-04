# User-story and acceptance catalog — 0.8.0

64 stories, 192 planned behavior-specific acceptance cases. Generated from `experience-spec.json`.
Each story has a stable feature-namespaced requirement ID, one primary UI flow and existing backend
workflow/memory references. The 24 additional global UI checks and 76 prior workflow cases remain
separate. They are plans, not executable tests or observed PASS results.

The actor is one learner; operator actions are the same person exercising separately authorized
system privileges. No additional user role, public SaaS, payment workflow or permission grant is
implied. These product stories implement the current user goals while preserving course ownership.

| Story | Requirement | Title | Flow |
|---|---|---|---|
| US001 | workspace-access:REQ-101 | Connect without reorganizing | UI01 |
| US002 | workspace-access:REQ-102 | Understand permissions | UI01 |
| US003 | workspace-access:REQ-103 | Use another device | UI02 |
| US004 | workspace-access:REQ-104 | Sign out safely | UI02 |
| US005 | workspace-access:REQ-105 | See every lecture | UI03 |
| US006 | workspace-access:REQ-106 | Resume the right lecture | UI03 |
| US007 | workspace-access:REQ-107 | Find relevant material | UI04 |
| US008 | workspace-access:REQ-108 | Return after exploring | UI04 |
| US009 | workspace-access:REQ-109 | Add without duplication | UI05 |
| US010 | workspace-access:REQ-110 | Know preparation status | UI05 |
| US011 | evidence-alignment:REQ-101 | Read without clutter | UI06 |
| US012 | evidence-alignment:REQ-102 | Navigate predictably | UI06 |
| US013 | evidence-alignment:REQ-103 | Listen to relevant content | UI07 |
| US014 | evidence-alignment:REQ-104 | Control recording behavior | UI07 |
| US015 | evidence-alignment:REQ-105 | Read along accurately | UI08 |
| US016 | evidence-alignment:REQ-106 | Use transcript evidence | UI08 |
| US017 | evidence-alignment:REQ-107 | Connect study to practice | UI09 |
| US018 | evidence-alignment:REQ-108 | Keep source exploration reversible | UI09 |
| US019 | evidence-alignment:REQ-109 | Correct inaccurate matching | UI10 |
| US020 | evidence-alignment:REQ-110 | Handle source changes honestly | UI10 |
| US021 | tutoring:REQ-101 | Get help when busy | UI11 |
| US022 | tutoring:REQ-102 | Choose depth after help | UI11 |
| US023 | tutoring:REQ-103 | Learn in layers | UI12 |
| US024 | tutoring:REQ-104 | Control tutor initiative | UI12 |
| US025 | tutoring:REQ-105 | Explain in my own words | UI13 |
| US026 | tutoring:REQ-106 | Keep complete evidence | UI13 |
| US027 | tutoring:REQ-107 | Speak a teach-back | UI14 |
| US028 | tutoring:REQ-108 | Control voice privacy | UI14 |
| US029 | tutoring:REQ-109 | Practice under clear conditions | UI15 |
| US030 | tutoring:REQ-110 | Get help without corrupting an attempt | UI15 |
| US031 | tutoring:REQ-111 | Find the cause of a mistake | UI16 |
| US032 | tutoring:REQ-112 | Limit diagnostic detours | UI16 |
| US033 | tutoring:REQ-113 | Dispute a mistaken assessment | UI17 |
| US034 | tutoring:REQ-114 | Separate corrections from new attempts | UI17 |
| US035 | evidence-alignment:REQ-111 | Keep useful references | UI18 |
| US036 | evidence-alignment:REQ-112 | Ask about a figure or written work | UI18 |
| US037 | progress:REQ-101 | See how ideas connect | UI19 |
| US038 | progress:REQ-102 | Inspect rather than infer knowledge | UI19 |
| US039 | progress:REQ-103 | Understand my gaps | UI20 |
| US040 | progress:REQ-104 | Prioritize without invented probabilities | UI20 |
| US041 | progress:REQ-105 | See what I actually said | UI21 |
| US042 | progress:REQ-106 | Understand changes over time | UI21 |
| US043 | review:REQ-101 | Use good questions rather than a large backlog | UI22 |
| US044 | review:REQ-102 | Choose whether an item is scheduled | UI22 |
| US045 | review:REQ-103 | Keep cards useful | UI23 |
| US046 | review:REQ-104 | Manage duplicates safely | UI23 |
| US047 | review:REQ-105 | Practice at useful intervals | UI24 |
| US048 | review:REQ-106 | Get adaptive help without fake scheduling evidence | UI24 |
| US049 | agent-dispatch:REQ-101 | See what is actually happening | UI25 |
| US050 | agent-dispatch:REQ-102 | Cancel and retry safely | UI25 |
| US051 | workspace-access:REQ-111 | Continue naturally | UI26 |
| US052 | workspace-access:REQ-112 | Resolve conflicts without losing responses | UI26 |
| US053 | agent-dispatch:REQ-103 | Keep studying during interruptions | UI27 |
| US054 | agent-dispatch:REQ-104 | Recover without unexpected spending | UI27 |
| US055 | workspace-access:REQ-113 | Study comfortably day and night | UI28 |
| US056 | workspace-access:REQ-114 | Preserve sources and focus when theming | UI28 |
| US057 | agent-dispatch:REQ-105 | Know the actual AI destination | UI29 |
| US058 | agent-dispatch:REQ-106 | Set boundaries once | UI29 |
| US059 | workspace-access:REQ-115 | Take my study history with me | UI30 |
| US060 | workspace-access:REQ-116 | Control retention honestly | UI30 |
| US061 | progress:REQ-107 | Stop without losing the thread | UI31 |
| US062 | progress:REQ-108 | Keep study aligned with my schedule | UI31 |
| US063 | agent-dispatch:REQ-107 | Understand repair actions | UI32 |
| US064 | agent-dispatch:REQ-108 | Verify recovery effects | UI32 |

### US001 — Connect without reorganizing

**Requirement:** `workspace-access:REQ-101` · **Flow:** UI01 · **Status:** specified, not implemented

As the learner, I want to connect my current course folders without moving their originals, so that the app works with my existing system.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC001 | a valid configured course | I authorize its supported read path | its existing source IDs and folders are reused; no duplicate course or source migration is created | NOT_RUN |
| UXAC002 | read access but no verified AI route | I open a lecture | readable sources open and the AI action explains its blocked state | NOT_RUN |
| UXAC003 | a same-named snapshot folder | I choose the connection | the app asks for a valid identity/binding rather than choosing by title alone | NOT_RUN |

### US002 — Understand permissions

**Requirement:** `workspace-access:REQ-102` · **Flow:** UI01 · **Status:** specified, not implemented

As the learner, I want to see and control each connection permission, so that access is not confused with permission to change my history.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC004 | the permission review | I decline optional processing | no optional request runs and existing permitted browsing remains usable | NOT_RUN |
| UXAC005 | native login exists | setup checks run | the UI does not infer target, tools or a process return channel from login alone | NOT_RUN |
| UXAC006 | a task file says approved=true | it reaches admission | that field cannot grant access or activate a writer | NOT_RUN |

### US003 — Use another device

**Requirement:** `workspace-access:REQ-103` · **Flow:** UI02 · **Status:** specified, not implemented

As the learner, I want to reach the same course content on a second device, so that I can study away from the execution PC.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC007 | a course source with no local G: path | I open it on an authorized phone | the app resolves portable identity or reports unsupported access without substituting another file | NOT_RUN |
| UXAC008 | an old synchronized checkpoint | I choose Resume | its timestamp is visible and newer local-only work is not claimed received | NOT_RUN |
| UXAC009 | a saved checkpoint | resume finishes | media is paused until I press Play | NOT_RUN |

### US004 — Sign out safely

**Requirement:** `workspace-access:REQ-104` · **Flow:** UI02 · **Status:** specified, not implemented

As the learner, I want to understand what happens to drafts and jobs when signing out, so that I do not lose work or assume tasks were cancelled.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC010 | a local-only draft | I request sign-out | I can return, export the draft or explicitly discard it before local removal | NOT_RUN |
| UXAC011 | an accepted native request | I sign out without cancelling it | the UI says that sign-out does not establish terminal cancellation | NOT_RUN |
| UXAC012 | synchronized attempts | device sign-out succeeds | course evidence is not deleted and provider-history deletion is not claimed | NOT_RUN |

### US005 — See every lecture

**Requirement:** `workspace-access:REQ-105` · **Flow:** UI03 · **Status:** specified, not implemented

As the learner, I want to see all configured lectures with honest availability, so that unfinished preparation does not hide material from my course.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC013 | a course with prepared and unprocessed decks | I open the course | both are listed and preparation counts identify the denominator | NOT_RUN |
| UXAC014 | an empty deck and an unrecorded lecture | I inspect their status | different explanations appear and neither claims a future verified original | NOT_RUN |
| UXAC015 | a course with zero stored attempts | I open its summary | it says Not assessed rather than learned nothing | NOT_RUN |

### US006 — Resume the right lecture

**Requirement:** `workspace-access:REQ-106` · **Flow:** UI03 · **Status:** specified, not implemented

As the learner, I want to return to my previous source and position, so that I do not spend time reconstructing my session.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC016 | a valid checkpoint | I choose Continue | course, deck version and slide identity match the checkpoint | NOT_RUN |
| UXAC017 | a reordered source | I resume | the app offers verified remapping or explicit comparison rather than using the old page number silently | NOT_RUN |
| UXAC018 | a lecture loaded | I browse without answering | no success, failure or learner attempt is generated | NOT_RUN |

### US007 — Find relevant material

**Requirement:** `workspace-access:REQ-107` · **Flow:** UI04 · **Status:** specified, not implemented

As the learner, I want to search permitted course material and questions by concept, so that I can move directly to the source I need.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC019 | current-course scope | I search a shared label | course-qualified result types prevent cross-course identity merging | NOT_RUN |
| UXAC020 | a verified passage result | I open it | its exact version and available locator are shown | NOT_RUN |
| UXAC021 | unindexed content | search has no results | the app distinguishes no match in indexed data from absence in the course | NOT_RUN |

### US008 — Return after exploring

**Requirement:** `workspace-access:REQ-108` · **Flow:** UI04 · **Status:** specified, not implemented

As the learner, I want to search without losing my draft or place, so that reference lookup does not interrupt thinking.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC022 | a draft explanation | I open a source result and return | the original draft and pinned context survive | NOT_RUN |
| UXAC023 | a restricted practice context | I search | hidden solution payloads do not appear in previews | NOT_RUN |
| UXAC024 | a search overlay open | I close it by keyboard | focus returns to the trigger without submitting or playing anything | NOT_RUN |

### US009 — Add without duplication

**Requirement:** `workspace-access:REQ-109` · **Flow:** UI05 · **Status:** specified, not implemented

As the learner, I want to bring new lecture material into the existing course workspace, so that it joins the correct source pipeline.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC025 | an authorized file selection | I confirm its destination | the app preserves original identity/name and uses the existing source owner | NOT_RUN |
| UXAC026 | a duplicate import | registration processes it | it is identified or reconciled rather than counted as new learning material automatically | NOT_RUN |
| UXAC027 | an unavailable upload grant | I try to add material | the app blocks this action without silently using another account | NOT_RUN |

### US010 — Know preparation status

**Requirement:** `workspace-access:REQ-110` · **Flow:** UI05 · **Status:** specified, not implemented

As the learner, I want to see which preparation steps are complete or waiting, so that I can use available material without mistaking it for fully linked content.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC028 | a deck rendered but not aligned | I inspect it | rendering and matching have separate statuses | NOT_RUN |
| UXAC029 | a batch exceeding the updater limit | processing pauses | the remaining backlog remains explicit and no competing updater starts | NOT_RUN |
| UXAC030 | an uncertain material role | processing reaches ownership validation | the item waits for classification instead of becoming an instructor source | NOT_RUN |

### US011 — Read without clutter

**Requirement:** `evidence-alignment:REQ-101` · **Flow:** UI06 · **Status:** specified, not implemented

As the learner, I want to keep the slide dominant and adjust surrounding panels, so that equations and figures stay readable.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC031 | the lecture workspace | I collapse the navigator or side panel | the source expands without discarding panel state or drafts | NOT_RUN |
| UXAC032 | Focus mode | I exit it | the original layout and source position return | NOT_RUN |
| UXAC033 | unverified extracted text | I select readable view | the app labels the rendition and keeps original-source access | NOT_RUN |

### US012 — Navigate predictably

**Requirement:** `evidence-alignment:REQ-102` · **Flow:** UI06 · **Status:** specified, not implemented

As the learner, I want to change slides without unintended input or playback effects, so that I stay in control of the session.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC034 | a clip playing | I navigate to another slide | it pauses by default and the next clip does not autoplay | NOT_RUN |
| UXAC035 | a draft about an earlier slide | I navigate and press Send | its pinned source context remains visible and is not silently rewritten | NOT_RUN |
| UXAC036 | text editor focus | I press an arrow key | the cursor moves rather than changing slides | NOT_RUN |

### US013 — Listen to relevant content

**Requirement:** `evidence-alignment:REQ-103` · **Flow:** UI07 · **Status:** specified, not implemented

As the learner, I want to play only the selected segment linked to my slide, so that I avoid scrubbing through the whole lecture.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC037 | a supported verified interval | I press Play segment | the correct media/range plays and stops at its end within the agreed media tolerance | NOT_RUN |
| UXAC038 | two disjoint occurrences | I choose the second | the first and intervening unrelated content are not played | NOT_RUN |
| UXAC039 | only an untimed transcript link | I open the player | no exact segment is claimed and the original recording may be opened separately | NOT_RUN |

### US014 — Control recording behavior

**Requirement:** `evidence-alignment:REQ-104` · **Flow:** UI07 · **Status:** specified, not implemented

As the learner, I want to pause, repeat, change speed and open the full recording deliberately, so that playback follows my study needs.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC040 | repeat off | the clip ends | playback stops without moving me to another slide | NOT_RUN |
| UXAC041 | a playing clip | I change the interface theme | the media element and current time remain intact | NOT_RUN |
| UXAC042 | clip mode | I choose Whole recording | the broader playback scope is clearly labeled and entered by my action | NOT_RUN |

### US015 — Read along accurately

**Requirement:** `evidence-alignment:REQ-105` · **Flow:** UI08 · **Status:** specified, not implemented

As the learner, I want to see the relevant transcript and follow supported timing, so that I can connect what I hear to the material.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC043 | verified timed spans | playback advances | the matching span highlights without claiming unsupported word precision | NOT_RUN |
| UXAC044 | plain untimed TXT | I open it | line references work and timed highlights are absent | NOT_RUN |
| UXAC045 | I scrolled to a different paragraph | playback continues | auto-follow stays paused until I request it | NOT_RUN |

### US016 — Use transcript evidence

**Requirement:** `evidence-alignment:REQ-106` · **Flow:** UI08 · **Status:** specified, not implemented

As the learner, I want to quote or question an exact transcript range, so that the tutor responds to the right source.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC046 | a selected range | I choose Ask about this | the request pins its source/version/locator and quoted text | NOT_RUN |
| UXAC047 | a timing link no longer current | I select a line | the UI reports staleness before treating it as a precise media position | NOT_RUN |
| UXAC048 | a transcript error | I propose a correction | the original and proposal remain distinct pending the source owner | NOT_RUN |

### US017 — Connect study to practice

**Requirement:** `evidence-alignment:REQ-107` · **Flow:** UI09 · **Status:** specified, not implemented

As the learner, I want to open exact related problems and reading, so that I can apply the lecture without hunting through files.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC049 | a related multi-part problem | I open it | the relevant subpart plus necessary givens and figures are available | NOT_RUN |
| UXAC050 | a broad chapter reference | I inspect it | the link does not assert an exact page not established by the source | NOT_RUN |
| UXAC051 | a versioned citation | I follow it | the cited version opens or historical unavailability is disclosed | NOT_RUN |

### US018 — Keep source exploration reversible

**Requirement:** `evidence-alignment:REQ-108` · **Flow:** UI09 · **Status:** specified, not implemented

As the learner, I want to return to the same lecture state after reading related material, so that exploring does not disrupt my work.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC052 | a draft and paused media time | I open and close a textbook | the draft, slide and media position return | NOT_RUN |
| UXAC053 | solution material excluded | I open the problem | no hidden solution payload is delivered via another field | NOT_RUN |
| UXAC054 | an inaccessible source | I request it | the app explains the restriction without borrowing another account | NOT_RUN |

### US019 — Correct inaccurate matching

**Requirement:** `evidence-alignment:REQ-109` · **Flow:** UI10 · **Status:** specified, not implemented

As the learner, I want to adjust or reject a suggested source connection, so that I can fix mistakes without losing my correction later.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC055 | a suggested clip | I submit valid revised bounds | an owned versioned proposal/annotation is retained rather than just editing a cache | NOT_RUN |
| UXAC056 | invalid bounds | I submit | inline validation identifies the fields and no publication occurs | NOT_RUN |
| UXAC057 | an accepted correction | derived output is rebuilt | the manual correction remains represented | NOT_RUN |

### US020 — Handle source changes honestly

**Requirement:** `evidence-alignment:REQ-110` · **Flow:** UI10 · **Status:** specified, not implemented

As the learner, I want to review affected links when source versions change, so that old evidence is not attached to the wrong new content.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC058 | a reordered deck | the app detects a new version | affected old anchors are flagged and not silently reused | NOT_RUN |
| UXAC059 | a concurrent correction | my save reaches the writer | both bases are retained and the conflict is visible | NOT_RUN |
| UXAC060 | I reverse a correction | the owner accepts the reversal | a new revision is recorded without deleting prior evidence | NOT_RUN |

### US021 — Get help when busy

**Requirement:** `tutoring:REQ-101` · **Flow:** UI11 · **Status:** specified, not implemented

As the learner, I want to get a concise direct answer when I ask for one, so that I can keep studying within my time limits.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC061 | permitted question and Quick answer | I send it | the answer comes first without requiring a diagnostic quiz | NOT_RUN |
| UXAC062 | a pure help request | the answer is delivered | no canonical learner attempt or mastery change is created | NOT_RUN |
| UXAC063 | an unavailable native route | I send | the request state and preserved input are shown without a silent paid fallback | NOT_RUN |

### US022 — Choose depth after help

**Requirement:** `tutoring:REQ-102` · **Flow:** UI11 · **Status:** specified, not implemented

As the learner, I want to move from a quick answer into explanation or teach-back, so that depth matches my needs rather than a fixed lesson script.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC064 | a quick reply | I select Go deeper | the same sourced thread continues with guided explanation | NOT_RUN |
| UXAC065 | a quick reply | I leave | no diagnostic job invents answers or records a failure | NOT_RUN |
| UXAC066 | existing older performance evidence | this exchange is not assessed | the label refers only to this exchange and does not reset history | NOT_RUN |

### US023 — Learn in layers

**Requirement:** `tutoring:REQ-103` · **Flow:** UI12 · **Status:** specified, not implemented

As the learner, I want to ask for examples and connections at my chosen depth, so that I understand rather than only receive an answer.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC067 | an explanation | I ask for a contrasting example | the tutor addresses the same concept with permitted sources and labels invented examples | NOT_RUN |
| UXAC068 | no concept-tree mapping | I ask about a readable slide | help remains possible and missing mapping is not called learner weakness | NOT_RUN |
| UXAC069 | a lengthy detour | I request a short answer | the reply becomes concise without an obligatory quiz | NOT_RUN |

### US024 — Control tutor initiative

**Requirement:** `tutoring:REQ-104` · **Flow:** UI12 · **Status:** specified, not implemented

As the learner, I want to accept or decline follow-up checks, so that the tutor respects my schedule and agency.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC070 | a proposed check | I decline | no unobserved skill is marked failed | NOT_RUN |
| UXAC071 | a substantive follow-up response | I submit it for feedback | its actual input and assistance can enter the assessment workflow | NOT_RUN |
| UXAC072 | two sources disagree | the tutor explains | it attributes the conflict instead of claiming one unverified statement is settled | NOT_RUN |

### US025 — Explain in my own words

**Requirement:** `tutoring:REQ-105` · **Flow:** UI13 · **Status:** specified, not implemented

As the learner, I want to submit my understanding and receive criterion-based feedback, so that I can identify what I expressed correctly and what needs work.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC073 | a valid question and rubric | I submit a response | feedback assesses the intended criteria and preserves the actual assistance | NOT_RUN |
| UXAC074 | a correct alternative wording | assessment runs | it is not rejected just for differing from a reference answer | NOT_RUN |
| UXAC075 | an unasked or unreached skill | feedback is produced | it remains not_observed without an error diagnosis | NOT_RUN |

### US026 — Keep complete evidence

**Requirement:** `tutoring:REQ-106` · **Flow:** UI13 · **Status:** specified, not implemented

As the learner, I want to retain my exact response before assessment, so that failures and later corrections cannot erase what I wrote.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC076 | submitted text and necessary figure | native generation fails | the verified full input remains and assessment is pending | NOT_RUN |
| UXAC077 | the same response resent after uncertainty | admission reconciles it | it is not a second learner attempt | NOT_RUN |
| UXAC078 | an attempt saved but view refresh failed | I inspect status | saved evidence and stale derived view are distinguished | NOT_RUN |

### US027 — Speak a teach-back

**Requirement:** `tutoring:REQ-107` · **Flow:** UI14 · **Status:** specified, not implemented

As the learner, I want to record an explanation and check the transcript before assessment, so that speech recognition does not misrepresent my knowledge.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC079 | an approved capture route | I start recording | lecture playback pauses and recording is visibly indicated | NOT_RUN |
| UXAC080 | a misrecognized technical term | I correct it before submitting | assessment uses the confirmed response and preserves stated recognition lineage | NOT_RUN |
| UXAC081 | unresolved wording | I submit with uncertainty marked | the grader may abstain or ask clarification rather than invent a specific error | NOT_RUN |

### US028 — Control voice privacy

**Requirement:** `tutoring:REQ-108` · **Flow:** UI14 · **Status:** specified, not implemented

As the learner, I want to choose permitted processing and raw-audio retention, so that speaking does not imply unlimited recording or storage.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC082 | no microphone permission | I press Record | the app requests supported permission or offers typing without starting capture | NOT_RUN |
| UXAC083 | transcript-only retention | I submit | the transcript is retained and raw-audio availability is honestly recorded under the selected policy | NOT_RUN |
| UXAC084 | recording in progress | I try to leave | I receive explicit stop/cancel handling and no hidden capture continues | NOT_RUN |

### US029 — Practice under clear conditions

**Requirement:** `tutoring:REQ-109` · **Flow:** UI15 · **Status:** specified, not implemented

As the learner, I want to answer a real question with transparent access to references, so that feedback describes what I actually demonstrated.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC085 | practice begins | the question is displayed | all required figures/givens and source visibility are apparent | NOT_RUN |
| UXAC086 | I request a formula hint | I later answer correctly | assistance remains recorded and formula recall is not marked independent | NOT_RUN |
| UXAC087 | I skip without an answer | I move on | no failed learner response is fabricated | NOT_RUN |

### US030 — Get help without corrupting an attempt

**Requirement:** `tutoring:REQ-110` · **Flow:** UI15 · **Status:** specified, not implemented

As the learner, I want to choose when to reveal assistance, so that my recorded performance is not silently reclassified.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC088 | an unfinished answer | I request the solution | I can submit first or reveal permitted help without assessment | NOT_RUN |
| UXAC089 | source-hidden practice | I reveal a reference | actual exposure is recorded and the UI no longer implies no reference use | NOT_RUN |
| UXAC090 | restricted assessed coursework | I request disallowed help | the course boundary is explained and allowed conceptual assistance remains available | NOT_RUN |

### US031 — Find the cause of a mistake

**Requirement:** `tutoring:REQ-111` · **Flow:** UI16 · **Status:** specified, not implemented

As the learner, I want to answer a targeted diagnostic when useful, so that the tutor can distinguish misunderstanding from a slip or recognition error.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC091 | several plausible causes | I start a diagnostic | the tutor asks a question that distinguishes them rather than declaring one certain | NOT_RUN |
| UXAC092 | new evidence contradicts the first hypothesis | feedback updates | the competing interpretation is visible and the original is not silently erased | NOT_RUN |
| UXAC093 | a failed advanced application | the gap view updates | unobserved prerequisite skills are not automatically marked weak | NOT_RUN |

### US032 — Limit diagnostic detours

**Requirement:** `tutoring:REQ-112` · **Flow:** UI16 · **Status:** specified, not implemented

As the learner, I want to pause, stop or deepen a diagnostic deliberately, so that the tutor respects my time and learning goals.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC094 | a diagnostic question waiting | I leave it unanswered | the worker waits and no learner response is simulated | NOT_RUN |
| UXAC095 | the short detour is finished | more investigation might help | I choose whether to continue or return | NOT_RUN |
| UXAC096 | I return to the lecture | navigation completes | the original slide and draft/resume context are restored | NOT_RUN |

### US033 — Dispute a mistaken assessment

**Requirement:** `tutoring:REQ-113` · **Flow:** UI17 · **Status:** specified, not implemented

As the learner, I want to challenge feedback with evidence, so that an AI error does not become permanent learning history.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC097 | I disagree with a judgment | I submit an explanation | the original stays visible and the dispute is pending rather than instantly resolved | NOT_RUN |
| UXAC098 | a valid same-skill regrade is accepted | progress refreshes | effective observations change without a second learner trial | NOT_RUN |
| UXAC099 | another correction already superseded the base | my proposal arrives | the conflict is surfaced instead of creating a branching accepted chain | NOT_RUN |

### US034 — Separate corrections from new attempts

**Requirement:** `tutoring:REQ-114` · **Flow:** UI17 · **Status:** specified, not implemented

As the learner, I want to choose between fixing capture and answering again, so that dates and evidence accurately reflect what occurred.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC100 | a transcription mistake | I correct captured wording | new linked evidence is retained without overwriting the original snapshot | NOT_RUN |
| UXAC101 | I learned more and answer again | I submit the new response | a new attempt with new conditions is created | NOT_RUN |
| UXAC102 | a rubric change requires different skills | review reaches validation | it is not forced into an incompatible assessment_revision | NOT_RUN |

### US035 — Keep useful references

**Requirement:** `evidence-alignment:REQ-111` · **Flow:** UI18 · **Status:** specified, not implemented

As the learner, I want to save notes and bookmarks attached to exact sources, so that I can revisit my own observations without losing their context.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC103 | a selected source passage | I save a note | the note is learner-authored work linked to the exact source version | NOT_RUN |
| UXAC104 | I highlight a figure | the annotation saves | no mastery event or instructor-source claim is created | NOT_RUN |
| UXAC105 | the source moves | I reopen the note | stable identity resolves it or explicitly reports unavailable history | NOT_RUN |

### US036 — Ask about a figure or written work

**Requirement:** `evidence-alignment:REQ-112` · **Flow:** UI18 · **Status:** specified, not implemented

As the learner, I want to attach the relevant visual context deliberately, so that the tutor does not guess from missing diagrams or recognition errors.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC106 | a selected diagram | I choose Ask about this | the request includes the permitted crop/full-source reference and states its origin | NOT_RUN |
| UXAC107 | handwriting recognition is unverified | I submit an image | the app does not claim a reliable transcription or auto-grade guessed symbols | NOT_RUN |
| UXAC108 | a selection needs precision dragging | I use keyboard alternatives | I can attach the whole slide or specify a textual locator | NOT_RUN |

### US037 — See how ideas connect

**Requirement:** `progress:REQ-101` · **Flow:** UI19 · **Status:** specified, not implemented

As the learner, I want to explore the relevant concepts and skills in a multilayer view, so that I can connect the slide to supporting ideas.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC109 | one concept referenced in several branches | I expand them | each points to the same ID rather than duplicating definitions | NOT_RUN |
| UXAC110 | a question-containment edge | the tree renders it | its question endpoints and meaning remain explicit | NOT_RUN |
| UXAC111 | a legitimate association cycle | I expand the neighborhood | the view bounds traversal and stays usable | NOT_RUN |

### US038 — Inspect rather than infer knowledge

**Requirement:** `progress:REQ-102` · **Flow:** UI19 · **Status:** specified, not implemented

As the learner, I want to open actual evidence for a related skill, so that connections do not masquerade as mastery.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC112 | related cross-course items | I inspect progress | original attempts are referenced once and no transfer credit is granted | NOT_RUN |
| UXAC113 | a missing catalog node | I open the slide | it is labeled a mapping gap without a learner diagnosis | NOT_RUN |
| UXAC114 | a prerequisite check is suggested | I decline it | the underlying skill remains unobserved rather than failed | NOT_RUN |

### US039 — Understand my gaps

**Requirement:** `progress:REQ-103` · **Flow:** UI20 · **Status:** specified, not implemented

As the learner, I want to see the evidence, help conditions and uncertainty behind a learning gap, so that I know what to work on without overinterpreting a score.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC115 | partial and assisted successes | I inspect a skill | conditions remain visible and comparable observations are grouped honestly | NOT_RUN |
| UXAC116 | no recorded attempts | I open a concept | Not assessed appears instead of 0% knowledge | NOT_RUN |
| UXAC117 | a retracted judgment in an old summary | current evidence loads | the outdated claim is removed from the current projection or the view is marked stale | NOT_RUN |

### US040 — Prioritize without invented probabilities

**Requirement:** `progress:REQ-104` · **Flow:** UI20 · **Status:** specified, not implemented

As the learner, I want to distinguish exam relevance, foundations and personal need, so that my limited study time goes where I choose.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC118 | source-backed objectives | I open importance | the reason and source are visible without invented exam likelihood | NOT_RUN |
| UXAC119 | I defer a skill | the preference saves | recorded performance and deadlines do not change | NOT_RUN |
| UXAC120 | an assisted correction | a review becomes due later | the system does not claim verified independent retention or measured forgetting | NOT_RUN |

### US041 — See what I actually said

**Requirement:** `progress:REQ-105` · **Flow:** UI21 · **Status:** specified, not implemented

As the learner, I want to inspect original prompts, responses and delivered feedback, so that my learning history is auditable and useful.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC121 | a new full captured turn | I open history | the full visible prompt/response and relevant attachments are reachable | NOT_RUN |
| UXAC122 | an older excerpt-only attempt | I open it | the UI states the limitation instead of fabricating missing text or audio | NOT_RUN |
| UXAC123 | response time unknown | I inspect the timestamp | recorded_at is not mislabeled as the exact answering time | NOT_RUN |

### US042 — Understand changes over time

**Requirement:** `progress:REQ-106` · **Flow:** UI21 · **Status:** specified, not implemented

As the learner, I want to compare original and effective assessments, so that corrections and genuine new performances remain distinct.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC124 | one regraded response | I compare history | one learner attempt plus its correction chain is shown | NOT_RUN |
| UXAC125 | a historical source is unavailable | I open the citation | unavailability is stated and a newer edition is not silently substituted | NOT_RUN |
| UXAC126 | I choose Try again | I submit | a new current attempt references its own actual source/conditions | NOT_RUN |

### US043 — Use good questions rather than a large backlog

**Requirement:** `review:REQ-101` · **Flow:** UI22 · **Status:** specified, not implemented

As the learner, I want to select existing questions or create a source-linked question of my own, so that review stays relevant and manageable.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC127 | an existing matching question | I request a review item | the app offers reuse before generating a duplicate | NOT_RUN |
| UXAC128 | a learner-authored item or an AI-generated proposal | I preview and save it | the prompt, required givens/figures, origin, intended skill and supporting material are preserved; missing rubric support prevents a Ready for assessment claim | NOT_RUN |
| UXAC129 | I reject a proposal | the choice saves | no attempt or review event is added | NOT_RUN |

### US044 — Choose whether an item is scheduled

**Requirement:** `review:REQ-102` · **Flow:** UI22 · **Status:** specified, not implemented

As the learner, I want to save a question without automatically making it due, so that I control my review workload.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC130 | a question preview | I select Save only | it is saved but absent from the due queue | NOT_RUN |
| UXAC131 | an approved active scheduler | I choose Add to review | the item/version and initial scheduling policy are explicit | NOT_RUN |
| UXAC132 | scheduler unavailable | I save a question | the UI says Saved for later, not Review scheduled | NOT_RUN |

### US045 — Keep cards useful

**Requirement:** `review:REQ-103` · **Flow:** UI23 · **Status:** specified, not implemented

As the learner, I want to edit my review items and suspend unwanted ones, so that the queue adapts without rewriting old answers.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC133 | an item with previous attempts | I edit its reasoning requirements | a versioned change preserves earlier prompt/assessment references | NOT_RUN |
| UXAC134 | an instructor question | I try to modify it | the app offers a separate owned proposal/copy rather than replacing the original source | NOT_RUN |
| UXAC135 | I suspend an item | due list refreshes | the item is no longer actively due but its history survives | NOT_RUN |

### US046 — Manage duplicates safely

**Requirement:** `review:REQ-104` · **Flow:** UI23 · **Status:** specified, not implemented

As the learner, I want to remove redundant review entries without merging different evidence, so that I avoid busywork while keeping records accurate.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC136 | two selected references to the same logical item | I resolve them | selection can be deduplicated without duplicating or losing attempts | NOT_RUN |
| UXAC137 | two questions share a label but test different actions | I inspect merge options | the system does not silently merge skills/families | NOT_RUN |
| UXAC138 | a changed item needs schedule recalculation | the scheduler updates | no new learner review is inserted | NOT_RUN |

### US047 — Practice at useful intervals

**Requirement:** `review:REQ-105` · **Flow:** UI24 · **Status:** specified, not implemented

As the learner, I want to review selected material and see meaningful feedback, so that I test retention and application rather than only reread.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC139 | a selected due item | I start review | the exact item version and permitted help are visible | NOT_RUN |
| UXAC140 | an actual response | I submit it | its observation and one associated review event are recorded | NOT_RUN |
| UXAC141 | I stop early | the session ends | unanswered remaining items are not marked failed or completed | NOT_RUN |

### US048 — Get adaptive help without fake scheduling evidence

**Requirement:** `review:REQ-106` · **Flow:** UI24 · **Status:** specified, not implemented

As the learner, I want to receive help after mistakes without losing assistance and uncertainty, so that review dates and gap records remain honest.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC142 | an uncertain grade | scheduling evaluates the event | it waits or uses an explicit reviewed rating policy rather than automatically assigning failure | NOT_RUN |
| UXAC143 | the same review event delivered twice | reconciliation runs | the schedule changes once | NOT_RUN |
| UXAC144 | a hinted correction | feedback appears | it is not presented as independent delayed recall | NOT_RUN |

### US049 — See what is actually happening

**Requirement:** `agent-dispatch:REQ-101` · **Flow:** UI25 · **Status:** specified, not implemented

As the learner, I want to inspect the distinct stages of my request, so that a spinner or notification is not mistaken for a saved answer.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC145 | a bundle only stored on this device | I inspect status | it says local-only/not yet delivered, not Received by Brain | NOT_RUN |
| UXAC146 | an answer available but attempt not committed | I view the result | answer and canonical save states are separate | NOT_RUN |
| UXAC147 | an update for another slide arrives | I am working elsewhere | Activity records it without replacing the current source or draft | NOT_RUN |

### US050 — Cancel and retry safely

**Requirement:** `agent-dispatch:REQ-102` · **Flow:** UI25 · **Status:** specified, not implemented

As the learner, I want to stop or recover work without duplicate learning records, so that network/native failures do not corrupt history.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC148 | a running request | I select Cancel | Cancellation requested remains until actual terminal evidence is known | NOT_RUN |
| UXAC149 | possible completion is unknown | I open Retry | reconciliation precedes any resend and unsafe automatic retries are blocked | NOT_RUN |
| UXAC150 | a superseded worker returns | its output reaches publication | it cannot overwrite the current accepted result or create a new learner response | NOT_RUN |

### US051 — Continue naturally

**Requirement:** `workspace-access:REQ-111` · **Flow:** UI26 · **Status:** specified, not implemented

As the learner, I want to resume on another authorized device with my place and draft, so that switching devices does not cost study time.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC151 | a verified checkpoint | I resume on another device | the correct source and draft references load with media paused | NOT_RUN |
| UXAC152 | newer work exists only locally | I open a second device | the app does not claim to have synchronized that work | NOT_RUN |
| UXAC153 | the deck changed | resume resolves it | verified mapping or explicit choice is required before applying an old slide position | NOT_RUN |

### US052 — Resolve conflicts without losing responses

**Requirement:** `workspace-access:REQ-112` · **Flow:** UI26 · **Status:** specified, not implemented

As the learner, I want to compare conflicting drafts rather than silently overwrite them, so that my actual thinking remains preserved.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC154 | two devices edited different drafts | they synchronize | both versions and lineage are retained for explicit resolution | NOT_RUN |
| UXAC155 | one response was already submitted | I choose another draft | the existing immutable response is not edited in place | NOT_RUN |
| UXAC156 | device clocks disagree | conflict handling runs | clock recency alone does not select the authoritative evidence | NOT_RUN |

### US053 — Keep studying during interruptions

**Requirement:** `agent-dispatch:REQ-103` · **Flow:** UI27 · **Status:** specified, not implemented

As the learner, I want to read available cached sources and preserve drafts when connections fail, so that one unavailable service does not block all study.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC157 | permitted source already cached | native AI disconnects | source browsing remains usable and cache freshness is shown | NOT_RUN |
| UXAC158 | the device cannot persist a draft | autosave fails | Local save failed is shown with copy/export instead of a false saved status | NOT_RUN |
| UXAC159 | a source was never cached | the device is offline | the app explains its unavailability without substituting content | NOT_RUN |

### US054 — Recover without unexpected spending

**Requirement:** `agent-dispatch:REQ-104` · **Flow:** UI27 · **Status:** specified, not implemented

As the learner, I want to reconnect safely and pause on quota/auth problems, so that the app respects my approved route and limits.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC160 | quota is exhausted | a question awaits execution | the task pauses with a clear reason and no billed fallback | NOT_RUN |
| UXAC161 | reconnect follows an uncertain run | recovery starts | receipts are reconciled before safe redispatch | NOT_RUN |
| UXAC162 | one job repeatedly fails | its retry limit is reached | it is visibly blocked while unrelated authorized ready work may proceed | NOT_RUN |

### US055 — Study comfortably day and night

**Requirement:** `workspace-access:REQ-113` · **Flow:** UI28 · **Status:** specified, not implemented

As the learner, I want to choose Light, Dark or System, so that the entire interface fits my environment consistently.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC163 | System selected | the device theme changes | app-owned surfaces follow it without a bright incorrect initial flash | NOT_RUN |
| UXAC164 | Dark selected | I open dialogs, review and progress | all components use the same semantic theme and readable state variants | NOT_RUN |
| UXAC165 | two devices use System | their OS themes differ | each respects its own environment rather than toggling the other device | NOT_RUN |

### US056 — Preserve sources and focus when theming

**Requirement:** `workspace-access:REQ-114` · **Flow:** UI28 · **Status:** specified, not implemented

As the learner, I want to keep scientific images, drafts and playback unchanged by appearance settings, so that comfort does not alter evidence or interrupt work.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC166 | a color-coded slide | I switch to Dark | its original colors are not inverted or filtered | NOT_RUN |
| UXAC167 | audio playing and text drafted | I switch themes | playback position and draft remain intact and no request is sent | NOT_RUN |
| UXAC168 | reduced motion requested | I open a panel or reveal a card | nonessential animation is absent and all information remains available | NOT_RUN |

### US057 — Know the actual AI destination

**Requirement:** `agent-dispatch:REQ-105` · **Flow:** UI29 · **Status:** specified, not implemented

As the learner, I want to see the real product, thread and available tools, so that the app does not disguise a substituted runtime.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC169 | ChatGPT-category login in a Codex runtime | I inspect provider status | the actual product/surface and proof limits are explicit | NOT_RUN |
| UXAC170 | a route only appears in CLI help | setup displays it | it remains a candidate, not Connected or Verified | NOT_RUN |
| UXAC171 | no safe return channel proven | I try to activate unattended routing | the action stays blocked and explains the missing proof | NOT_RUN |

### US058 — Set boundaries once

**Requirement:** `agent-dispatch:REQ-106` · **Flow:** UI29 · **Status:** specified, not implemented

As the learner, I want to configure permitted data, default depth and resource limits, so that the app respects my choices without repeated low-value questions.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC172 | no extra spending approved | a service would require payment | the workflow pauses instead of charging another API | NOT_RUN |
| UXAC173 | a preference changes | a prior attempt is displayed | its original help conditions and assessment are not rewritten | NOT_RUN |
| UXAC174 | a model output asks for more permission | the supervisor processes it | only the actual approved control path can grant that change | NOT_RUN |

### US059 — Take my study history with me

**Requirement:** `workspace-access:REQ-115` · **Flow:** UI30 · **Status:** specified, not implemented

As the learner, I want to export selected questions, responses and evidence with provenance, so that I retain a useful private record outside the interface.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC175 | a selected session | I export it | available original responses, references and assessment versions are included without credentials | NOT_RUN |
| UXAC176 | original materials not authorized for sharing | I select a general study export | those files are excluded or require explicit scope permission | NOT_RUN |
| UXAC177 | an attachment is unavailable | the bundle is prepared | the manifest records missing availability rather than inventing bytes | NOT_RUN |

### US060 — Control retention honestly

**Requirement:** `workspace-access:REQ-116` · **Flow:** UI30 · **Status:** specified, not implemented

As the learner, I want to distinguish cache cleanup, raw-audio policy and evidence deletion, so that privacy controls do not destroy linked history silently.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC178 | an attempt references a full-turn sidecar | cleanup scans its run folder | the file is retained or routed to an approved referential deletion process | NOT_RUN |
| UXAC179 | I remove a device cache | completion is reported | provider conversations and canonical course history are not claimed erased | NOT_RUN |
| UXAC180 | canonical deletion is not implemented or authorized | I request it | the limitation and required owner action are explicit; no false success receipt appears | NOT_RUN |

### US061 — Stop without losing the thread

**Requirement:** `progress:REQ-107` · **Flow:** UI31 · **Status:** specified, not implemented

As the learner, I want to finish with a concise recap and resume point, so that my next session starts in the right place.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC181 | a session with questions and an attempt | I finish | the recap distinguishes viewed material, requested answers and assessed responses | NOT_RUN |
| UXAC182 | pending canonical save | I close the recap | its actual status remains visible in Activity and the response is not re-created | NOT_RUN |
| UXAC183 | I return later | I choose Continue | the verified checkpoint is restored rather than a model-invented summary | NOT_RUN |

### US062 — Keep study aligned with my schedule

**Requirement:** `progress:REQ-108` · **Flow:** UI31 · **Status:** specified, not implemented

As the learner, I want to stop or save selected next steps without penalties, so that the tutor helps rather than adding obligations.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC184 | only quick answers were requested | I finish | the recap says understanding was not assessed in those exchanges without recording failure | NOT_RUN |
| UXAC185 | review suggestions exist | I choose Done | unselected suggestions do not become scheduled work | NOT_RUN |
| UXAC186 | I choose one item for later | selection saves | no Calendar/Tasks or academic-deadline mutation is implied | NOT_RUN |

### US063 — Understand repair actions

**Requirement:** `agent-dispatch:REQ-107` · **Flow:** UI32 · **Status:** specified, not implemented

As the learner acting as operator, I want to see what a maintenance operation will change before it runs, so that recovery does not silently rewrite my academic records.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC187 | a stale derived view | I inspect repair | the preview distinguishes rebuilding a view from altering original attempts | NOT_RUN |
| UXAC188 | a writer with unisolated global paths | fixture repair is proposed | execution is blocked until actual isolation is verified | NOT_RUN |
| UXAC189 | the preview includes unapproved service restart or permissions | I inspect scope | that operation requires separate approval and is not bundled silently | NOT_RUN |

### US064 — Verify recovery effects

**Requirement:** `agent-dispatch:REQ-108` · **Flow:** UI32 · **Status:** specified, not implemented

As the learner acting as operator, I want to see the actual repair receipt and remaining limits, so that a success toast does not conceal lost evidence or unresolved work.

| Case | Given | When | Then | Observed result |
|---|---|---|---|---|
| UXAC190 | an attempt already saved but render failed | repair succeeds | the original attempt remains one record and only the view is repaired | NOT_RUN |
| UXAC191 | a referenced source is absent | repair runs | it reports unavailable original content rather than generating a replacement as original | NOT_RUN |
| UXAC192 | a native result may already have committed | recovery is requested | the system reconciles receipts before retrying and never steals a live writer lock | NOT_RUN |

