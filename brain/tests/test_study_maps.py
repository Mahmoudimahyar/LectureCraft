"""R2 (Phase 5 "reviewed anchors first"; Phase 4 "known transcript-line source maps"): the course's own study maps.

A course may keep, beside its question maps, one Markdown note per lecture whose table ties a piece of content to slide
pages, transcript lines and question numbers. The reader under test only reads: it admits a table by its header, takes
a row only when its page and line cells are nothing but numbers and ranges, binds the rows to the bytes the note names,
and reports everything else. The course trees are generated fixtures and every cell of every table here is synthetic.
The only wordings taken from real notes are column headings the reader has to recognise (the five header rows below,
"Input" and "SHA256"): structure, no content.
"""
from __future__ import annotations

import builtins
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from lecture_brain.ownerio import study_maps as sm
from lecture_brain.ownerio.catalogs import read_question_index
from lecture_brain.ownerio.inventory import build_inventory, primary_deck
from lecture_brain.ownerio.question_links import build_question_bank

# The header wordings met so far: (cells, label, pages, transcript, questions) by position.
HEADERS = [
    (["Scientific content", "Slide/PDF pages", "Transcript lines", "Diagnostic", "Priority evidence"], 0, 1, 2, 3),
    (["Summary location", "Scientific content", "Original slide pages", "Transcript lines", "Diagnostic criteria supported"], 1, 2, 3, 4),
    (["Concept", "Slide pages", "Transcript lines", "Diagnostic", "Summary"], 0, 1, 2, 3),
    (["Summary location", "Content", "Slide pages", "Transcript lines", "Questions / coverage"], 1, 2, 3, 4),
    (["Summary location", "Concepts", "Slide pages", "Transcript lines", "Diagnostic coverage"], 1, 2, 3, 4),
]
PLAIN = ["Concept", "Slide pages", "Transcript lines", "Diagnostic", "Summary"]


def table(header: list[str], *rows: list[str]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    return "\n".join(lines + ["| " + " | ".join(row) + " |" for row in rows])


def parse(*blocks: str, **bounds):
    return sm.parse_study_map("# Synthetic study note\n\n" + "\n\nSynthetic prose between tables.\n\n".join(blocks) + "\n", **bounds)


def row(pages: str, lines: str, questions: str = "Q1 all", label: str = "Synthetic topic") -> list[str]:
    return [label, pages, lines, questions, "synthetic note"]


def asked(parsed_row: dict) -> list[tuple]:
    return [(q["number"], q["scope"]) for q in parsed_row["questions"]]


# ---- admitting a table and reading a row ------------------------------------------------------------
@pytest.mark.parametrize("header,label,pages,transcript,questions", HEADERS)
def test_each_header_wording_is_read_by_what_its_columns_name(header, label, pages, transcript, questions):
    cells = ["synthetic note"] * len(header)
    cells[label], cells[pages], cells[transcript], cells[questions] = "Synthetic topic alpha", "31-36", "210-245", "Q2-Q4"
    parsed = parse(table(header, cells))
    assert parsed["skipped"] == [] and parsed["problems"] == []
    (only,) = parsed["rows"]
    assert only["row"] == 1 and only["label"] == "Synthetic topic alpha"
    assert only["page_ranges"] == [[31, 36]] and only["pages"] == list(range(31, 37))
    assert only["transcript_ranges"] == [[210, 245]]
    assert asked(only) == [(2, None), (3, None), (4, None)]
    # every other cell is kept as written, under the heading the course gave it
    others = {header[i]: cells[i] for i in range(len(header)) if i not in (label, pages, transcript)}
    assert only["note"] == others
    (admitted,) = [t for t in parsed["tables"] if t["kind"] == "study_map"]
    assert admitted["columns"] == {"label": header[label], "pages": header[pages], "transcript": header[transcript], "questions": header[questions]}


def test_a_page_list_stays_a_list_and_a_line_number_is_not_a_page():
    (only,) = parse(table(PLAIN, row("27, 29-33", "310-345")))["rows"]
    assert only["page_ranges"] == [[27, 27], [29, 33]] and only["pages"] == [27, 29, 30, 31, 32, 33]  # 28 is not named
    assert only["transcript_ranges"] == [[310, 345]] and 310 not in only["pages"]


def test_en_dashes_and_spaces_are_read_as_written():
    (only,) = parse(table(PLAIN, row(" 12 ,17 – 21 ", "57–73 , 142 - 205", "Q1 – Q2")))["rows"]
    assert only["page_ranges"] == [[12, 12], [17, 21]] and only["pages"] == [12, 17, 18, 19, 20, 21]
    assert only["transcript_ranges"] == [[57, 73], [142, 205]]
    assert asked(only) == [(1, None), (2, None)]


def test_the_question_column_is_optional():
    parsed = parse(table(["Concept", "Slide pages", "Transcript lines"], ["Synthetic topic", "3-4", "10-20"]))
    (only,) = parsed["rows"]
    assert only["questions"] == [] and only["note"] == {} and parsed["tables"][0]["columns"]["questions"] is None


def test_tables_of_other_kinds_in_the_same_file_are_left_alone_and_doubtful_ones_are_reported():
    inputs = table(["Input", "Extent", "SHA256"], ["[Synthetic deck.pdf](../../materials/lectures/lecture-01/Synthetic%20deck.pdf)", "9 synthetic pages", "`" + "ab" * 32 + "`"])
    notes = table(["Synthetic issue", "Synthetic treatment", "Synthetic check"], ["Synthetic slide 3 remark 5-9", "synthetic treatment", "synthetic check 10-20"])
    first = table(PLAIN, row("2-3", "5-9"), row("spoken only", "10-12", "Q2 all"))
    no_lines = table(["Concept", "Slide pages", "Diagnostic"], ["Synthetic topic", "4", "Q6 all"])
    two_line_columns = table(["Concept", "Slide pages", "Transcript lines", "Transcript lines (second pass)"], ["Synthetic topic", "4", "1-2", "3-4"])
    two_page_columns = table(["Concept", "Slide pages", "Original slide pages", "Transcript lines"], ["Synthetic topic", "4", "5", "3-4"])
    second = table(HEADERS[1][0], ["Sheet 1", "Synthetic topic two", "6", "30-40", "Q5 all"])
    parsed = parse(inputs, notes, first, no_lines, two_line_columns, two_page_columns, second)
    # rows are numbered once per file, over the admitted tables in file order, skipped rows included
    assert [(r["row"], r["label"], r["pages"]) for r in parsed["rows"]] == [(1, "Synthetic topic", [2, 3]), (3, "Synthetic topic two", [6])]
    assert [(s["row"], s["reason"]) for s in parsed["skipped"]] == [(2, "pages_cell_not_numeric")]
    assert [t["kind"] for t in parsed["tables"]] == ["inputs", "study_map", "study_map"]
    assert sorted((p["code"], p["detail"]) for p in parsed["problems"]) == [
        ("table_not_admitted", "no column names transcript lines"), ("table_not_admitted", "several columns name slide pages"),
        ("table_not_admitted", "several columns name transcript lines")]
    assert [(i["name"], i["kind"], i["sha256"]) for i in parsed["inputs"]] == [("Synthetic deck.pdf", "pdf", "ab" * 32)]


def test_two_question_columns_are_not_chosen_between():
    parsed = parse(table(["Concept", "Slide pages", "Transcript lines", "Diagnostic", "Questions"], ["Synthetic topic", "4", "1-2", "Q41 all", "Q42 all"]))
    assert parsed["rows"][0]["questions"] == [] and [p["code"] for p in parsed["problems"]] == ["ambiguous_question_column"]
    assert parsed["rows"][0]["note"] == {"Diagnostic": "Q41 all", "Questions": "Q42 all"}  # both cells are still kept as written


def test_a_table_inside_a_code_block_is_an_example_not_a_statement():
    fenced = "```\n" + table(PLAIN, row("2-3", "5-9")) + "\n```"
    indented = "\n".join("    " + line for line in table(PLAIN, row("6-7", "20-29")).splitlines())
    parsed = parse(fenced, indented, table(PLAIN, row("4", "10-12", label="Synthetic a \\| b")))
    assert [(r["row"], r["pages"], r["label"]) for r in parsed["rows"]] == [(1, [4], "Synthetic a | b")]
    assert len(parsed["tables"]) == 1 and parsed["problems"] == []


EXAMPLE = table(PLAIN, row("61-62", "210-219", label="Synthetic example row"))


@pytest.mark.parametrize("block", [
    "````\n```\n{example}\n```\n````",                # a longer fence holds a shorter one: the inner line closes nothing
    "```\n{example}\n```oops\n\n{example}\n```",     # a closing fence carries no word, so the block goes on to the real one
    "~~~ text\n```\n{example}\n~~~",                  # the other fence character does not close it
    "<!--\n{example}\n-->",                           # a commented-out table
    "Synthetic <!-- one --> prose <!-- two\n{example}\n--> and more prose."])
def test_an_example_or_a_commented_out_table_is_not_a_statement(block):
    parsed = parse(block.replace("{example}", EXAMPLE), table(PLAIN, row("44", "110-112")))
    assert [(r["row"], r["pages"], r["label"]) for r in parsed["rows"]] == [(1, [44], "Synthetic topic")]
    assert len(parsed["tables"]) == 1 and parsed["problems"] == [] and parsed["skipped"] == []


def test_a_fence_closed_by_a_longer_one_ends_there_and_a_comment_inside_a_cell_hides_only_itself():
    parsed = parse("```\n" + EXAMPLE + "\n``````", table(PLAIN, row("44 <!-- , 45-49 -->", "110-112", "Q2 <!-- ; Q3 all -->")))
    (only,) = parsed["rows"]
    assert only["pages"] == [44] and asked(only) == [(2, None)] and parsed["problems"] == []


@pytest.mark.parametrize("opening,code", [("```", "code_block_not_closed"), ("~~~~", "code_block_not_closed"), ("Synthetic remark <!-- kept open", "comment_not_closed")])
def test_a_block_or_comment_that_never_closes_hides_the_rest_and_says_so(opening, code):
    text = "# Synthetic study note\n\n" + table(PLAIN, row("44", "110-112")) + "\n\n" + opening + "\n" + EXAMPLE + "\n"
    parsed = sm.parse_study_map(text)
    assert [r["pages"] for r in parsed["rows"]] == [[44]]
    assert [(p["code"], p["line"]) for p in parsed["problems"]] == [(code, 7)]


def test_the_pure_parser_reads_a_table_on_the_first_line_whatever_the_line_endings_or_a_leading_mark():
    text = chr(0xFEFF) + table(PLAIN, row("44", "110-112"), row("45-46", "113-120")).replace("\n", "\r\n") + "\r\n"
    assert [(r["row"], r["line"], r["pages"]) for r in sm.parse_study_map(text)["rows"]] == [(1, 3, [44]), (2, 4, [45, 46])]


# ---- hashes the note states for its input files, outside a table ------------------------------------
A, B, C, D = "a1" * 32, "b2" * 32, "c3" * 32, "d4" * 32


def stated(parsed: dict) -> list[tuple]:
    return [(i["name"], i["target"], i["kind"], i["sha256"], i["stated_in"], i["line"]) for i in parsed["inputs"]]


def test_a_hash_written_in_a_list_item_or_a_prose_line_that_names_a_file_is_a_listed_input():
    note = "\n".join([
        f"- Synthetic slides: [Synthetic deck.pdf](../../materials/lectures/lecture-01/Synthetic%20deck.pdf), 9 pages. SHA256 `{A}`.",
        f"- Synthetic transcript: `materials/sessions/day/Synthetic talk.txt`, SHA-256 {B.upper()}. A numbered copy: `cache/numbered.txt`.",
        f"1. A sibling exists, `Synthetic deck annotated.pdf`, SHA256 `{C}`; it was not used.",
        f"The captions file Synthetic-captions.vtt has the digest {D}.",
        f"- A digest that names no file: `{'e5' * 32}`.",
        "- [Synthetic summary.pdf](../exports/Synthetic%20summary.pdf) is named without a hash.",
        f"- Not a SHA-256 (one byte too long): `Synthetic deck.pdf` {'a1' * 33}",
        f"- Nor this (too short): `Synthetic deck.pdf` {'a1' * 31}"])
    parsed = sm.parse_study_map("# Synthetic study note\n\n" + note + "\n\n" + table(PLAIN, row("44", "110-112")) + "\n")
    assert stated(parsed) == [
        ("Synthetic deck.pdf", "../../materials/lectures/lecture-01/Synthetic%20deck.pdf", "pdf", A, "list_item", 3),
        ("materials/sessions/day/Synthetic talk.txt", None, "transcript", B, "list_item", 4),
        ("Synthetic deck annotated.pdf", None, "pdf", C, "list_item", 5),
        ("Synthetic-captions.vtt", None, "transcript", D, "line", 6)]
    assert parsed["problems"] == [] and [r["pages"] for r in parsed["rows"]] == [[44]]


def test_each_hash_of_a_line_goes_with_the_file_named_beside_it_or_is_reported():
    note = "\n".join([
        f"- `Synthetic deck.pdf` SHA256 `{A}`; `Synthetic talk.srt` SHA256 `{B}`.",
        f"- SHA256 `{C}` is that of [the synthetic handout](Synthetic%20handout.pdf); SHA256 `{D}` is that of `Synthetic talk.txt`.",
        f"- The slides `Synthetic deck.pdf` and the transcript `Synthetic talk.txt`: SHA256 `{A}`."])
    parsed = sm.parse_study_map(note + "\n\n" + table(PLAIN, row("44", "110-112")) + "\n")
    assert stated(parsed) == [
        ("Synthetic deck.pdf", None, "pdf", A, "list_item", 1), ("Synthetic talk.srt", None, "transcript", B, "list_item", 1),
        ("the synthetic handout", "Synthetic%20handout.pdf", "pdf", C, "list_item", 2), ("Synthetic talk.txt", None, "transcript", D, "list_item", 2)]
    # one hash after a PDF and a transcript: which of the two it is of is not guessed
    assert [(p["code"], p["line"]) for p in parsed["problems"]] == [("listed_hash_not_attributed", 3)]


def test_a_hash_in_a_code_block_a_comment_or_another_table_is_not_a_listed_input():
    hidden = f"- `Synthetic deck.pdf` SHA256 `{A}`"
    other = table(["Synthetic artifact", "Remark"], ["`Synthetic deck.pdf`", f"`{B}`"])
    listed = table(["Input", "Extent", "SHA256"], ["[Synthetic deck.pdf](x.pdf)", "9 pages", f"`{C}`"])
    parsed = parse("```\n" + hidden + "\n```", "<!--\n" + hidden + "\n-->", other, listed, table(PLAIN, row("44", "110-112")))
    assert stated(parsed) == [("Synthetic deck.pdf", "x.pdf", "pdf", C, "table", 23)] and parsed["problems"] == []


# ---- a row is taken whole or not at all -------------------------------------------------------------
@pytest.mark.parametrize("cell,reason", [
    ("", "pages_cell_empty"), ("Said aloud only", "pages_cell_not_numeric"), ("Sheet items 2-3; lecture 32-37", "pages_cell_not_numeric"),
    ("41-43; later 77-78", "pages_cell_not_numeric"), ("1-2-3", "pages_cell_not_numeric"), ("**5**", "pages_cell_not_numeric"), ("5,", "pages_cell_not_numeric"),
    ("p. 5", "pages_cell_not_numeric"), ("5 to 9", "pages_cell_not_numeric"), ("9-3", "pages_range_invalid"), ("0-2", "pages_range_invalid"),
    ("2-9999", "pages_range_invalid"), ("12345678", "pages_range_invalid"), ("99999999999999999999", "pages_range_invalid")])
def test_a_pages_cell_that_is_not_only_numbers_and_ranges_skips_the_row(cell, reason):
    parsed = parse(table(PLAIN, row("2", "5-9"), row(cell, "10-20"), row("3", "21-30")))
    assert [r["row"] for r in parsed["rows"]] == [1, 3]  # the neighbours are untouched and keep their numbers
    (skipped,) = parsed["skipped"]
    assert (skipped["row"], skipped["reason"], skipped["column"], skipped["text"]) == (2, reason, "pages", cell)


@pytest.mark.parametrize("cell,reason", [
    ("", "transcript_cell_empty"), ("535-550, spoken exercise", "transcript_cell_not_numeric"), ("10:05-12:00", "transcript_cell_not_numeric"),
    ("lines 5-9", "transcript_cell_not_numeric"), ("30-10", "transcript_range_invalid"), ("0", "transcript_range_invalid"), ("1-999999999", "transcript_range_invalid")])
def test_a_transcript_cell_that_is_not_only_numbers_and_ranges_skips_the_row(cell, reason):
    parsed = parse(table(PLAIN, row("2", cell), row("3", "21-30")))
    assert [r["row"] for r in parsed["rows"]] == [2]
    (skipped,) = parsed["skipped"]
    assert (skipped["row"], skipped["reason"], skipped["column"], skipped["text"]) == (1, reason, "transcript", cell)


def test_a_row_with_the_wrong_number_of_cells_is_not_realigned():
    text = table(PLAIN, row("2", "5-9")) + "\n| Synthetic short row | 3 | 10-12 |\n| Synthetic long row | 4 | 13-15 | Q1 | note | extra |\n"
    parsed = sm.parse_study_map(text)
    assert [r["row"] for r in parsed["rows"]] == [1]
    assert [(s["row"], s["reason"]) for s in parsed["skipped"]] == [(2, "cell_count_mismatch"), (3, "cell_count_mismatch")]


def test_numbers_beyond_the_known_page_or_line_count_are_refused_not_clamped():
    rows = table(PLAIN, row("18-20", "90-100"), row("18-21", "10-20"), row("3", "90-101"))
    free = parse(rows)
    assert [r["row"] for r in free["rows"]] == [1, 2, 3]  # counts unknown: only the general sanity bounds apply
    bounded = parse(rows, page_count=20, line_count=100)
    assert [r["row"] for r in bounded["rows"]] == [1]
    assert [(s["row"], s["reason"], s["column"]) for s in bounded["skipped"]] == [(2, "page_beyond_deck", "pages"), (3, "line_beyond_transcript", "transcript")]


def test_the_general_bounds_are_a_ceiling_and_a_span_each_on_its_own():
    """A number above the ceiling and a range wider than the span are two refusals; neither is caught by the other."""
    top, span, line_top, line_span = sm.MAX_PAGE, sm.MAX_SPAN, sm.MAX_LINE, sm.MAX_LINE_SPAN
    accepted = parse(table(PLAIN, row(f"{top}", f"{line_top}"), row(f"1-{1 + span}", f"1-{1 + line_span}"), row(f"{top - span}-{top}", f"{line_top - line_span}-{line_top}")))
    assert [r["row"] for r in accepted["rows"]] == [1, 2, 3] and accepted["skipped"] == []
    refused = parse(table(PLAIN,
                          row(f"{top + 1}", "110-112"), row(f"{top - 3}-{top + 1}", "110-112"),          # above the ceiling, narrow
                          row(f"1-{2 + span}", "110-112"),                                               # under the ceiling, too wide
                          row("44", f"{line_top + 1}"), row("44", f"{line_top - 3}-{line_top + 1}"),      # the same two for lines
                          row("44", f"1-{2 + line_span}")))
    assert refused["rows"] == []
    assert [(s["row"], s["reason"]) for s in refused["skipped"]] == [(1, "pages_range_invalid"), (2, "pages_range_invalid"), (3, "pages_range_invalid"),
                                                                    (4, "transcript_range_invalid"), (5, "transcript_range_invalid"), (6, "transcript_range_invalid")]


def test_only_the_first_rows_up_to_the_bound_are_read_and_the_rest_is_reported(monkeypatch):
    monkeypatch.setattr(sm, "MAX_TABLE_ROWS", 3)
    first = table(PLAIN, row("44", "110-112"), row("spoken", "113-114"))
    second = table(PLAIN, row("45", "115-116"), row("46", "117-118"), row("47", "119-120"))
    parsed = parse(first, second, table(PLAIN, row("48", "121-122")))
    assert [(r["row"], r["pages"]) for r in parsed["rows"]] == [(1, [44]), (3, [45])]  # a skipped row counts as a row that was read
    assert [(s["row"], s["reason"]) for s in parsed["skipped"]] == [(2, "pages_cell_not_numeric")]
    assert [(p["code"], p["line"]) for p in parsed["problems"]] == [("too_many_rows", 13), ("too_many_rows", 20)]
    assert [t["data_rows"] for t in parsed["tables"]] == [2, 1, 0]


# ---- question cells ---------------------------------------------------------------------------------
@pytest.mark.parametrize("cell,expected", [
    ("Q21", [(21, None)]), ("Q22-Q24", [(22, None), (23, None), (24, None)]), ("Q22–Q24", [(22, None), (23, None), (24, None)]), ("Q26, Q32", [(26, None), (32, None)]),
    ("Q33, Q36-Q37", [(33, None), (36, None), (37, None)]), ("Q22 all; Q23 all", [(22, "all"), (23, "all")]),
    ("Q5 all; Q6 all; synthetic prerequisite of Q7", [(5, "all"), (6, "all"), (7, "part")]),
    ("Q3 all; Q10 all; synthetic directions in Q14", [(3, "all"), (10, "all"), (14, "part")]),
    ("Q22-Q24: all 11 criteria; synthetic sheet page 2", [(22, "all"), (23, "all"), (24, "all")]),
    ("Q27-Q28 and Q31: all 8 criteria", [(27, "all"), (28, "all"), (31, "all")]),
    ("Q3 (synthetic remark)", [(3, "part")]), ("Q1 (all)", [(1, "all")]), ("Q1 all, and Q2 all", [(1, "all"), (2, "all")]),
    ("Q4 & Q5 all", [(4, "all"), (5, "all")]), ("Q1 all, & Q2", [(1, "all"), (2, None)]), ("Q6 allocation step", [(6, "part")]),
    # a bare count of criteria says neither "all" nor "part of": the scope stays unstated
    ("Q22: 4 criteria", [(22, None)]), ("Q23 and Q26: 7 criteria", [(23, None), (26, None)]),
    # "all" followed by words this reader does not interpret is not promoted to "all"
    ("Q1 all except the last step", [(1, None)]), ("Q1 all, except the last step; Q2 all", [(1, None), (2, "all")]),
    ("Q2 all; later part of Q2", [(2, "all")]),  # the first statement about a number is the one kept
    ("Background only", []), ("", []), ("FAQ12 and IQ3", []), ("Question 3", [])])
def test_question_numbers_and_their_stated_scope(cell, expected):
    (only,) = parse(table(PLAIN, row("2", "5-9", cell)))["rows"]
    assert asked(only) == expected and only["questions_unparsed"] == []
    assert only["note"]["Diagnostic"] == cell.strip()  # the cell itself is kept as written


@pytest.mark.parametrize("cell,kept,unparsed", [
    ("Q1-3", [], ["Q1-3"]), ("Q3-Q1", [], ["Q3-Q1"]), ("Q0", [], ["Q0"]), ("Q12a", [], ["Q12a"]),
    ("Q2; Q5-9 synthetic", [(2, None)], ["Q5-9 synthetic"])])
def test_a_question_reference_that_cannot_be_read_gives_no_question_and_the_row_stays(cell, kept, unparsed):
    parsed = parse(table(PLAIN, row("2", "5-9", cell)))
    (only,) = parsed["rows"]
    assert asked(only) == kept and only["questions_unparsed"] == unparsed and parsed["skipped"] == []


# ---- the files that are read -------------------------------------------------------------------------
@pytest.fixture()
def root(settings) -> Path:
    return settings.course("be505").root


@pytest.fixture()
def inventory(settings):
    return lambda: build_inventory(settings.course("be505"))


@pytest.fixture()
def opened(monkeypatch) -> list[Path]:
    """Every file opened through Python's open while a test runs (pathlib reads go through it)."""
    seen: list[Path] = []
    real = io.open

    def spy(file, *args, **kwargs):
        if not isinstance(file, int):
            seen.append(Path(os.fspath(file)).resolve())
        return real(file, *args, **kwargs)

    monkeypatch.setattr(io, "open", spy)
    monkeypatch.setattr(builtins, "open", spy)
    return seen


def write_map(root: Path, number: int, *blocks: str, folder: str = "work/lecture-review", name: str | None = None) -> Path:
    path = root / folder / (name or f"lecture-{number:02d}-source-map.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(("# Synthetic study note\n\n" + "\n\n".join(blocks) + "\n").encode("utf-8"))
    return path


def unit(inv: dict, lecture_id: str) -> dict:
    return next(lecture for lecture in inv["lectures"] if lecture["lecture_id"] == lecture_id)


def transcript_of(inv: dict, lecture_id: str) -> dict:
    (only,) = [i for s in unit(inv, lecture_id)["sessions"] for i in s["items"] if i["kind"] == "lecture_transcript"]
    return only


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs_table(*entries: tuple[str, str, str], header: str = "Input") -> str:
    return table([header, "Extent", "SHA256"], *[[f"[{name}]({target})", "synthetic scope", f"`{digest}`" if digest else ""] for name, target, digest in entries])


def tree(top: Path) -> dict[str, str]:
    return {p.relative_to(top).as_posix(): (hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else "<dir>") for p in sorted(top.rglob("*"))}


def codes(result: dict) -> list[tuple[str, str]]:
    return sorted((p["code"], p["file"]) for p in result["problems"])


def test_a_course_without_the_folder_or_without_maps_has_none(root, inventory, tmp_path):
    assert sm.read_study_maps(root, inventory()) == {"maps_version": "course-study-map/1", "lectures": {}, "problems": []}
    assert sm.read_study_maps(tmp_path / "no-such-course", {"lectures": []})["lectures"] == {}


def test_only_files_named_for_a_lecture_directly_in_the_review_folder_are_read(root, inventory, opened):
    good = write_map(root, 1, table(PLAIN, row("2-3", "1-4")))
    elsewhere = [write_map(root, 2, table(PLAIN, row("1", "1-2")), folder="work/lecture-review/archive"),
                 write_map(root, 2, table(PLAIN, row("1", "1-2")), folder="work"),
                 write_map(root, 2, table(PLAIN, row("1", "1-2")), name="lecture-02-source-map-v2.md"),
                 write_map(root, 2, table(PLAIN, row("1", "1-2")), name="lecture-2-source-map.md"),
                 write_map(root, 2, table(PLAIN, row("1", "1-2")), name="lecture-02-source-map.md.bak"),
                 write_map(root, 2, table(PLAIN, row("1", "1-2")), name="notes-lecture-02-source-map.md")]
    inv = inventory()
    opened.clear()
    result = sm.read_study_maps(root, inv)
    assert list(result["lectures"]) == ["lecture-01"] and result["problems"] == []
    record = result["lectures"]["lecture-01"]
    assert record["source"] == {"path": "work/lecture-review/lecture-01-source-map.md", "sha256": sha(good), "bytes": good.stat().st_size}
    assert [r["pages"] for r in record["rows"]] == [[2, 3]] and record["skipped"] == []
    assert good.resolve() in opened and not [p for p in elsewhere if p.resolve() in opened]


def test_a_map_for_a_lecture_the_inventory_does_not_have_is_reported_and_not_read(root, inventory, opened):
    stray = write_map(root, 9, table(PLAIN, row("2-3", "1-4")))
    inv = inventory()
    opened.clear()
    result = sm.read_study_maps(root, inv)
    assert result["lectures"] == {} and codes(result) == [("lecture_not_in_inventory", "lecture-09-source-map.md")]
    assert stray.resolve() not in opened


def test_an_oversize_or_undecodable_map_is_reported_and_gives_no_rows(root, inventory, opened):
    big = write_map(root, 1, table(PLAIN, row("2-3", "1-4")), "Synthetic filler. " * (sm.MAX_MAP_BYTES // 18 + 1))
    bad = root / "work/lecture-review/lecture-02-source-map.md"
    bad.write_bytes(b"# Synthetic note \xff\xfe\n\n" + table(PLAIN, row("1", "1-2")).encode("utf-8"))
    inv = inventory()
    opened.clear()
    result = sm.read_study_maps(root, inv)
    assert result["lectures"] == {} and codes(result) == [("not_utf8", "lecture-02-source-map.md"), ("too_large", "lecture-01-source-map.md")]
    assert big.resolve() not in opened  # the size is checked before a byte is read


def test_a_map_without_an_admitted_table_is_listed_with_no_rows(root, inventory):
    write_map(root, 1, "Synthetic prose only.", table(["Synthetic issue", "Synthetic treatment"], ["Synthetic slide 3", "synthetic"]))
    result = sm.read_study_maps(root, inventory())
    assert result["lectures"]["lecture-01"]["rows"] == [] and codes(result) == [("no_admitted_table", "lecture-01-source-map.md")]


def _link_directory(link: Path, target: Path) -> bool:
    """A directory link that needs no privilege: a junction on Windows, a symlink elsewhere."""
    if sys.platform == "win32":
        return subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True).returncode == 0
    os.symlink(target, link, target_is_directory=True)
    return True


def test_a_review_folder_that_leads_out_of_the_course_is_never_entered(root, inventory, tmp_path, opened):
    outside = tmp_path / "outside-review"
    shutil.move(str(root / "work" / "lecture-review"), str(outside))
    inside_name = write_map(outside.parent, 1, table(PLAIN, row("2-3", "1-4")), folder="outside-review")
    assert _link_directory(root / "work" / "lecture-review", outside), "could not create a directory link on this machine"
    inv = inventory()
    opened.clear()
    result = sm.read_study_maps(root, inv)
    assert result["lectures"] == {} and [p["code"] for p in result["problems"]] == ["folder_outside_course"]
    assert inside_name.resolve() not in opened


def test_a_map_that_is_a_file_link_is_refused(root, inventory, tmp_path, opened):
    target = write_map(tmp_path, 1, table(PLAIN, row("2-3", "1-4")), folder="elsewhere")
    link = root / "work/lecture-review/lecture-01-source-map.md"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("This machine does not allow creating a file symlink without elevation; the directory-link case is covered above.")
    inv = inventory()
    opened.clear()
    result = sm.read_study_maps(root, inv)
    assert result["lectures"] == {} and codes(result) == [("unsafe_path", "lecture-01-source-map.md")]
    assert target.resolve() not in opened


# ---- which bytes the rows speak about ----------------------------------------------------------------
def test_without_an_inputs_table_rows_bind_to_the_displayed_deck_and_unit_transcript_unverified(root, inventory, opened):
    write_map(root, 1, table(PLAIN, row("2-3", "1-4")))
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    opened.clear()
    record = sm.read_study_maps(root, inv)["lectures"]["lecture-01"]
    assert {k: record["deck"][k] for k in ("source_id", "basis", "bytes_verified", "state")} == {
        "source_id": deck["source_id"], "basis": "unit_displayed_deck", "bytes_verified": False, "state": "current"}
    assert {k: record["transcript"][k] for k in ("source_id", "basis", "bytes_verified", "state")} == {
        "source_id": transcript["source_id"], "basis": "unit_transcript", "bytes_verified": False, "state": "current"}
    assert record["deck"]["sha256"] is None and record["transcript"]["sha256"] is None
    assert (root / deck["path"]).resolve() not in opened and (root / transcript["path"]).resolve() not in opened  # nothing to compare: nothing hashed


def test_an_inputs_table_with_the_units_own_hashes_verifies_the_bytes(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    listed = inputs_table((deck["filename"], "../../" + deck["path"].replace(" ", "%20"), sha(root / deck["path"])),
                          (transcript["filename"], "../../" + transcript["path"].replace(" ", "%20"), sha(root / transcript["path"]).upper()))
    write_map(root, 1, listed, table(PLAIN, row("2-3", "1-4")))
    result = sm.read_study_maps(root, inv)
    record = result["lectures"]["lecture-01"]
    assert result["problems"] == []
    assert record["deck"] == {"source_id": deck["source_id"], "basis": "listed_sha256_match", "bytes_verified": True, "state": "current", "reason": None,
                              "on_displayed_deck": True, "sha256": sha(root / deck["path"]), "listed_sha256": [sha(root / deck["path"])]}
    assert record["transcript"] == {"source_id": transcript["source_id"], "basis": "listed_sha256_match", "bytes_verified": True, "state": "current", "reason": None,
                                    "sha256": sha(root / transcript["path"]), "listed_sha256": [sha(root / transcript["path"])]}
    assert [(i["kind"], i["sha256"] is not None, i["stated_in"]) for i in record["inputs"]] == [("pdf", True, "table"), ("transcript", True, "table")]


def test_a_hash_stated_in_a_list_item_binds_and_verifies_like_a_table_row(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, f"- Synthetic slides: [{deck['filename']}](x.pdf), 9 pages. SHA256 `{sha(root / deck['path'])}`.\n"
                       f"- Synthetic transcript: `{transcript['path']}`, SHA256 `{sha(root / transcript['path'])}`. A numbered copy: `cache/numbered.txt`.",
              table(PLAIN, row("2-3", "1-4")))
    maps = sm.read_study_maps(root, inv)
    record = maps["lectures"]["lecture-01"]
    assert maps["problems"] == [] and [(i["kind"], i["stated_in"]) for i in record["inputs"]] == [("pdf", "list_item"), ("transcript", "list_item")]
    assert {k: record["deck"][k] for k in ("source_id", "basis", "bytes_verified", "state")} == {
        "source_id": deck["source_id"], "basis": "listed_sha256_match", "bytes_verified": True, "state": "current"}
    assert {k: record["transcript"][k] for k in ("source_id", "basis", "bytes_verified", "state")} == {
        "source_id": transcript["source_id"], "basis": "listed_sha256_match", "bytes_verified": True, "state": "current"}
    assert [hint["bytes_verified"] for hint in sm.timing_hints(maps, "lecture-01")] == [True]
    # the unit's files change afterwards: what the note lists no longer describes them, and that is never silent
    with (root / deck["path"]).open("ab") as handle:
        handle.write(b"\n% synthetic later edit\n")
    (root / transcript["path"]).write_text("Synthetic replacement line.\n", encoding="utf-8")
    later = sm.read_study_maps(root, inventory())
    assert (later["lectures"]["lecture-01"]["deck"]["state"], later["lectures"]["lecture-01"]["transcript"]["state"]) == ("stale", "stale")
    assert sm.timing_hints(later, "lecture-01") == []


def test_a_map_file_with_a_byte_order_mark_and_windows_line_endings_is_read_from_its_first_line(root, inventory):
    path = root / "work/lecture-review/lecture-01-source-map.md"
    path.write_bytes(b"\xef\xbb\xbf" + table(PLAIN, row("2-3", "1-4"), row("4", "5-6")).replace("\n", "\r\n").encode("utf-8") + b"\r\n")
    result = sm.read_study_maps(root, inventory())
    assert result["problems"] == []
    assert [(r["row"], r["line"], r["pages"]) for r in result["lectures"]["lecture-01"]["rows"]] == [(1, 3, [2, 3]), (2, 4, [4])]


def test_bytes_that_differ_from_the_listed_hash_make_the_binding_stale_never_silently_current(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", sha(root / deck["path"])), (transcript["filename"], "x.txt", sha(root / transcript["path"])), header="Listed input"),
              table(PLAIN, row("2-3", "1-4")))
    with (root / deck["path"]).open("ab") as handle:  # the unit now holds other bytes than the map was made from
        handle.write(b"\n% synthetic later edit\n")
    (root / transcript["path"]).write_text("Synthetic replacement line.\n", encoding="utf-8")
    maps = sm.read_study_maps(root, inventory())
    record = maps["lectures"]["lecture-01"]
    assert (record["deck"]["source_id"], record["deck"]["state"], record["deck"]["bytes_verified"]) == (deck["source_id"], "stale", False)
    assert record["deck"]["sha256"] == sha(root / deck["path"]) and record["deck"]["sha256"] not in record["deck"]["listed_sha256"]
    assert (record["transcript"]["source_id"], record["transcript"]["state"], record["transcript"]["bytes_verified"]) == (transcript["source_id"], "stale", False)
    assert [r["pages"] for r in record["rows"]] == [[2, 3]]  # what the map says is still reported, with its state
    assert sm.timing_hints(maps, "lecture-01") == []  # and is not handed on as a current hint
    bank = build_question_bank(read_question_index(root, "be505"), inventory())
    (tie,) = sm.section_ties(maps, bank)["BE505-L01-Q01"]
    assert tie["deck_state"] == "stale"


def test_an_inputs_row_without_a_readable_hash_verifies_nothing(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", ""), (transcript["filename"], "x.txt", "pending")), table(PLAIN, row("2-3", "1-4")))
    result = sm.read_study_maps(root, inv)
    record = result["lectures"]["lecture-01"]
    assert codes(result) == [("inputs_hash_missing", "lecture-01-source-map.md")] * 2
    assert (record["deck"]["basis"], record["deck"]["bytes_verified"], record["deck"]["state"]) == ("unit_displayed_deck", False, "current")
    assert (record["transcript"]["basis"], record["transcript"]["bytes_verified"], record["transcript"]["state"]) == ("unit_transcript", False, "current")


def test_rows_bind_to_the_unit_file_that_has_the_listed_bytes_even_when_another_file_is_displayed(root, inventory):
    folder = root / "materials/lectures/lecture-03"
    shutil.copy(next((root / "materials/lectures/lecture-01").glob("*.pdf")), folder / "Another reading.pdf")
    inv = inventory()
    lecture = unit(inv, "lecture-03")
    assert lecture["deck_choice"]["state"] == "unresolved"  # two equal candidates: the unit has no displayed deck
    other = next(d for d in lecture["decks"] if d["filename"] == "Another reading.pdf")
    write_map(root, 3, table(PLAIN, row("1-2", "1-4")))
    plain = sm.read_study_maps(root, inv)["lectures"]["lecture-03"]
    assert (plain["deck"]["source_id"], plain["deck"]["state"], plain["deck"]["reason"]) == (None, "unresolved", "no_displayed_deck")
    assert (plain["transcript"]["source_id"], plain["transcript"]["state"], plain["transcript"]["reason"]) == (None, "unresolved", "no_transcript_linked_to_unit")
    write_map(root, 3, inputs_table(("Another reading.pdf", "x.pdf", sha(folder / "Another reading.pdf"))), table(PLAIN, row("1-2", "1-4")))
    maps = sm.read_study_maps(root, inv)
    bound = maps["lectures"]["lecture-03"]["deck"]
    assert (bound["source_id"], bound["state"], bound["bytes_verified"], bound["on_displayed_deck"]) == (other["source_id"], "current", True, False)
    assert sm.timing_hints(maps, "lecture-03") == []  # no transcript is tied to this unit, so no line range can be handed on
    # one listed file is in the unit, another is not: which of the two the page numbers count is not known, so nothing is bound
    write_map(root, 3, inputs_table(("Earlier deck.pdf", "x.pdf", "cd" * 32), ("Another reading.pdf", "y.pdf", sha(folder / "Another reading.pdf"))), table(PLAIN, row("1-2", "1-4")))
    doubtful = sm.read_study_maps(root, inv)["lectures"]["lecture-03"]["deck"]
    assert (doubtful["source_id"], doubtful["state"], doubtful["bytes_verified"]) == (None, "unresolved", False)


def test_a_listed_file_that_is_not_a_slide_deck_never_stands_in_for_the_deck(root, inventory):
    inv = inventory()
    lecture = unit(inv, "lecture-04")
    deck = primary_deck(lecture)
    sheet = next(d for d in lecture["decks"] if d["source_id"] != deck["source_id"])
    listed_sheet = (sheet["filename"], "y.pdf", sha(root / sheet["path"]))

    def bound(*entries: tuple[str, str, str]) -> tuple:
        write_map(root, 4, inputs_table(*entries), table(PLAIN, row("1", "1-4")))
        maps = sm.read_study_maps(root, inv)
        assert sm.timing_hints(maps, "lecture-04") == []
        record = maps["lectures"]["lecture-04"]["deck"]
        return record["source_id"], record["state"], record["bytes_verified"], record["reason"]

    # only the question sheet is listed, with the bytes it has: the note states no hash of the deck, so nothing says the deck changed
    assert bound(listed_sheet) == (None, "unresolved", False, "no_listed_hash_names_displayed_deck")
    # nor when the map was made from an earlier deck kept under another name (bytes no longer in the unit)
    assert bound(("Earlier deck.pdf", "x.pdf", "cd" * 32), listed_sheet) == (None, "unresolved", False, "no_listed_hash_names_displayed_deck")
    # the note names the displayed deck itself with other bytes than it has now: that, and only that, is a stale map
    assert bound((deck["filename"], "x.pdf", "cd" * 32), listed_sheet) == (deck["source_id"], "stale", False, "unit_deck_bytes_differ")
    assert bound(("Slides", "../../" + deck["path"].replace(" ", "%20") + "#page=2", "cd" * 32)) == (deck["source_id"], "stale", False, "unit_deck_bytes_differ")


def test_rows_are_not_bound_to_another_file_of_the_unit_while_a_listed_pdf_has_no_hash(root, inventory):
    sibling = root / "materials/lectures/lecture-01/Synthetic sibling.pdf"
    sibling.write_bytes(b"%PDF-1.4\n% synthetic sibling of the deck\n")
    inv = inventory()
    lecture = unit(inv, "lecture-01")
    deck = primary_deck(lecture)
    other = next(d for d in lecture["decks"] if d["filename"] == sibling.name)
    assert deck is not None and deck["source_id"] != other["source_id"]
    # every listed PDF has a hash and all of them are files of this unit: the page numbers count that file
    write_map(root, 1, inputs_table((sibling.name, "y.pdf", sha(sibling))), table(PLAIN, row("2-3", "1-4")))
    bound = sm.read_study_maps(root, inv)["lectures"]["lecture-01"]["deck"]
    assert (bound["source_id"], bound["state"], bound["bytes_verified"], bound["on_displayed_deck"]) == (other["source_id"], "current", True, False)
    # the displayed deck is listed too, without a hash: which of the two the page numbers count is not known
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", "pending"), (sibling.name, "y.pdf", sha(sibling))), table(PLAIN, row("2-3", "1-4")))
    maps = sm.read_study_maps(root, inv)
    doubtful = maps["lectures"]["lecture-01"]["deck"]
    assert (doubtful["source_id"], doubtful["state"], doubtful["bytes_verified"], doubtful["reason"]) == (None, "unresolved", False, "no_listed_hash_names_displayed_deck")
    assert codes(maps) == [("inputs_hash_missing", "lecture-01-source-map.md")] and sm.timing_hints(maps, "lecture-01") == []


def test_a_deck_or_transcript_that_cannot_be_read_is_its_own_reason_not_a_changed_file(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", sha(root / deck["path"])), (transcript["filename"], "x.txt", sha(root / transcript["path"]))),
              table(PLAIN, row("2-3", "1-4")))
    (root / deck["path"]).unlink()  # both go after the inventory was built
    (root / transcript["path"]).unlink()
    maps = sm.read_study_maps(root, inv)
    record = maps["lectures"]["lecture-01"]
    assert (record["deck"]["source_id"], record["deck"]["state"], record["deck"]["reason"], record["deck"]["sha256"]) == (None, "unresolved", "displayed_deck_unreadable", None)
    assert (record["transcript"]["source_id"], record["transcript"]["state"], record["transcript"]["reason"]) == (None, "unresolved", "unit_transcript_unreadable")
    assert codes(maps) == [("unit_file_not_hashed", "lecture-01-source-map.md")] * 2
    assert sorted(p["detail"].split(":")[0] for p in maps["problems"]) == sorted([deck["source_id"], transcript["source_id"]])
    assert sm.timing_hints(maps, "lecture-01") == []


def test_an_inventory_that_says_the_file_is_not_readable_binds_nothing_even_without_a_listed_hash(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    (root / deck["path"]).write_bytes(b"")
    (root / transcript["path"]).write_bytes(b"")
    write_map(root, 1, table(PLAIN, row("2-3", "1-4")))
    maps = sm.read_study_maps(root, inventory())
    record = maps["lectures"]["lecture-01"]
    assert (record["deck"]["source_id"], record["deck"]["state"], record["deck"]["reason"]) == (None, "unresolved", "displayed_deck_unreadable")
    assert (record["transcript"]["source_id"], record["transcript"]["state"], record["transcript"]["reason"]) == (None, "unresolved", "unit_transcript_unreadable")
    assert maps["problems"] == [] and sm.timing_hints(maps, "lecture-01") == []


def _raises(path: Path) -> str:
    raise KeyError(path.name)  # not an OSError: whatever a caller's cache may throw


@pytest.mark.parametrize("failing", [_raises, lambda path: None, lambda path: "not a digest"], ids=["raises", "returns_none", "returns_other_text"])
def test_a_hash_function_that_fails_in_any_way_verifies_nothing_and_is_reported(root, inventory, failing):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", sha(root / deck["path"])), (transcript["filename"], "x.txt", sha(root / transcript["path"]))),
              table(PLAIN, row("2-3", "1-4")))
    maps = sm.read_study_maps(root, inv, sha_of=failing)
    record = maps["lectures"]["lecture-01"]
    assert (record["deck"]["state"], record["deck"]["reason"], record["deck"]["bytes_verified"]) == ("unresolved", "displayed_deck_unreadable", False)
    assert (record["transcript"]["state"], record["transcript"]["reason"], record["transcript"]["bytes_verified"]) == ("unresolved", "unit_transcript_unreadable", False)
    assert codes(maps) == [("unit_file_not_hashed", "lecture-01-source-map.md")] * 2
    assert [r["pages"] for r in record["rows"]] == [[2, 3]] and sm.timing_hints(maps, "lecture-01") == []


def test_a_listed_transcript_hash_is_stale_only_when_the_note_names_the_units_transcript(root, inventory):
    inv = inventory()
    transcript = transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table(("Synthetic numbered copy.txt", "cache/numbered.txt", "cd" * 32)), table(PLAIN, row("2-3", "1-4")))
    record = sm.read_study_maps(root, inv)["lectures"]["lecture-01"]["transcript"]
    assert (record["source_id"], record["state"], record["reason"]) == (None, "unresolved", "no_listed_hash_names_unit_transcript")
    write_map(root, 1, inputs_table((transcript["filename"], "x.txt", "cd" * 32)), table(PLAIN, row("2-3", "1-4")))
    record = sm.read_study_maps(root, inv)["lectures"]["lecture-01"]["transcript"]
    assert (record["source_id"], record["state"], record["reason"], record["sha256"]) == (transcript["source_id"], "stale", "unit_transcript_bytes_differ", sha(root / transcript["path"]))


@pytest.mark.parametrize("changed", ["deck", "transcript"])
def test_one_stale_binding_gives_no_hints_and_its_rows_are_not_bounded_by_the_changed_files_count(root, inventory, changed):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", sha(root / deck["path"])), (transcript["filename"], "x.txt", sha(root / transcript["path"]))),
              table(PLAIN, row("2-3", "1-4")))
    with (root / (deck if changed == "deck" else transcript)["path"]).open("ab") as handle:
        handle.write(b"\nsynthetic later edit\n")
    counts = {"page_counts": {deck["source_id"]: 1}} if changed == "deck" else {"line_counts": {transcript["source_id"]: 1}}
    maps = sm.read_study_maps(root, inventory(), **counts)
    record = maps["lectures"]["lecture-01"]
    assert (record["deck"]["state"], record["transcript"]["state"]) == (("stale", "current") if changed == "deck" else ("current", "stale"))
    assert sm.timing_hints(maps, "lecture-01") == []  # one of the two files is no longer the one the rows were written about
    # a count taken from the file as it is now does not bound rows that were written about other bytes
    assert [r["pages"] for r in record["rows"]] == [[2, 3]] and record["skipped"] == []


def test_a_link_in_the_inputs_table_is_never_followed(root, inventory, tmp_path, opened):
    outside = tmp_path / "outside" / "Synthetic outside deck.pdf"
    outside.parent.mkdir()
    outside.write_bytes(b"%PDF-1.4 synthetic bytes kept outside the course\n")
    inv = inventory()
    deck = primary_deck(unit(inv, "lecture-01"))
    escape = "../" * (len(Path("work/lecture-review").parts) + len(root.relative_to(tmp_path).parts)) + "outside/Synthetic%20outside%20deck.pdf"
    assert (root / "work" / "lecture-review" / escape.replace("%20", " ")).resolve() == outside.resolve()
    write_map(root, 1, inputs_table(("Synthetic outside deck.pdf", escape, sha(outside)), ("Second copy.pdf", outside.as_posix(), sha(outside))), table(PLAIN, row("2-3", "1-4")))
    opened.clear()
    record = sm.read_study_maps(root, inv)["lectures"]["lecture-01"]
    # the hash is compared with the unit's own file; the path the note links to is text. Neither row names the unit's deck,
    # so the note says nothing about it: unresolved, not stale.
    assert (record["deck"]["source_id"], record["deck"]["state"], record["deck"]["reason"]) == (None, "unresolved", "no_listed_hash_names_displayed_deck")
    assert outside.resolve() not in opened and (root / deck["path"]).resolve() in opened


def test_two_transcripts_in_the_unit_are_not_chosen_between_without_a_hash(root, inventory):
    first = transcript_of(inventory(), "lecture-01")
    second = (root / first["path"]).with_name("Synthetic second take.txt")
    second.write_text("Synthetic other wording.\n", encoding="utf-8")
    write_map(root, 1, table(PLAIN, row("2-3", "1-4")))
    inv = inventory()
    maps = sm.read_study_maps(root, inv)
    record = maps["lectures"]["lecture-01"]["transcript"]
    assert (record["source_id"], record["state"], record["reason"]) == (None, "unresolved", "transcript_not_unique")
    assert sm.timing_hints(maps, "lecture-01") == []  # line numbers of which file? nothing is handed on
    write_map(root, 1, inputs_table(("Synthetic second take.txt", "x.txt", sha(second))), table(PLAIN, row("2-3", "1-4")))
    bound = sm.read_study_maps(root, inv)["lectures"]["lecture-01"]["transcript"]
    other = next(i for s in unit(inv, "lecture-01")["sessions"] for i in s["items"] if i["filename"] == second.name)
    assert (bound["source_id"], bound["state"], bound["bytes_verified"]) == (other["source_id"], "current", True)


def test_a_caller_can_supply_cached_hashes_and_a_known_line_count(root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", sha(root / deck["path"])), (transcript["filename"], "x.txt", sha(root / transcript["path"]))),
              table(PLAIN, row("2-3", "1-4"), row("3", "5-999")))
    hashed: list[str] = []

    def cached(path: Path) -> str:
        hashed.append(path.name)
        return sha(path).upper()  # however the caller's cache spells a digest

    record = sm.read_study_maps(root, inv, sha_of=cached, line_counts={transcript["source_id"]: 50})["lectures"]["lecture-01"]
    assert sorted(hashed) == sorted([deck["filename"], transcript["filename"]])  # only the unit's own files, each once
    assert record["deck"]["bytes_verified"] and record["transcript"]["bytes_verified"] and record["deck"]["sha256"] == sha(root / deck["path"])
    assert [r["row"] for r in record["rows"]] == [1] and [(s["row"], s["reason"]) for s in record["skipped"]] == [(2, "line_beyond_transcript")]


def test_a_known_page_count_of_the_bound_deck_bounds_the_rows(root, inventory):
    write_map(root, 1, table(PLAIN, row("2-3", "1-4"), row("3-8", "5-6")))
    inv = inventory()
    deck = primary_deck(unit(inv, "lecture-01"))
    record = sm.read_study_maps(root, inv, page_counts={deck["source_id"]: 4, "some-other-source": 1})["lectures"]["lecture-01"]
    assert [r["row"] for r in record["rows"]] == [1] and [(s["row"], s["reason"]) for s in record["skipped"]] == [(2, "page_beyond_deck")]


# ---- handing the rows on ------------------------------------------------------------------------------
def test_question_numbers_resolve_through_the_collections_of_the_lecture_or_are_reported(root, inventory):
    write_map(root, 1, table(PLAIN, row("2", "1-4", "Q1 all; synthetic part of Q4", "Synthetic topic one"), row("3-4", "5-8", "Q4, Q7", "Synthetic topic two")))
    write_map(root, 3, table(PLAIN, row("1", "1-2")))
    write_map(root, 4, table(PLAIN, row("1, 3", "1-4", "Q1; Q2 all")))
    inv = inventory()
    bank = build_question_bank(read_question_index(root, "be505"), inv)
    assert bank["lectures"]["lecture-04"]["collections"] == ["L04", "L04-class"]  # the fixture's own two collections with a question 1 each
    maps = sm.read_study_maps(root, inv)
    ties = sm.section_ties(maps, bank)
    assert sorted(ties) == ["BE505-L01-Q01", "BE505-L01-Q04", "BE505-L04-Q02"]
    deck = primary_deck(unit(inv, "lecture-01"))
    digest = maps["lectures"]["lecture-01"]["source"]["sha256"]
    assert ties["BE505-L01-Q01"] == [{"lecture_id": "lecture-01", "source_id": deck["source_id"], "pages": [2], "page_ranges": [[2, 2]], "transcript_ranges": [[1, 4]], "row": 1,
                                      "label": "Synthetic topic one", "scope": "all", "map_sha256": digest, "deck_state": "current", "on_displayed_deck": True,
                                      "deck_bytes_verified": False, "as_written": "Q1 all", "number_basis": "companion_question_map"}]  # the fixture keeps one for lecture 1
    assert [(t["row"], t["scope"], t["pages"]) for t in ties["BE505-L01-Q04"]] == [(1, "part", [2]), (2, None, [3, 4])]
    assert [(t["lecture_id"], t["pages"], t["scope"], t["number_basis"]) for t in ties["BE505-L04-Q02"]] == [("lecture-04", [1, 3], "all", "lecture_collections")]
    report = sm.resolve_section_ties(maps, bank)
    assert report["ties"] == ties
    assert report["unresolved"] == [
        {"lecture_id": "lecture-01", "row": 2, "number": 7, "reason": "no_question_with_number", "candidates": []},
        {"lecture_id": "lecture-03", "row": 1, "number": 1, "reason": "no_collection_for_lecture", "candidates": []},
        {"lecture_id": "lecture-04", "row": 1, "number": 1, "reason": "several_questions_with_number", "candidates": ["BE505-L04-CLASS-Q01", "BE505-L04-Q01"]}]
    assert report["counts"] == {"asked": 7, "resolved": 4, "unresolved": 3, "questions": 3}


def write_question_map(root: Path, number: int, entries: list[dict], *, version: int = 1) -> Path:
    path = root / "work/lecture-review" / f"lecture-{number:02d}-question-map-v{version}.json"
    path.write_text(json.dumps({"version": version, "questions": entries, "strict_containment": []}), encoding="utf-8")
    return path


def entry(question_id: str, key: str = "id") -> dict:
    return {key: question_id, "title": "Synthetic title", "answer": "Synthetic restricted guidance that the reader must not carry."}


def numbers(report: dict) -> list[tuple]:
    return [(u["number"], u["reason"], u["candidates"]) for u in report["unresolved"]]


def test_the_lectures_own_question_map_settles_a_number_that_two_collections_share(root, inventory, opened):
    write_map(root, 4, table(PLAIN, row("1, 3", "1-4", "Q1; Q2 all")))
    inv = inventory()
    bank = build_question_bank(read_question_index(root, "be505"), inv)
    plain = sm.read_study_maps(root, inv)
    assert plain["lectures"]["lecture-04"]["question_map"] is None
    assert numbers(sm.resolve_section_ties(plain, bank)) == [(1, "several_questions_with_number", ["BE505-L04-CLASS-Q01", "BE505-L04-Q01"])]  # no companion: reported, not guessed
    companion = write_question_map(root, 4, [entry("BE505-L04-Q01"), entry("BE505-L04-Q02", key="question_id")])
    opened.clear()
    maps = sm.read_study_maps(root, inv)
    assert maps["problems"] == []
    # ids and the file's identity only: no wording or guidance of the companion file is carried
    assert maps["lectures"]["lecture-04"]["question_map"] == {
        "files": [{"path": "work/lecture-review/lecture-04-question-map-v1.json", "sha256": sha(companion), "bytes": companion.stat().st_size, "questions": 2}],
        "question_ids": ["BE505-L04-Q01", "BE505-L04-Q02"]}
    assert "restricted guidance" not in json.dumps(maps)
    # a companion file is read only for a lecture whose study map is read
    assert companion.resolve() in opened and (root / "work/lecture-review/lecture-01-question-map-v1.json").resolve() not in opened
    report = sm.resolve_section_ties(maps, bank)
    assert report["unresolved"] == [] and report["counts"] == {"asked": 2, "resolved": 2, "unresolved": 0, "questions": 2}
    assert {q: [(t["scope"], t["number_basis"]) for t in ties] for q, ties in report["ties"].items()} == {
        "BE505-L04-Q01": [(None, "companion_question_map")], "BE505-L04-Q02": [("all", "companion_question_map")]}


def test_a_question_map_only_narrows_and_a_number_it_does_not_list_is_reported(root, inventory):
    write_map(root, 4, table(PLAIN, row("1, 3", "1-4", "Q1; Q2 all; Q9")))
    inv = inventory()
    bank = build_question_bank(read_question_index(root, "be505"), inv)

    def resolved(*entries: dict) -> tuple[list[str], list[tuple]]:
        write_question_map(root, 4, list(entries))
        report = sm.resolve_section_ties(sm.read_study_maps(root, inv), bank)
        return sorted(report["ties"]), numbers(report)

    # the companion lists both questions numbered 1: it settles nothing, and the number stays reported
    assert resolved(entry("BE505-L04-Q01"), entry("BE505-L04-CLASS-Q01"), entry("BE505-L04-Q02")) == (
        ["BE505-L04-Q02"], [(1, "several_questions_with_number", ["BE505-L04-CLASS-Q01", "BE505-L04-Q01"]), (9, "no_question_with_number", [])])
    # the lecture's one question 2 is not among the companion's ids: the note is not about it
    assert resolved(entry("BE505-L04-CLASS-Q01")) == (
        ["BE505-L04-CLASS-Q01"], [(2, "not_in_question_map", ["BE505-L04-Q02"]), (9, "no_question_with_number", [])])
    # an id of another lecture, or one the catalog does not have, adds no question to this lecture
    assert resolved(entry("BE505-L01-Q01"), entry("BE505-L04-Q99"), entry("BE505-L04-Q02")) == (
        ["BE505-L04-Q02"], [(1, "not_in_question_map", ["BE505-L04-CLASS-Q01", "BE505-L04-Q01"]), (9, "no_question_with_number", [])])
    # an entry that names two different ids names neither
    assert resolved({"id": "BE505-L04-Q01", "question_id": "BE505-L04-CLASS-Q01"}, entry("BE505-L04-Q02")) == (
        ["BE505-L04-Q02"], [(1, "not_in_question_map", ["BE505-L04-CLASS-Q01", "BE505-L04-Q01"]), (9, "no_question_with_number", [])])


def test_every_version_of_the_companion_map_is_read_and_one_that_cannot_be_read_is_reported(root, inventory):
    write_map(root, 4, table(PLAIN, row("1, 3", "1-4", "Q1; Q2 all")))
    inv = inventory()
    bank = build_question_bank(read_question_index(root, "be505"), inv)
    first = write_question_map(root, 4, [entry("BE505-L04-Q01")])
    second = write_question_map(root, 4, [entry("BE505-L04-Q02")], version=2)
    (root / "work/lecture-review/lecture-04-question-map-v3.json").write_text('{"version": 3, "questions": [{"id": "BE505-L04-CLASS-Q01"}', encoding="utf-8")  # cut off
    (root / "work/lecture-review/lecture-04-question-map-v4.json").write_text('{"version": 4, "questions": "none"}', encoding="utf-8")
    (root / "work/lecture-review/lecture-04-question-map-v5.json.bak").write_text(json.dumps({"questions": [entry("BE505-L04-CLASS-Q01")]}), encoding="utf-8")
    maps = sm.read_study_maps(root, inv)
    assert sorted((p["code"], p["file"], p["lecture_id"]) for p in maps["problems"]) == [
        ("invalid_record", "lecture-04-question-map-v3.json", "lecture-04"), ("question_map_unreadable", "lecture-04-question-map-v4.json", "lecture-04")]
    assert maps["lectures"]["lecture-04"]["question_map"] == {
        "files": [{"path": "work/lecture-review/lecture-04-question-map-v1.json", "sha256": sha(first), "bytes": first.stat().st_size, "questions": 1},
                  {"path": "work/lecture-review/lecture-04-question-map-v2.json", "sha256": sha(second), "bytes": second.stat().st_size, "questions": 1}],
        "question_ids": ["BE505-L04-Q01", "BE505-L04-Q02"]}
    assert sm.resolve_section_ties(maps, bank)["unresolved"] == []
    # with no readable companion the numbers are resolved as without one, and the unread file stays reported
    first.unlink()
    second.unlink()
    alone = sm.read_study_maps(root, inv)
    assert alone["lectures"]["lecture-04"]["question_map"] is None and len(alone["problems"]) == 2
    assert numbers(sm.resolve_section_ties(alone, bank)) == [(1, "several_questions_with_number", ["BE505-L04-CLASS-Q01", "BE505-L04-Q01"])]


def test_timing_hints_are_the_rows_of_a_currently_bound_map(root, inventory):
    write_map(root, 1, table(PLAIN, row("2-3", "1-4", "Q1 all", "Synthetic topic one"), row("not on a slide", "5-6"), row("4", "7-9, 12", "", "Synthetic topic two")))
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    maps = sm.read_study_maps(root, inv)
    digest = maps["lectures"]["lecture-01"]["source"]["sha256"]
    hints = sm.timing_hints(maps, "lecture-01")
    assert hints == [
        {"pages": [2, 3], "page_ranges": [[2, 3]], "transcript_ranges": [[1, 4]], "row": 1, "label": "Synthetic topic one", "origin": "course_study_map", "map_sha256": digest,
         "source_id": deck["source_id"], "transcript_source_id": transcript["source_id"], "bytes_verified": False},
        {"pages": [4], "page_ranges": [[4, 4]], "transcript_ranges": [[7, 9], [12, 12]], "row": 3, "label": "Synthetic topic two", "origin": "course_study_map", "map_sha256": digest,
         "source_id": deck["source_id"], "transcript_source_id": transcript["source_id"], "bytes_verified": False}]
    assert sm.timing_hints(maps, "lecture-02") == [] and sm.timing_hints(maps, "no-such-lecture") == []
    # a caller that aligns one particular deck and transcript names them and gets nothing made for other files
    assert sm.timing_hints(maps, "lecture-01", deck_source_id=deck["source_id"], transcript_source_id=transcript["source_id"]) == hints
    assert sm.timing_hints(maps, "lecture-01", deck_source_id="another-deck") == []
    assert sm.timing_hints(maps, "lecture-01", transcript_source_id="another-transcript") == []


def test_reading_and_resolving_write_nothing_anywhere(workspace, settings, root, inventory):
    inv = inventory()
    deck, transcript = primary_deck(unit(inv, "lecture-01")), transcript_of(inv, "lecture-01")
    write_map(root, 1, inputs_table((deck["filename"], "x.pdf", sha(root / deck["path"])), (transcript["filename"], "x.txt", sha(root / transcript["path"]))),
              table(PLAIN, row("2-3", "1-4", "Q1 all"), row("spoken", "5-6", "Q2")))
    write_map(root, 4, table(PLAIN, row("1, 3", "1-4", "Q1; Q2")))
    write_map(root, 9, table(PLAIN, row("1", "1-2")))
    before, state_before = tree(workspace), settings.state_dir.exists()
    maps = sm.read_study_maps(root, inventory(), page_counts={deck["source_id"]: 4})
    bank = build_question_bank(read_question_index(root, "be505"), inventory())
    assert sm.section_ties(maps, bank) and sm.resolve_section_ties(maps, bank)["unresolved"] and sm.timing_hints(maps, "lecture-01")
    assert tree(workspace) == before and settings.state_dir.exists() == state_before
    assert not list(workspace.rglob("__pycache__")) and not [p for p in workspace.rglob("*") if p.name.endswith((".tmp", ".lock", ".bak"))]
