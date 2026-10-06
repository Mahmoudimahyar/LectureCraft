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
        "cue_file": True,
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
    {
        # A unit that also holds an in-class question sheet whose file name sorts BEFORE the deck (as in a real course).
        "unit": "lecture-04",
        "deck": "Fixture Lecture 04 - Induction lab.pdf",
        "title": "Fixture Lecture 04 - Induction lab",
        "session": None,
        "recording": None,
        "transcript": None,
        "indexed": {"slides": True, "transcript": False, "recording": False},
        "sheet": {"file": "04 - Fixture in-class questions.pdf",
                  "pages": [{"title": "Fixture in-class questions", "bullets": ["Question 1. Sketch the induction curve after adding inducer.", "Mark the lag and the plateau."], "figure": "promoter"}]},
        "slides": [
            {"title": "Planning an induction", "bullets": ["Grow to mid-log first.", "Add inducer at a chosen density.", "Sample at fixed times."], "figure": "promoter", "seconds": None, "lines": []},
            {"title": "Reading the time course", "bullets": ["Lag before product appears.", "Rise, then plateau.", "Compare with the uninduced control."], "figure": "ori", "seconds": None, "lines": []},
            {"title": "What can go wrong", "bullets": ["Leaky expression before induction.", "Too much inducer slows growth.", "Plasmid loss without selection."], "figure": "marker", "seconds": None, "lines": []},
        ],
        "revisits": [],
        "alignment": "none",
    },
]

# ---------------------------------------------------------------------------------------------
# be505 lecture-05: ONE showcase unit for amendment R2 (invented wording; nothing is course material)
# ---------------------------------------------------------------------------------------------
# The deck is written with ``builder.write_slide_pdf`` so that the source map finds every kind of page it words
# differently: a cover, an agenda, a three-page build, a two-page step group, pages with a figure and with a formula,
# an administrative page, a worked example and a summary. Each page has words of its own so that speech can be told
# apart. ``about`` in SHOWCASE_TALK names the page(s) a stretch of the talk follows; it is the design of the fixture,
# not something the app reads.
_PLATE = [(150, 70, 230, 70), (230, 70, 230, 110), (230, 110, 150, 110), (150, 110, 150, 70)]  # the outline of a plate, in millimetres
_BUILD_TITLE = "Building the reporter construct"
_BUILD_BULLETS = ["Start with the promoter fragment you want to test.", "Fuse the fluorescent coding sequence downstream of it.", "Add a ribosome binding site and a terminator."]
_STEP_PAGE = {"title": "Reading the plate", "bullets": ["Excite each well with blue light.", "Collect the green emission through a filter.", "Subtract the reading of an empty well."]}

SHOWCASE = {
    "unit": "lecture-05",
    "deck": "Fixture Lecture 05 - R2 showcase.pdf",
    "title": "Fixture Lecture 05 - R2 showcase",
    "session": "2026-09-15",
    "recording": "Fixture Lec 5 Sep 15.wav",
    "transcript": "Fixture Lec 5 Sep 15.txt",
    "recording_seconds": 150,
    "word_ms": 320,   # every spoken word of the synthetic talk takes this long …
    "pause_ms": 320,  # … and every line is followed by this pause
    "sheet": {"file": "05 - Fixture in-class questions.pdf",
              "pages": [{"title": "Fixture in-class questions", "bullets": ["Question 1. Sketch the reporter construct.", "Mark the three parts and the direction of reading."], "figure": "ring"}]},
    "pages": [
        {"title": "Reporter assays", "lines": ["Fixture lecture 5 - measuring expression with light"]},                                         # 1 cover
        {"title": "Agenda", "bullets": ["What a reporter gene reports", "Building the reporter construct", "Reading the plate", "Calibration and a worked example"]},  # 2
        {"title": "What a reporter gene reports", "bullets": ["A reporter gene makes a product that is easy to measure.", "Fluorescent protein: brightness follows promoter activity.",
                                                              "The reporter stands in for a gene that is hard to see."], "figure": "ring"},  # 3 figure
        {"title": _BUILD_TITLE, "bullets": _BUILD_BULLETS[:1]},                                                                                  # 4 build 1 of 3
        {"title": _BUILD_TITLE, "bullets": _BUILD_BULLETS[:2]},                                                                                  # 5 build 2 of 3
        {"title": _BUILD_TITLE, "bullets": _BUILD_BULLETS[:3]},                                                                                  # 6 build 3 of 3
        dict(_STEP_PAGE, strokes=[*_PLATE, (165, 58, 165, 68)]),                                                                                 # 7 step 1 of 2
        dict(_STEP_PAGE, strokes=[*_PLATE, (195, 58, 195, 68)]),                                                                                 # 8 step 2 of 2: same text, the pointer moved
        {"title": "Background and blank wells", "bullets": ["Medium alone glows a little: autofluorescence.", "A blank well measures that background.",
                                                            "Cells without the reporter set the floor."], "figure": "marker"},              # 9 figure; never spoken about
        {"title": "Calibration line", "lines": ["F = k * c + b", "slope k from standards, blank b"]},                                           # 10 sparse, formula
        {"title": "Announcements", "bullets": ["Problem set 5 is due on Friday.", "Office hours move to Thursday afternoon."]},                  # 11 administrative
        {"title": "Worked example: reading to amount", "bullets": ["A well reads 840 units; the blank reads 40.", "The slope from the standards is 20 units per nanomole.",
                                                                   "Amount = (840 - 40) / 20 = 40 nanomoles."]},                           # 12 worked example
        {"title": "Dynamic range and saturation", "bullets": ["Above the linear range the detector saturates.", "Dilute the sample and measure again.",
                                                              "Report readings only inside the range of the standards."], "figure": "ori"},  # 13 not reached in the talk
        {"title": "Summary", "bullets": ["A reporter turns promoter activity into light.", "Subtract the blank before comparing wells.", "Use the calibration line to report amounts."]},  # 14
    ],
}

# The talk, in the order it is spoken. Page 9 is skipped, page 3 is come back to once, one stretch is about nothing on
# the slides, and the talk stops before pages 13 and 14.
SHOWCASE_TALK = [
    {"about": [2], "lines": ["Welcome back everyone, here is the agenda for today.", "Four items on the agenda."]},
    {"about": [3], "lines": [
        "A reporter gene makes a product that we can measure easily.",
        "Here the product is a fluorescent protein.",
        "Its brightness follows the activity of the promoter in front of it.",
        "So the reporter stands in for a gene that is hard to see.",
        "We measure brightness, and we read it as promoter activity.",
        "Keep in mind what the reporter gene reports and what it does not."]},
    {"about": [4, 5, 6], "lines": [
        "Now we build the reporter construct step by step.",
        "Start with the promoter fragment you want to test.",
        "That fragment is the only part that changes between constructs.",
        "Next, fuse the fluorescent coding sequence downstream of the fragment.",
        "The coding sequence is the same in every construct we build.",
        "Then add a ribosome binding site so the message is translated.",
        "Finally add a terminator so transcription stops cleanly.",
        "Promoter fragment, coding sequence, binding site, terminator: that is the construct.",
        "Any questions on how the construct is put together?"]},
    {"about": [7, 8], "lines": [
        "Now to reading the plate, one well at a time.",
        "The reader excites each well with blue light.",
        "Then it collects the green emission through a filter.",
        "The second step moves the light to the next well.",
        "At the end we subtract the reading of an empty well.",
        "So reading the plate is excite, collect, subtract."]},
    {"about": [10], "lines": [
        "A reading alone is not an amount, so we need a calibration line.",
        "The calibration line comes from standards of known amount.",
        "Its slope is k, and the blank reading is b.",
        "You fit the calibration line once for every single plate reader.",
        "Write the slope and the blank down in your own notebook today."]},
    {"about": [], "lines": [
        "By the way, can everyone at the back hear me?",
        "Somebody left an umbrella here on Tuesday.",
        "It is the red one by the door.",
        "Okay, thank you, let us carry on."]},
    {"about": [3], "revisit": True, "lines": [
        "Let me go back to the reporter gene slide for a moment.",
        "Remember, the reporter gene only reports promoter activity.",
        "Brightness is promoter activity, not the health of the cell.",
        "That is what the fluorescent protein can and cannot tell you."]},
    {"about": [12], "lines": [
        "Let us finish with a worked example.",
        "A well reads 840 units and the blank reads 40.",
        "The slope from the standards is 20 units per nanomole.",
        "So the amount is 800 divided by 20, which is 40 nanomoles.",
        "That is the whole worked example; we stop here for today."]},
]
# What the synthetic generated speech text says in place of two transcript lines (misheard: nothing of the line survives).
SHOWCASE_GARBLED = {14: "Tan ladder rival zone fine dings sight sold mess edge trance.", 21: "Sack hand stub moose alley tooth annex swell mint grove."}
# Two transcript lines whose time the synthetic generation states as unresolved: text withheld, 8 seconds.
SHOWCASE_WITHHELD = (27, 28)


def showcase_schedule() -> list[dict]:
    """Every transcript line of the showcase talk with the time the synthetic recording gives it, in whole milliseconds:
    ``{line, about, revisit, text, start_ms, end_ms, generated}``. ``generated`` is what the synthetic generated speech
    text holds for the line: the line itself, other words (a garbled line) or ``None`` (withheld). All of it is invented."""
    rows: list[dict] = []
    clock = 0
    for block in SHOWCASE_TALK:
        for text in block["lines"]:
            number = len(rows) + 1
            end = clock + len(text.split()) * SHOWCASE["word_ms"]
            rows.append({"line": number, "about": list(block["about"]), "revisit": bool(block.get("revisit")), "text": text, "start_ms": clock, "end_ms": end,
                         "generated": None if number in SHOWCASE_WITHHELD else SHOWCASE_GARBLED.get(number, text)})
            clock = end + SHOWCASE["pause_ms"]
    return rows


def showcase_unresolved() -> tuple[int, int]:
    """The withheld stretch of the synthetic generation: from the start of the first withheld line to the start of the line after the last."""
    rows = {row["line"]: row for row in showcase_schedule()}
    return rows[SHOWCASE_WITHHELD[0]]["start_ms"], rows[SHOWCASE_WITHHELD[-1] + 1]["start_ms"]


BE505_TOPICS = [
    {"topic_id": "be505.topic.plasmids", "label": "Plasmid structure", "aliases": ["vectors"]},
    {"topic_id": "be505.topic.expression-control", "label": "Expression control", "aliases": []},
    {"topic_id": "be505.topic.reporter-assays", "label": "Reporter assays", "aliases": []},
]

BE505_CONCEPTS = [
    {"concept_id": "be505.concept.origin-of-replication", "label": "Origin of replication", "topic_ids": ["be505.topic.plasmids"], "aliases": ["ori"]},
    {"concept_id": "be505.concept.promoter", "label": "Promoter", "topic_ids": ["be505.topic.plasmids", "be505.topic.expression-control"], "aliases": []},
    {"concept_id": "be505.concept.selectable-marker", "label": "Selectable marker", "topic_ids": ["be505.topic.plasmids"], "aliases": ["resistance marker"]},
    {"concept_id": "be505.concept.replication-vs-transcription", "label": "Replication versus transcription", "topic_ids": ["be505.topic.plasmids"], "aliases": []},
    {"concept_id": "be505.concept.inducible-promoter", "label": "Inducible promoter", "topic_ids": ["be505.topic.expression-control"], "aliases": []},
    {"concept_id": "be505.concept.reporter-gene", "label": "Reporter gene", "topic_ids": ["be505.topic.reporter-assays"], "aliases": ["reporter construct"]},
    {"concept_id": "be505.concept.ribosome-binding-site", "label": "Ribosome binding site", "topic_ids": ["be505.topic.reporter-assays"], "aliases": []},
    {"concept_id": "be505.concept.blank-subtraction", "label": "Blank subtraction", "topic_ids": ["be505.topic.reporter-assays"], "aliases": []},
    {"concept_id": "be505.concept.calibration-line", "label": "Calibration line", "topic_ids": ["be505.topic.reporter-assays"], "aliases": ["standard curve"]},
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
    {"skill_id": "be505.skill.reporter.explain", "topic": "be505.topic.reporter-assays", "ability": "explain", "concept": "be505.concept.reporter-gene",
     "target": "Explain what a reporter gene reports and how the reporter construct is put together.", "source": ("src-lecture-05-slides", "slides 3-6"), "priority": "medium", "decision": "undecided"},
    {"skill_id": "be505.skill.binding-site.explain", "topic": "be505.topic.reporter-assays", "ability": "explain", "concept": "be505.concept.ribosome-binding-site",
     "target": "Explain why a reporter construct carries a ribosome binding site.", "source": ("src-lecture-05-slides", "slide 6"), "priority": "unknown", "decision": "undecided"},
    {"skill_id": "be505.skill.blank.interpret", "topic": "be505.topic.reporter-assays", "ability": "interpret", "concept": "be505.concept.blank-subtraction",
     "target": "Interpret a plate reading once the blank has been subtracted.", "source": ("src-lecture-05-slides", "slides 7-9"), "priority": "medium", "decision": "undecided"},
    # Two skills of one concept, with different actions: computing with the line and saying what its slope stands for.
    {"skill_id": "be505.skill.calibration.calculate", "topic": "be505.topic.reporter-assays", "ability": "calculate", "concept": "be505.concept.calibration-line",
     "target": "Convert a reading into an amount with the calibration line.", "source": ("src-lecture-05-slides", "slides 10, 12"), "priority": "unknown", "decision": "undecided"},
    {"skill_id": "be505.skill.calibration.explain", "topic": "be505.topic.reporter-assays", "ability": "explain", "concept": "be505.concept.calibration-line",
     "target": "Explain what the slope and the blank of the calibration line stand for.", "source": ("src-lecture-05-slides", "slide 10"), "priority": "unknown", "decision": "undecided"},
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
    # As in real problem sets: the course index keeps NO wording for this one — the original page is authoritative.
    {"question_id": "BE505-PS01-Q02", "collection": "PS01", "number": 2, "title": "Problem set 1, question 2", "prompt": None,
     "prompt_status": "Original source is authoritative; open the stated page including figures and givens (synthetic fixture).",
     "source_path": "materials/assignments/ps-01/Fixture PS01.pdf",
     "family_id": "be505.family.question.ps01-q02", "origin": "course_source", "source": ("src-ps-01-brief", "page 2, question 2"), "page": 2,
     "criteria": [("be505.skill.promoter.explain", "be505.concept.promoter", "States that a strong promoter on a high-copy plasmid places a metabolic burden on the host cell.", ["explain"])],
     "answer": "Very high expression from many copies diverts the cell's resources and can slow growth or select for loss of the plasmid."},
    {"question_id": "BE505-L02-Q01", "collection": "L02", "number": 1, "title": "How induction works",
     "prompt": "Explain how adding an inducer switches on an inducible promoter.",
     "family_id": "be505.family.question.l02-q01", "origin": "generated_practice", "source": ("src-lecture-02-slides", "slides 1-2"), "page": 1,
     "criteria": [("be505.skill.inducible-control.explain", "be505.concept.inducible-promoter", "States that inducer binding releases the repressor from the operator so transcription can start.", ["explain"])],
     "answer": "The inducer binds the repressor, which releases the operator, allowing RNA polymerase to transcribe the gene."},
    # A lecture question whose catalog locator names no slide (as in real early collections): it belongs to the lecture all the same.
    {"question_id": "BE505-L01-Q04", "collection": "L01", "number": 4, "title": "One molecule, several jobs",
     "prompt": "Name the three questions a plasmid's parts address and say which part addresses each.",
     "family_id": "be505.family.question.l01-q04", "origin": "generated_practice",
     "source": ("src-lecture-01-slides", "lecture scientific content; exact mapping in companion hierarchy/source map"), "page": None,
     "criteria": [("be505.skill.ori-vs-promoter.integrate", "be505.concept.replication-vs-transcription", "Separates copying, reading and finding, and assigns origin, promoter and marker.", ["integrate"])],
     "answer": "Copying: the origin. Reading the gene: the promoter. Finding carriers: the selectable marker."},
    # Comma-listed slides plus transcript lines: separate anchor types, every listed page kept.
    {"question_id": "BE505-L04-Q01", "collection": "L04", "number": 1, "title": "When to add the inducer",
     "prompt": "Explain why cells are grown before the inducer is added, and what the uninduced control is for.",
     "family_id": "be505.family.question.l04-q01", "origin": "generated_practice", "source": ("src-lecture-04-slides", "Slides 1, 3; transcript 4-9; timing example tutor-created"), "page": None,
     "criteria": [("be505.skill.inducible-control.explain", "be505.concept.inducible-promoter", "Relates induction timing to host burden and names the control's purpose.", ["explain"])],
     "answer": "Growing first builds biomass before the burden of expression; the uninduced control shows leaky expression."},
    {"question_id": "BE505-L04-Q02", "collection": "L04", "number": 2, "title": "Reading a lag",
     "prompt": "The product appears only after a delay. Give one reason for the lag.",
     "family_id": "be505.family.question.l04-q02", "origin": "generated_practice", "source": ("src-lecture-04-slides", "Transcript 3-5 (in-class question)"), "page": None,
     "criteria": [("be505.skill.inducible-control.explain", "be505.concept.inducible-promoter", "Attributes the lag to transcription and translation taking time after the repressor releases.", ["explain"])],
     "answer": "After the repressor releases, transcription and translation take time before product accumulates."},
    # The instructor's own in-class sheet: its own collection and source; no wording in the catalog.
    {"question_id": "BE505-L04-CLASS-Q01", "collection": "L04-class", "number": 1, "title": "In-class question 1", "prompt": None,
     "prompt_status": "Read the original question and diagram (synthetic fixture).", "bank_path": "materials/lectures/lecture-04/04 - Fixture in-class questions.pdf",
     "family_id": "be505.family.question.l04-class-q01", "origin": "course_source", "source": ("src-lecture-04-in-class-questions", "page 1, Question 1"), "page": 1,
     "criteria": [("be505.skill.inducible-control.explain", "be505.concept.inducible-promoter", "Sketch shows lag, rise and plateau after induction.", ["explain"])],
     "answer": "A curve that stays near baseline, rises after a lag and levels off."},
    # Original is a .docx (authoritative, not displayable here); the course index relates a PDF working copy to it.
    {"question_id": "BE505-PS03-Q01", "collection": "PS03", "number": 1, "title": "Problem set 3, question 1", "prompt": None,
     "prompt_status": "Original source is authoritative; open the stated page including figures and givens (synthetic fixture).",
     "source_path": "materials/assignments/ps-03/Fixture PS03.docx", "bank_path": "materials/assignments/ps-03/Fixture PS03 blank.pdf",
     "family_id": "be505.family.question.ps03-q01", "origin": "course_source", "source": ("src-ps-03-brief", "Question 1, including all subparts, supplied figures and numerical givens"), "page": 1,
     "criteria": [("be505.skill.inducible-control.explain", "be505.concept.inducible-promoter", "States one design change that lowers leaky expression.", ["explain"])],
     "answer": "For example a tighter operator or a lower-copy origin."},
    # ---- lecture-05, the R2 showcase unit. "guidance_map" names the unit's own companion question map (ids of collection L05 only). ----
    # Collection L05 has a reviewed page basis (app-read-overrides.json), so a page its locator names is an EXACT anchor; pages and
    # transcript lines stay separate anchor types.
    {"question_id": "BE505-L05-Q01", "collection": "L05", "number": 1, "title": "Order of the reporter construct", "topic": "be505.topic.reporter-assays", "guidance_map": "lecture-05",
     "prompt": "List the parts of the reporter construct in the order they are added, and say what the terminator is for.",
     "family_id": "be505.family.question.l05-q01", "origin": "generated_practice", "source": ("src-lecture-05-slides", "Slides 4-6; transcript 9-17"), "page": None,
     "criteria": [("be505.skill.reporter.explain", "be505.concept.reporter-gene", "Names promoter fragment, coding sequence, binding site and terminator in that order and ties the terminator to the end of transcription.", ["explain"])],
     "answer": "Promoter fragment, then the fluorescent coding sequence, then the ribosome binding site and the terminator; the terminator ends transcription."},
    # Three questions whose locator names no page: the lecture owns them all the same, and a suggestions file may propose pages.
    {"question_id": "BE505-L05-Q02", "collection": "L05", "number": 2, "title": "Why the construct is built this way", "topic": "be505.topic.reporter-assays", "guidance_map": "lecture-05",
     "prompt": "Explain why the fluorescent coding sequence sits downstream of the promoter fragment, why a ribosome binding site is added, and what you would measure to compare two fragments.",
     "family_id": "be505.family.question.l05-q02", "origin": "generated_practice",
     "source": ("src-lecture-05-slides", "lecture scientific content; exact mapping in companion hierarchy/source map"), "page": None,
     "criteria": [
         ("be505.skill.reporter.explain", "be505.concept.reporter-gene", "Links the downstream position of the coding sequence to being transcribed from the tested fragment.", ["explain"]),
         ("be505.skill.binding-site.explain", "be505.concept.ribosome-binding-site", "Links the ribosome binding site to translation of the message.", ["explain"]),
         ("be505.skill.blank.interpret", "be505.concept.blank-subtraction", "Names brightness after blank subtraction as the quantity compared between fragments.", ["interpret"]),
     ],
     "answer": "Downstream so the tested fragment drives its transcription; the binding site so the message is translated; compare blank-corrected brightness."},
    {"question_id": "BE505-L05-Q03", "collection": "L05", "number": 3, "title": "Steps of a plate reading", "topic": "be505.topic.reporter-assays", "guidance_map": "lecture-05",
     "prompt": "Describe the steps of reading one well of the plate, in order.",
     "family_id": "be505.family.question.l05-q03", "origin": "generated_practice",
     "source": ("src-lecture-05-slides", "lecture scientific content; exact mapping in companion hierarchy/source map"), "page": None,
     "criteria": [("be505.skill.blank.interpret", "be505.concept.blank-subtraction", "Gives excitation, collection of emission and subtraction of the empty-well value, in order.", ["interpret"])],
     "answer": "Excite with blue light, collect the green emission through the filter, subtract the empty-well reading."},
    {"question_id": "BE505-L05-Q04", "collection": "L05", "number": 4, "title": "From reading to amount", "topic": "be505.topic.reporter-assays", "guidance_map": "lecture-05",
     "prompt": "A well reads 500 units and the blank reads 20. With a slope of 12 units per nanomole, compute the amount and say what the slope stands for.",
     "family_id": "be505.family.question.l05-q04", "origin": "generated_practice",
     "source": ("src-lecture-05-slides", "lecture scientific content; exact mapping in companion hierarchy/source map"), "page": None,
     "criteria": [
         ("be505.skill.calibration.calculate", "be505.concept.calibration-line", "Subtracts the blank, divides by the slope and reaches 40 nanomoles.", ["calculate"]),
         ("be505.skill.calibration.explain", "be505.concept.calibration-line", "Describes the slope as reading per unit amount, obtained from the standards.", ["explain"]),
     ],
     "answer": "(500 - 20) / 12 = 40 nanomoles; the slope is the reading gained per nanomole, fitted from the standards."},
    # A collection without a reviewed page basis: the page its locator names is a STATED anchor.
    {"question_id": "BE505-L05-PRACTICE-Q01", "collection": "L05-practice", "number": 1, "title": "What is subtracted first", "topic": "be505.topic.reporter-assays",
     "prompt": "In the worked example, which number is taken away first, and why?",
     "family_id": "be505.family.question.l05-practice-q01", "origin": "generated_practice", "source": ("src-lecture-05-slides", "Slide 12"), "page": None,
     "criteria": [("be505.skill.blank.interpret", "be505.concept.blank-subtraction", "Says the blank reading goes first because that signal does not come from the reporter.", ["interpret"])],
     "answer": "The blank, 40 units: it is background that the reporter did not produce."},
    # The instructor's own sheet of the unit: no wording in the catalog and no page of the deck named.
    {"question_id": "BE505-L05-CLASS-Q01", "collection": "L05-class", "number": 1, "title": "In-class question 1", "prompt": None, "topic": "be505.topic.reporter-assays",
     "prompt_status": "Read the original question and diagram (synthetic fixture).", "bank_path": "materials/lectures/lecture-05/05 - Fixture in-class questions.pdf",
     "family_id": "be505.family.question.l05-class-q01", "origin": "course_source", "source": ("src-lecture-05-in-class-questions", "Question 1 with its diagram; read the original sheet"), "page": None,
     "criteria": [("be505.skill.reporter.explain", "be505.concept.reporter-gene", "Sketch labels fragment, coding sequence and terminator and shows which way the construct is read.", ["explain"])],
     "answer": "A line with three labelled boxes in the order fragment, coding sequence, terminator, and an arrow pointing from the fragment."},
]

PS03_QUESTION_LINES = ["Fixture Problem Set 03", "Question 1. A culture shows product before any inducer is added.",
                       "Propose one design change that lowers this leaky expression and say why it helps.", "No drawing is required for this question."]
PS03_PAGES = [{"title": PS03_QUESTION_LINES[0], "bullets": PS03_QUESTION_LINES[1:], "figure": "promoter"}]

BE505_RELATIONSHIPS = [
    {"from_question": "BE505-L01-Q01", "to_question": "BE505-L01-Q03", "relation": "diagnostic_prerequisite",
     "rationale": "Explaining the origin alone is a narrower step used when the combined prediction fails."},
    {"from_question": "BE505-L01-Q02", "to_question": "BE505-L01-Q03", "relation": "strict_containment",
     "rationale": "The promoter explanation is fully contained in the combined prediction question."},
    {"from_question": "BE505-L01-Q03", "to_question": "BE505-L02-Q01", "relation": "partial_overlap",
     "rationale": "Both require reasoning about when transcription happens."},
    {"from_question": "BE505-L04-Q01", "to_question": "BE505-PS03-Q01", "relation": "diagnostic_prerequisite",
     "rationale": "Explaining induction timing is a narrower step used when the leaky-expression design question fails."},
    {"from_question": "BE505-L05-Q01", "to_question": "BE505-L05-Q02", "relation": "diagnostic_prerequisite",
     "rationale": "Listing the parts in order is a narrower step used when the reasons for that order are not given."},
]

# The course's own study map of lecture-05 (work/lecture-review/lecture-05-source-map.md): content | slide pages | transcript lines | questions.
# Three rows a reader can take and one it must skip (its pages cell is not a list of numbers). The first row is a section in
# the proper sense: four pages and seventeen lines, with no page of its own; the second has the very lines the talk spends on
# its pages; the third names a few lines inside a longer stretch.
SHOWCASE_STUDY_MAP_ROWS = [
    ("The reporter gene and its construct", "3-6", "3-17", "Q1 all, Q2 part"),
    ("Reading the plate", "7-8", "18-23", "Q3"),
    ("Worked example, the numbers", "12", "38-40", ""),
    ("Calibration line", "see the handout", "24-26", "Q4"),
]

# Synthetic suggestions for the questions whose locator names no page (app-private state, never a course file; see fixtures/state.py).
# No agent pass produced them: they are written out here so that every state of a suggested link can be seen.
SHOWCASE_SUGGESTIONS = [
    {"question_id": "BE505-L05-Q02", "pages": [5, 6], "criteria": [1, 2], "per_page": {5: [1], 6: [1, 2]}, "coverage": "partial", "state": "agent_inferred", "verifier": None,
     "rationale": "Synthetic fixture: the second build adds the coding sequence after the fragment and the third adds the binding site. Neither page says what is measured."},
    {"question_id": "BE505-L05-Q03", "pages": [7, 8], "criteria": [1], "per_page": None, "coverage": "main", "state": "agent_reviewed",
     "verifier": {"verdict": "upheld", "note": "Synthetic fixture: both steps of the page list the three actions in order."},
     "rationale": "Synthetic fixture: the page lists excite, collect and subtract as its three bullets."},
    {"question_id": "BE505-L05-Q04", "pages": [10], "criteria": [2], "per_page": None, "coverage": "partial", "state": "agent_reviewed",
     "verifier": {"verdict": "narrowed", "note": "Synthetic fixture: narrowed to the page that defines the line; the page with the worked numbers was dropped and only the slope criterion kept."},
     "rationale": "Synthetic fixture: the page writes the line and names its slope and blank."},
    {"question_id": "BE505-L05-Q04", "pages": [13], "criteria": [1], "per_page": None, "coverage": "partial", "state": "agent_reviewed",
     "verifier": {"verdict": "rejected", "note": "Synthetic fixture: the page is about where the line stops holding; it shares words with the question and supports none of its steps."},
     "rationale": "Synthetic fixture: the page mentions readings and the standards."},
]
SHOWCASE_NO_CANDIDATE = [
    {"question_id": "BE505-L05-CLASS-Q01", "why": "Synthetic fixture: no page of the deck shows the sketch this question asks for; it is answered on the in-class sheet.",
     "verifier": {"confirmed": True, "note": "Synthetic fixture: checked against all fourteen pages."}},
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
            # A unit holding several files, as real course folders do: a second deck and a note beside the slides.
            {"unit": "lecture-02", "deck": "Fixture 562 Lecture 02.pdf", "indexed": False, "slides": ["Bayesian networks"],
             "more_decks": [("Fixture 562 Reading A.pdf", ["Reading A: d-separation", "Reading A: worked example"])], "notes": ["Fixture 562 unit notes.txt"]},
        ],
        "sessions": [
            # Linked to lecture-01 by the course index, with an UNTIMED transcript: like most real sessions, it yields no timed slide link.
            {"date": "2026-09-04", "transcript": "Fixture 562 Lec 1.txt", "recording": "Fixture 562 Lec 1.wav", "index_transcript": True, "index_recording": True, "lecture": "lecture-01"},
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
