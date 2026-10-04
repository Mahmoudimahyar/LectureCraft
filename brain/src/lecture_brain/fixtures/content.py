"""Synthetic fixture content. Everything here is invented for tests and the labeled fixture profile.

It mirrors the *layout and record shapes* of the real course workspaces (course-tracking-v1 source
index, course-learning-v1 catalogs/attempts) but none of it is real course material, a real
learner response, a real assessment or a real timestamp.
"""
from __future__ import annotations

FIXTURE_NOTE = "SYNTHETIC FIXTURE - not course material"

# ---------------------------------------------------------------------------------------------
# be505: the rich fixture course
# ---------------------------------------------------------------------------------------------
BE505_LECTURES = [
    {
        "unit": "lecture-01",
        "deck": "Fixture Lecture 01 - Plasmid anatomy.pdf",
        "title": "Fixture Lecture 01 - Plasmid anatomy",
        "session": "2026-09-03",
        "recording": "Fixture Lec 1 Sep 3.wav",
        "transcript": "Fixture Lec 1 Sep 3.txt",
        "indexed": {"slides": True, "transcript": True, "recording": True},
        "slides": [
            {
                "title": "Anatomy of an expression plasmid",
                "bullets": ["One circular molecule, several distinct functions.", "Origin, promoter, gene of interest, selectable marker.", "Each part answers a different question about the cell."],
                "figure": "ring",
                "seconds": (0, 15),
                "lines": [
                    "Today we look at a synthetic plasmid as one molecule with several jobs.",
                    "Think of it as a small circular map.",
                    "There is an origin, a promoter, a gene of interest and a marker.",
                    "Each part answers a different question.",
                    "Can the plasmid be copied? Can the gene be read? Can we find the cells that carry it?",
                    "Keep those three questions apart.",
                ],
            },
            {
                "title": "Origin of replication",
                "bullets": ["DNA replication of the plasmid begins here.", "Controls copy number, not gene expression.", "No origin: the plasmid is diluted out as cells divide."],
                "figure": "ori",
                "seconds": (15, 30),
                "lines": [
                    "The origin of replication is where copying of the plasmid starts.",
                    "It sets how many copies each cell keeps.",
                    "It says nothing about whether the gene is expressed.",
                    "Without an origin the plasmid is not copied.",
                    "It is diluted out as the cells divide.",
                    "So origin means replication.",
                ],
            },
            {
                "title": "Promoter and transcription",
                "bullets": ["RNA polymerase binds at the promoter.", "Directs transcription of the downstream gene.", "Key distinction: replication is not transcription."],
                "figure": "promoter",
                "seconds": (30, 45),
                "lines": [
                    "The promoter is where RNA polymerase binds.",
                    "It directs transcription of the gene that follows it.",
                    "A strong promoter gives more messenger RNA.",
                    "It does not copy the plasmid.",
                    "Replication is not transcription.",
                    "That distinction is the key idea of this lecture.",
                ],
            },
            {
                "title": "Selectable marker",
                "bullets": ["Lets us identify cells that carry the plasmid.", "Typically a resistance gene with its own promoter.", "Selection is a filter, not proof of expression of the gene of interest."],
                "figure": "marker",
                "seconds": (45, 55),
                "lines": [
                    "The selectable marker lets us find the cells that carry the plasmid.",
                    "It is usually a resistance gene with its own promoter.",
                    "Survival on selective medium tells us the plasmid is present.",
                    "It does not tell us the gene of interest is expressed.",
                ],
            },
        ],
        # A second, disjoint occurrence of slide 2 at the end of the recording.
        "revisits": [{"slide": 2, "seconds": (55, 60), "lines": ["Before we stop, remember the origin slide again.", "Copying the plasmid and reading the gene are separate events."]}],
        "alignment": "confirmed",
    },
    {
        "unit": "lecture-02",
        "deck": "Fixture Lecture 02 - Expression control.pdf",
        "title": "Fixture Lecture 02 - Expression control",
        "session": "2026-09-08",
        "recording": "Fixture Lec 2 Sep 8.wav",
        "transcript": "Fixture Lec 2 Sep 8.txt",
        "indexed": {"slides": True, "transcript": True, "recording": False},
        "slides": [
            {
                "title": "Inducible promoters",
                "bullets": ["Expression can be switched on by a small molecule.", "The inducer changes repressor binding.", "Useful when the product is toxic to the host."],
                "figure": "promoter",
                "seconds": (0, 16),
                "lines": [
                    "An inducible promoter can be switched on when we choose.",
                    "A small molecule, the inducer, changes how the repressor binds.",
                    "This matters when the product harms the host cell.",
                    "We grow the cells first and induce later.",
                ],
            },
            {
                "title": "Repressors and operators",
                "bullets": ["The repressor binds the operator and blocks transcription.", "Inducer bound: repressor releases the operator.", "Leaky expression is common and must be measured."],
                "figure": "ori",
                "seconds": (16, 32),
                "lines": [
                    "The repressor sits on the operator and blocks transcription.",
                    "When inducer binds, the repressor lets go.",
                    "Some expression leaks through even without inducer.",
                    "Always measure that baseline.",
                ],
            },
            {
                "title": "Putting control together",
                "bullets": ["Choose copy number and promoter strength together.", "High copy plus strong promoter can overload the host.", "Design is a balance, not a maximum."],
                "figure": "ring",
                "seconds": (32, 45),
                "lines": [
                    "Copy number and promoter strength are chosen together.",
                    "High copy with a strong promoter can overload the host.",
                    "Design is a balance.",
                ],
            },
        ],
        "revisits": [],
        "alignment": "suggested",
    },
    {
        "unit": "lecture-03",
        "deck": "Fixture Lecture 03 - Cloning workflow.pdf",
        "title": "Fixture Lecture 03 - Cloning workflow",
        "session": None,
        "recording": None,
        "transcript": None,
        "indexed": {"slides": False, "transcript": False, "recording": False},
        "slides": [
            {"title": "Cut, paste, transform", "bullets": ["Digest vector and insert.", "Ligate the fragments.", "Transform and select."], "figure": "ring", "seconds": None, "lines": []},
            {"title": "Checking the clone", "bullets": ["Colony screening.", "Sequence confirmation.", "Keep a verified stock."], "figure": "marker", "seconds": None, "lines": []},
        ],
        "revisits": [],
        "alignment": "none",
    },
]

BE505_TOPICS = [
    {"topic_id": "be505.topic.plasmids", "label": "Plasmid structure", "aliases": ["vectors"]},
    {"topic_id": "be505.topic.expression-control", "label": "Expression control", "aliases": []},
]

BE505_CONCEPTS = [
    {"concept_id": "be505.concept.origin-of-replication", "label": "Origin of replication", "topic_ids": ["be505.topic.plasmids"], "aliases": ["ori"]},
    {"concept_id": "be505.concept.promoter", "label": "Promoter", "topic_ids": ["be505.topic.plasmids", "be505.topic.expression-control"], "aliases": []},
    {"concept_id": "be505.concept.selectable-marker", "label": "Selectable marker", "topic_ids": ["be505.topic.plasmids"], "aliases": ["resistance marker"]},
    {"concept_id": "be505.concept.replication-vs-transcription", "label": "Replication versus transcription", "topic_ids": ["be505.topic.plasmids"], "aliases": []},
    {"concept_id": "be505.concept.inducible-promoter", "label": "Inducible promoter", "topic_ids": ["be505.topic.expression-control"], "aliases": []},
]

BE505_SKILLS = [
    {"skill_id": "be505.skill.ori.explain", "topic": "be505.topic.plasmids", "ability": "explain", "concept": "be505.concept.origin-of-replication",
     "target": "Explain what the origin of replication does and what it does not control.", "source": ("src-lecture-01-slides", "slide 2"), "priority": "high", "decision": "develop"},
    {"skill_id": "be505.skill.promoter.explain", "topic": "be505.topic.plasmids", "ability": "explain", "concept": "be505.concept.promoter",
     "target": "Explain the role of the promoter in transcription.", "source": ("src-lecture-01-slides", "slide 3"), "priority": "high", "decision": "develop"},
    {"skill_id": "be505.skill.selection.interpret", "topic": "be505.topic.plasmids", "ability": "interpret", "concept": "be505.concept.selectable-marker",
     "target": "Interpret what survival on selective medium does and does not show.", "source": ("src-lecture-01-slides", "slide 4"), "priority": "medium", "decision": "undecided"},
    {"skill_id": "be505.skill.ori-vs-promoter.integrate", "topic": "be505.topic.plasmids", "ability": "integrate", "concept": "be505.concept.replication-vs-transcription",
     "target": "Distinguish plasmid replication from gene transcription in a new situation.", "source": ("src-lecture-01-slides", "slides 2-3"), "priority": "high", "decision": "develop"},
    {"skill_id": "be505.skill.inducible-control.explain", "topic": "be505.topic.expression-control", "ability": "explain", "concept": "be505.concept.inducible-promoter",
     "target": "Explain how an inducer switches on an inducible promoter.", "source": ("src-lecture-02-slides", "slides 1-2"), "priority": "unknown", "decision": "undecided"},
]

BE505_QUESTIONS = [
    {"question_id": "BE505-L01-Q01", "collection": "L01", "number": 1, "title": "What the origin does",
     "prompt": "In your own words, explain what the origin of replication does on a plasmid and name one thing it does not control.",
     "family_id": "be505.family.question.l01-q01", "origin": "generated_practice", "source": ("src-lecture-01-slides", "slide 2"), "page": 2,
     "criteria": [("be505.skill.ori.explain", "be505.concept.origin-of-replication", "States that plasmid replication starts at the origin and that it does not control expression of the gene.", ["explain"])],
     "answer": "Replication of the plasmid begins at the origin, which sets copy number; it does not control transcription of the gene of interest."},
    {"question_id": "BE505-L01-Q02", "collection": "L01", "number": 2, "title": "What the promoter does",
     "prompt": "Explain the role of the promoter. What binds there and what is produced?",
     "family_id": "be505.family.question.l01-q02", "origin": "generated_practice", "source": ("src-lecture-01-slides", "slide 3"), "page": 3,
     "criteria": [("be505.skill.promoter.explain", "be505.concept.promoter", "States that RNA polymerase binds the promoter and transcription of the downstream gene produces RNA.", ["explain"])],
     "answer": "RNA polymerase binds at the promoter and transcribes the downstream gene into messenger RNA."},
    {"question_id": "BE505-L01-Q03", "collection": "L01", "number": 3, "title": "Replication is not transcription",
     "prompt": "A plasmid has a working origin but its promoter is deleted. Predict what happens to plasmid copy number and to the gene product, and explain why.",
     "family_id": "be505.family.question.l01-q03", "origin": "generated_practice", "source": ("src-lecture-01-slides", "slides 2-3"), "page": 3,
     "criteria": [
         ("be505.skill.ori-vs-promoter.integrate", "be505.concept.replication-vs-transcription", "Separates the two outcomes: the plasmid is still copied, the gene product is not made.", ["integrate"]),
         ("be505.skill.ori.explain", "be505.concept.origin-of-replication", "Attributes continued copying to the intact origin.", ["explain"]),
         ("be505.skill.promoter.explain", "be505.concept.promoter", "Attributes the missing product to the absence of transcription from the promoter.", ["explain"]),
     ],
     "answer": "Copy number is unchanged because the origin is intact; no gene product is made because without a promoter the gene is not transcribed."},
    {"question_id": "BE505-PS01-Q01", "collection": "PS01", "number": 1, "title": "Selection plate interpretation",
     "prompt": "Colonies grow on a selective plate after transformation. State what this shows and one thing it does not show. Refer to Figure 1 of the problem set.",
     "family_id": "be505.family.question.ps01-q01", "origin": "course_source", "source": ("src-ps-01-brief", "page 1, question 1"), "page": 1,
     "criteria": [("be505.skill.selection.interpret", "be505.concept.selectable-marker", "States that growth shows the plasmid (marker) is present, not that the gene of interest is expressed.", ["interpret"])],
     "answer": "Growth shows the cells carry the plasmid with the resistance marker; it does not show expression of the gene of interest."},
    {"question_id": "BE505-L02-Q01", "collection": "L02", "number": 1, "title": "How induction works",
     "prompt": "Explain how adding an inducer switches on an inducible promoter.",
     "family_id": "be505.family.question.l02-q01", "origin": "generated_practice", "source": ("src-lecture-02-slides", "slides 1-2"), "page": 1,
     "criteria": [("be505.skill.inducible-control.explain", "be505.concept.inducible-promoter", "States that inducer binding releases the repressor from the operator so transcription can start.", ["explain"])],
     "answer": "The inducer binds the repressor, which releases the operator, allowing RNA polymerase to transcribe the gene."},
]

BE505_RELATIONSHIPS = [
    {"from_question": "BE505-L01-Q01", "to_question": "BE505-L01-Q03", "relation": "diagnostic_prerequisite",
     "rationale": "Explaining the origin alone is a narrower step used when the combined prediction fails."},
    {"from_question": "BE505-L01-Q02", "to_question": "BE505-L01-Q03", "relation": "strict_containment",
     "rationale": "The promoter explanation is fully contained in the combined prediction question."},
    {"from_question": "BE505-L01-Q03", "to_question": "BE505-L02-Q01", "relation": "partial_overlap",
     "rationale": "Both require reasoning about when transcription happens."},
]

PS01_PAGES = [
    {"title": "Fixture Problem Set 01", "bullets": ["Question 1. Colonies grow on a selective plate after transformation.", "State what this shows and one thing it does not show.", "Figure 1: plate with colonies (synthetic drawing)."], "figure": "marker"},
    {"title": "Fixture Problem Set 01 (continued)", "bullets": ["Question 2. A plasmid has a strong promoter and a high-copy origin.", "Discuss one risk for the host cell."], "figure": "ring"},
]
PS01_SOLUTION_PAGES = [
    {"title": "Fixture Problem Set 01 - SOLUTIONS", "bullets": ["Q1: growth shows the marker/plasmid is present.", "It does not show expression of the gene of interest.", "Q2: metabolic burden on the host."], "figure": "marker"},
]
TEXTBOOK_PAGES = [
    {"title": "Fixture Textbook - Chapter 3", "bullets": ["Vectors and hosts.", "A synthetic overview page."], "figure": "ring", "printed": "33"},
    {"title": "3.2 Promoters", "bullets": ["A promoter is the DNA region where transcription starts.", "Promoter strength affects the amount of transcript."], "figure": "promoter", "printed": "34"},
    {"title": "3.3 Origins of replication", "bullets": ["Replication begins at the origin.", "Copy number depends on the origin type."], "figure": "ori", "printed": "35"},
    {"title": "3.4 Selection", "bullets": ["Markers allow selection of transformed cells."], "figure": "marker", "printed": "36"},
]

# ---------------------------------------------------------------------------------------------
# Lighter courses: each exercises different inventory states found in the real workspaces
# ---------------------------------------------------------------------------------------------
OTHER_COURSES = {
    "be562": {
        "display_name": "FIXTURE BE 562 - Probabilistic Models (synthetic)",
        "lectures": [
            {"unit": "lecture-01", "deck": "Fixture 562 Lecture 01.pdf", "indexed": True, "slides": ["Chain rule for probabilities", "Conditional independence"]},
            {"unit": "lecture-02", "deck": "Fixture 562 Lecture 02.pdf", "indexed": False, "slides": ["Bayesian networks"]},
        ],
        "sessions": [
            {"date": "2026-09-04", "transcript": "Fixture 562 Lec 1.txt", "recording": "Fixture 562 Lec 1.wav", "index_transcript": True, "index_recording": True},
            {"date": "2026-09-09", "transcript": None, "recording": None},  # empty session directory
        ],
        "skills": [("be562.skill.chain-rule-factorization", "derive", "Factor a joint distribution with the chain rule."),
                   ("be562.skill.conditional-independence-simplification", "explain", "Explain when a conditional independence simplifies a factor.")],
        "family": ("be562.family.chain-factorization-independence", ["be562.skill.chain-rule-factorization", "be562.skill.conditional-independence-simplification"],
                   "Factor P(A,B,C) with the chain rule and simplify it given that C is independent of A given B."),
        "attempts": 1,
        "placeholders": ["src-ps-03-brief"],
    },
    "be572": {
        "display_name": "FIXTURE BE 572 - Journal Club (synthetic)",
        "lectures": [
            {"unit": "lecture-00", "deck": "Fixture 572 Overview.pdf", "indexed": True, "slides": ["Course overview"]},
            {"unit": "lecture-01", "deck": "Fixture 572 Empty.pdf", "indexed": True, "empty": True, "slides": []},
            {"unit": "lecture-02", "deck": "Fixture 572 Lecture 02.pptx", "indexed": False, "pptx": True, "slides": []},
        ],
        "sessions": [{"date": "2026-09-05", "transcript": "Fixture 572 Lec 1.txt", "recording": None, "index_transcript": True, "index_recording": False}],
        "skills": [("be572.skill.limitation-evidence-needed", "critique", "State what evidence a claimed limitation would need.")],
        "family": ("be572.family.grounded-extension-or-discussion", ["be572.skill.limitation-evidence-needed"], "Name one limitation of the synthetic paper and the evidence needed to test it."),
        "attempts": 0,
        "placeholders": [],
    },
    "cs542": {
        "display_name": "FIXTURE CS 542 - Machine Learning (synthetic)",
        "lectures": [{"unit": "lecture-01", "deck": "Fixture 542 Lecture 01.pptx", "indexed": True, "pptx": True, "slides": []}],
        "sessions": [{"date": "2026-09-02", "transcript": "Fixture 542 Lec 1.txt", "recording": None, "index_transcript": False, "index_recording": False}],
        "skills": [("cs542.skill.mle-explain", "explain", "Explain maximum likelihood estimation in words.")],
        "family": ("cs542.family.mle-explanation", ["cs542.skill.mle-explain"], "Explain what maximum likelihood estimation chooses and why."),
        "attempts": 0,
        "placeholders": [],
    },
    "ds551": {
        "display_name": "FIXTURE DS 551 - Data Systems (synthetic)",
        "lectures": [{"unit": "lecture-01", "deck": "Fixture 551 Lecture 01.pdf", "indexed": False, "slides": ["Data pipelines"]}],
        "sessions": [
            {"date": "2026-09-03", "transcript": "Fixture 551 Lec 1.txt", "recording": "Fixture 551 Lec 1.wav", "index_transcript": True, "index_recording": False},
            {"date": "2026-09-10", "transcript": "Fixture 551 Lec 2.txt", "recording": None, "index_transcript": True, "index_recording": False},  # session without slides
        ],
        "skills": [("ds551.skill.pipeline-debug", "debug", "Find the failing stage of a small data pipeline.")],
        "family": ("ds551.family.pipeline-debugging", ["ds551.skill.pipeline-debug"], "A three-stage pipeline returns an empty table. Describe how you would find the failing stage."),
        "attempts": 0,
        "placeholders": [],
    },
}

COURSE_INSTRUCTIONS = {
    "be505": "Synthetic fixture course. Diagnostic answers live in a separate assessor guide so questions can be used without revealing answers. Do not administer a quiz automatically.",
    "be562": "Synthetic fixture course. AI assistance on problem sets must be disclosed (fixture rule mirroring a disclosure policy).",
    "be572": "Synthetic fixture course. Label supplied interpretations and substantive writing help.",
    "cs542": "Synthetic fixture course. No additional assistance restriction recorded in this fixture.",
    "ds551": "Synthetic fixture course. Per-task Green/Yellow/Red AI permission; unknown colour is not presumed Green.",
}
