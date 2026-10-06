"""Read the course's own per-lecture study maps (R2: "reviewed anchors first"; known transcript-line source maps).

Beside its question maps a course may keep one Markdown note per lecture, ``work/lecture-review/lecture-NN-source-map.md``,
whose table ties a piece of content to slide pages, transcript lines and question numbers. Those rows are the course's own
(coarse) statement of where a question sits and of which transcript lines go with which pages. This module reads them and
does nothing else: nothing is written, no helper of the course is run, and no link written in a note is followed.

What is taken, and what is not:

* **Files.** Only plain files named ``lecture-NN-source-map.md`` directly in the review folder, below a size bound. A file
  for a lecture the inventory does not have is reported and not read.
* **Statements.** A fenced code block and an HTML comment are not statements: a table or a hash written inside one is an
  example or a leftover. One that never closes hides the rest of the note, and that is reported.
* **Tables.** A table is a study map only when its header has exactly one column naming slide pages and exactly one naming
  transcript lines; a question column is optional. Other tables are left alone; a table that names one of the two, or one
  of them twice, is reported.
* **Rows.** A row is taken only when its pages cell and its transcript cell are, entirely, numbers and inclusive ranges
  (commas, hyphen or en dash). Anything else skips the row with a reason. Nothing is repaired, completed or clamped; a page
  list stays the list that was written; a line number is never a page.
* **Questions.** ``Q4``, ``Q1-Q3`` and lists of them. ``all`` after a number is scope ``all``; other words about a number
  are scope ``part``; no words, words that state only a count of criteria, and ``all`` followed by words this reader does
  not interpret ("all except …") leave the scope unstated (``None``). A reference written another way gives no question.
  A number is turned into a question id only among the questions the bank ties to the lecture, narrowed to the ids the
  lecture's own companion question map (``lecture-NN-question-map-vN.json``, ids only) lists when there is one.
* **Bytes.** The note may list its input files with SHA-256 hashes: in a table with a SHA256 column, or in a list item or
  a prose line that names a ``.pdf`` / ``.txt`` / ``.vtt`` / ``.srt`` file beside a 64-hex value. The rows are then bound
  to the unit's own file that has those bytes (``bytes_verified``). The binding is ``stale`` only when the note states a
  hash for the very file the unit shows (by its file name) and that file has other bytes now. When hashes are listed and
  none can be tied to the unit's file, or the file cannot be read or hashed, the binding is ``unresolved`` with its own
  reason. Rows are bound to another file of the unit than the displayed deck only when every listed PDF has a hash, every
  listed hash is a file of the unit and exactly one of them could be a deck. Without any listed hash the rows are bound
  to the unit's displayed deck and its one transcript, marked as not verified. A path or link in the note is text: the
  hash is compared with files the inventory already lists for that unit, and no other file is opened.

Row numbers count the data rows of the admitted tables of one file, in file order, skipped rows included, so a row keeps
its number whatever happens to its neighbours. Together with the file's sha256 a row number names one statement.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
import hashlib
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import unquote

from ..contracts import ContractError, resolve_inside, sha256_hex
from . import OwnerReadError, parse_owner_json, read_owner_bytes
from .inventory import _OPENABLE, _is_slide_candidate, primary_deck
from .question_links import _LIST, MAX_SPAN

MAPS_VERSION = "course-study-map/1"
ORIGIN = "course_study_map"
REVIEW_FOLDER = ("work", "lecture-review")
MAX_MAP_BYTES = 512 * 1024         # a study note; the real ones are a few kilobytes
MAX_TABLE_ROWS = 1000              # data rows read per file
MAX_PAGE = 5000                    # a "page" beyond this is another numbering, not a slide
MAX_LINE = 500_000
MAX_LINE_SPAN = 5000               # one row does not speak about more transcript lines than this
MAX_RANGES_PER_CELL = 64
MAX_QUESTION = 500
MAX_QUESTION_SPAN = 100
MAX_HASHED_BYTES = 2 * 1024 ** 3   # a unit file larger than this is not hashed, so it verifies nothing

_STUDY_MAP = re.compile(r"^lecture-(\d{2})-source-map\.md$")
_QUESTION_MAP = re.compile(r"^lecture-(\d{2})-question-map-v\d+\.json$")
_NUMBER_LIST = re.compile(_LIST)
_DASH = re.compile(r"\s*[-–]\s*")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_DELIMITER = re.compile(r"^:?-+:?$")
_UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")
_LINK = re.compile(r"\[([^\]]*)\]\(([^)]*)\)")
_SHA256 = re.compile(r"[0-9a-fA-F]{64}")
_SHA256_WRITTEN = re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{64}(?![0-9A-Za-z])")  # exactly 64 hex digits, not a piece of a longer run
_MENTION = re.compile(r"\[([^\]]*)\]\(([^)]*)\)|`([^`]+)`|([^\s`\[\]()<>\"']+)")       # a link, a code span, or a bare word
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s+")
_QUESTION = re.compile(r"(?<![A-Za-z0-9])Q(\d{1,4})(?:\s*[-–]\s*Q(\d{1,4}))?(?![A-Za-z0-9])")
_QUESTION_LIKE = re.compile(r"(?<![A-Za-z0-9])Q\s*\d")
_DANGLING_RANGE = re.compile(r"^\s*[-–]\s*\d")
_CONNECTOR = re.compile(r"(?i)^\s*(?:and|or|plus|&|\+|/)?\s*$")
_LEADING_CONNECTOR = re.compile(r"(?i)^\s*(?:(?:and|or|plus|also)\b|&|\+)\s*")
_ALL = re.compile(r"(?i)^all(?:\s+(?:of\s+)?(?:the\s+|its\s+)?(?:\d+\s+)?criteri(?:a|on))?(?![A-Za-z0-9])")
_CRITERIA_COUNT = re.compile(r"(?i)^\d+\s+criteri(?:a|on)$")
_TRANSCRIPT_SUFFIXES = {".txt", ".vtt", ".srt"}


# ---- tables ------------------------------------------------------------------------------------------
def _cells(line: str) -> list[str] | None:
    """The cells of one pipe-table line (it must start with ``|``); ``\\|`` is a literal bar inside a cell."""
    body = line.strip()
    if not body.startswith("|") or line.startswith(("    ", "\t")):  # four spaces or a tab: an indented code block
        return None
    body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    return [part.replace("\\|", "|").strip() for part in _UNESCAPED_PIPE.split(body)]


def _statement_lines(text: str) -> tuple[list[str], list[dict]]:
    """The lines of a note with everything that is not a statement blanked: fenced code blocks and HTML comments.

    Line numbers are kept. A fence closes only on a line of the same character, at least as long, with nothing after it;
    a comment closes at ``-->``. One that never closes hides the rest of the note, and that is reported.
    """
    kept: list[str] = []
    problems: list[dict] = []
    fence: tuple[str, int, int] | None = None   # character, length, line where it opened
    comment: int | None = None                  # line where it opened
    for number, line in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), start=1):
        marker = _FENCE.match(line) if comment is None else None
        if fence is not None:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= fence[1] and not marker.group(2).strip():
                fence = None
            kept.append("")
            continue
        if marker and not (marker.group(1)[0] == "`" and "`" in marker.group(2)):  # "```a```" on one line is a code span
            fence = (marker.group(1)[0], len(marker.group(1)), number)
            kept.append("")
            continue
        shown, rest = "", line
        while True:
            if comment is not None:
                end = rest.find("-->")
                if end < 0:
                    rest = ""
                    break
                rest, comment = rest[end + 3:], None
            start = rest.find("<!--")
            if start < 0:
                break
            shown, rest, comment = shown + rest[:start], rest[start + 4:], number
        kept.append(shown + rest)
    if fence is not None:
        problems.append({"code": "code_block_not_closed", "line": fence[2], "detail": "a fenced code block opens here and never closes; nothing after it is read"})
    if comment is not None:
        problems.append({"code": "comment_not_closed", "line": comment, "detail": "a comment opens here and never closes; nothing after it is read"})
    return kept, problems


def _tables(lines: list[str]) -> tuple[list[dict], set[int]]:
    """Every pipe table of the statement lines, ``{line, header, rows: [(line, cells)]}`` with 1-based file lines, and the
    (0-based) indexes of the lines those tables occupy."""
    found: list[dict] = []
    inside: set[int] = set()
    i = 0
    while i < len(lines):
        header = _cells(lines[i])
        delimiter = _cells(lines[i + 1]) if header is not None and i + 1 < len(lines) else None
        if header and delimiter and len(delimiter) == len(header) and all(_DELIMITER.match(cell) for cell in delimiter):
            rows: list[tuple[int, list[str]]] = []
            j = i + 2
            while j < len(lines) and (cells := _cells(lines[j])) is not None:
                rows.append((j + 1, cells))
                j += 1
            found.append({"line": i + 1, "header": header, "rows": rows})
            inside.update(range(i, j))
            i = j
            continue
        i += 1
    return found, inside


def _column_kind(header: str) -> str | None:
    """What a column says it holds, from its heading alone: sha256, pages, transcript, both (ambiguous), questions, label."""
    words = set(re.findall(r"[a-z0-9]+", header.lower()))
    if "sha256" in words or {"sha", "256"} <= words:
        return "sha256"
    slides = bool(words & {"slide", "slides"}) or ("pdf" in words and bool(words & {"page", "pages"}))
    transcript = "transcript" in words and bool(words & {"line", "lines"})
    if slides and transcript:
        return "both"
    if slides:
        return "pages"
    if transcript:
        return "transcript"
    if words & {"diagnostic", "diagnostics", "question", "questions"}:
        return "questions"
    if words & {"content", "contents", "concept", "concepts", "topic", "topics"}:
        return "label"
    return None


def _number_ranges(cell: str, *, top: int, span: int) -> tuple[list[list[int]] | None, str | None]:
    """``"12, 17-21"`` → ``[[12, 12], [17, 21]]``; otherwise ``(None, why)``. The whole cell must be the list."""
    text = cell.strip()
    if not text:
        return None, "cell_empty"
    if not _NUMBER_LIST.fullmatch(text):
        return None, "cell_not_numeric"
    parts = text.split(",")
    if len(parts) > MAX_RANGES_PER_CELL:
        return None, "range_invalid"
    ranges: list[list[int]] = []
    for part in parts:
        numbers = _DASH.split(part.strip())
        if any(len(number) > 7 for number in numbers):
            return None, "range_invalid"
        start, end = int(numbers[0]), int(numbers[-1])
        if start < 1 or end < start or end > top or end - start > span:
            return None, "range_invalid"
        ranges.append([start, end])
    return ranges, None


def _question_clause(clause: str) -> tuple[list[dict], bool]:
    """The questions one clause names and whether it holds a reference this reader could not read."""
    found = list(_QUESTION.finditer(clause))
    if not found:
        return [], bool(_QUESTION_LIKE.search(clause))
    between = [clause[a.end():b.start()] for a, b in zip(found, found[1:])]
    lead, tail = clause[:found[0].start()], clause[found[-1].end():]
    if any(_DANGLING_RANGE.match(text) for text in [*between, tail]):
        return [], True  # "Q1-3": a range written another way is not guessed at
    numbers: list[int] = []
    for match in found:
        start, end = int(match.group(1)), int(match.group(2) or match.group(1))
        if start < 1 or end < start or end > MAX_QUESTION or end - start > MAX_QUESTION_SPAN:
            return [], True
        numbers.extend(range(start, end + 1))
    lead_words = _LEADING_CONNECTOR.sub("", lead).strip()
    tail_words = tail.strip().lstrip(":").strip().rstrip(".").strip()
    if tail_words.startswith("(") and tail_words.endswith(")") and "(" not in tail_words[1:]:
        tail_words = tail_words[1:-1].strip()
    plain = not lead_words and all(_CONNECTOR.match(text) for text in between)
    stated_all = _ALL.match(tail_words) if plain else None
    if plain and (not tail_words or _CRITERIA_COUNT.match(tail_words)):
        scope = None      # nothing said, or only how many criteria: neither "all" nor "part of"
    elif stated_all:
        scope = "all" if stated_all.end() == len(tail_words) else None  # "all except …" is not read as "all"
    else:
        scope = "part"
    return [{"number": number, "scope": scope, "as_written": clause.strip()} for number in numbers], False


def _questions(cell: str) -> tuple[list[dict], list[str]]:
    questions: list[dict] = []
    unparsed: list[str] = []
    seen: set[int] = set()
    for statement in cell.split(";"):
        before: list[dict] = []
        for clause in statement.split(","):
            named, doubtful = _question_clause(clause)
            if doubtful:
                unparsed.append(clause.strip())
            elif not named and clause.strip():
                for question in before:  # "Q1 all, except …": words follow that this reader does not interpret
                    question["scope"] = None if question["scope"] == "all" else question["scope"]
                    question["as_written"] = f"{question['as_written']}, {clause.strip()}"
            if named:
                before = [question for question in named if question["number"] not in seen]  # the first statement about a number is the one kept
                seen.update(question["number"] for question in before)
                questions.extend(before)
    return questions, unparsed


def _link_path(target: str | None) -> str:
    """The path a link target names, as text. A target is never opened."""
    return unquote(target).split("#")[0].split("?")[0] if target else ""


def _file_kind(name: str, target: str | None = None) -> str:
    """pdf | transcript | other, from the suffix of the name as written, else of the link target."""
    for text in (name, _link_path(target)):
        suffix = PurePosixPath(text.replace("\\", "/")).suffix.lower()
        if suffix == ".pdf" or suffix in _TRANSCRIPT_SUFFIXES:
            return "pdf" if suffix == ".pdf" else "transcript"
    return "other"


def _input_entry(cell: str, digest_cell: str, line: int) -> dict:
    link = _LINK.search(cell)
    name = (link.group(1) if link else cell).strip().strip("`*_").strip()
    target = link.group(2).strip() if link else None
    digest = digest_cell.strip().strip("`").strip()
    return {"name": name, "target": target, "sha256": digest.lower() if _SHA256.fullmatch(digest) else None, "line": line, "kind": _file_kind(name, target),
            "stated_in": "table"}


def _line_inputs(text: str, line: int) -> tuple[list[dict], bool]:
    """Hashes a list item or a prose line states for files it names, and whether one of them could not be given a file.

    A 64-hex value goes with the PDF or transcript file named before it on the line (after the previous hash); when none
    is named there, with the one named after it. A line that names no such file states no input. When the files named
    there are of both kinds, which one the hash is of is not guessed.
    """
    hashes = list(_SHA256_WRITTEN.finditer(text))
    if not hashes:
        return [], False
    mentions: list[tuple[int, int, str, str | None, str]] = []
    for found in _MENTION.finditer(text):
        label, target, code, word = found.groups()
        name = (label.strip().strip("`*_").strip() if label is not None else code.strip() if code is not None else word.strip(".,;:!?*_"))
        target = target.strip() if label is not None else None
        kind = _file_kind(name, target)
        if kind != "other":
            mentions.append((found.start(), found.end(), name, target, kind))
    if not mentions:
        return [], False
    entries: list[dict] = []
    doubtful = False
    stated_in = "list_item" if _LIST_ITEM.match(text) else "line"
    taken = 0  # end of the text already given to an earlier hash
    for index, digest in enumerate(hashes):
        ceiling = hashes[index + 1].start() if index + 1 < len(hashes) else len(text)
        before = [m for m in mentions if taken <= m[0] and m[1] <= digest.start()]
        after = [m for m in mentions if digest.end() <= m[0] and m[1] <= ceiling]
        group, chosen = (before, before[-1]) if before else (after, after[0]) if after else ([], None)
        taken = digest.end() if before or not after else ceiling
        if chosen is None:
            continue
        if len({m[4] for m in group}) != 1:
            doubtful = True
            continue
        entries.append({"name": chosen[2], "target": chosen[3], "sha256": digest.group(0).lower(), "line": line, "kind": chosen[4], "stated_in": stated_in})
    return entries, doubtful


def _parse(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {"rows": [], "skipped": [], "inputs": [], "tables": [], "problems": []}
    number = 0

    def problem(code: str, line: int, detail: str) -> None:
        out["problems"].append({"code": code, "line": line, "detail": detail})

    lines, unclosed = _statement_lines(text)
    tables, in_table = _tables(lines)
    for index, line in enumerate(lines):
        if index not in in_table and line:
            entries, doubtful = _line_inputs(line, index + 1)
            out["inputs"].extend(entries)
            if doubtful:
                problem("listed_hash_not_attributed", index + 1, "the line names both a PDF and a transcript file beside one SHA-256; the hash was given to neither")
    for found in tables:
        header, width = found["header"], len(found["header"])
        kinds = [_column_kind(cell) for cell in header]
        if "sha256" in kinds:
            if kinds.count("sha256") != 1 or width < 2:
                problem("inputs_table_not_admitted", found["line"], "the table does not have exactly one SHA256 column beside a name column")
                continue
            digest_at = kinds.index("sha256")
            named = [i for i, cell in enumerate(header) if i != digest_at and set(re.findall(r"[a-z]+", cell.lower())) & {"input", "inputs", "file", "files", "source", "sources"}]
            name_at = named[0] if named else next(i for i in range(width) if i != digest_at)
            listed = 0
            for line, cells in found["rows"]:
                if len(cells) != width:
                    problem("inputs_row_unreadable", line, "the row does not have one cell per column")
                    continue
                entry = _input_entry(cells[name_at], cells[digest_at], line)
                out["inputs"].append(entry)
                listed += 1
                if entry["sha256"] is None and entry["kind"] != "other":
                    problem("inputs_hash_missing", line, f"no SHA-256 is written for the listed {entry['kind']} file")
            out["tables"].append({"line": found["line"], "kind": "inputs", "columns": {"name": header[name_at], "sha256": header[digest_at]}, "data_rows": listed})
            continue
        pages_at = [i for i, kind in enumerate(kinds) if kind in ("pages", "both")]
        lines_at = [i for i, kind in enumerate(kinds) if kind in ("transcript", "both")]
        if not pages_at and not lines_at:
            continue  # some other table of the note
        refusal = ("one column names both slide pages and transcript lines" if "both" in kinds else "no column names slide pages" if not pages_at
                   else "no column names transcript lines" if not lines_at else "several columns name slide pages" if len(pages_at) > 1
                   else "several columns name transcript lines" if len(lines_at) > 1 else None)
        if refusal:
            problem("table_not_admitted", found["line"], refusal)
            continue
        pages_col, lines_col = pages_at[0], lines_at[0]
        question_cols = [i for i, kind in enumerate(kinds) if kind == "questions"]
        question_col = question_cols[0] if len(question_cols) == 1 else None
        if len(question_cols) > 1:
            problem("ambiguous_question_column", found["line"], "several columns name questions; none is read as the question column")
        label_cols = [i for i, kind in enumerate(kinds) if kind == "label"]
        rest = [i for i in range(width) if i not in (pages_col, lines_col, question_col) and i not in question_cols]
        label_col = label_cols[0] if len(label_cols) == 1 else (rest[0] if rest else None)
        taken = 0
        for line, cells in found["rows"]:
            if number >= MAX_TABLE_ROWS:
                problem("too_many_rows", line, f"only the first {MAX_TABLE_ROWS} data rows of a file are read")
                break
            number += 1
            taken += 1
            if len(cells) != width:
                out["skipped"].append({"row": number, "line": line, "reason": "cell_count_mismatch", "column": None, "text": None})
                continue
            page_ranges, why = _number_ranges(cells[pages_col], top=MAX_PAGE, span=MAX_SPAN)
            if page_ranges is None:
                out["skipped"].append({"row": number, "line": line, "reason": f"pages_{why}", "column": "pages", "text": cells[pages_col]})
                continue
            line_ranges, why = _number_ranges(cells[lines_col], top=MAX_LINE, span=MAX_LINE_SPAN)
            if line_ranges is None:
                out["skipped"].append({"row": number, "line": line, "reason": f"transcript_{why}", "column": "transcript", "text": cells[lines_col]})
                continue
            questions, unparsed = _questions(cells[question_col]) if question_col is not None else ([], [])
            note: dict[str, str] = {}
            for i in range(width):
                if i not in (pages_col, lines_col, label_col):
                    key, copy = header[i], 2
                    while key in note:
                        key, copy = f"{header[i]} ({copy})", copy + 1
                    note[key] = cells[i]
            out["rows"].append({"row": number, "line": line, "label": cells[label_col] if label_col is not None else "",
                                "pages": sorted({page for start, end in page_ranges for page in range(start, end + 1)}), "page_ranges": page_ranges,
                                "transcript_ranges": line_ranges, "questions": questions, "questions_unparsed": unparsed, "note": note,
                                "pages_text": cells[pages_col], "transcript_text": cells[lines_col]})
        out["tables"].append({"line": found["line"], "kind": "study_map", "data_rows": taken,
                              "columns": {"label": header[label_col] if label_col is not None else None, "pages": header[pages_col], "transcript": header[lines_col],
                                          "questions": header[question_col] if question_col is not None else None}})
    out["inputs"].sort(key=lambda entry: entry["line"])  # file order, whether a table row or a line states it
    out["problems"].extend(unclosed)
    out["problems"].sort(key=lambda item: item["line"])
    return out


def _bound(parsed: dict, page_count: int | None, line_count: int | None) -> None:
    """Refuse rows that name a page or a line beyond a known count. Nothing is clamped to fit."""
    kept = []
    for row in parsed["rows"]:
        if page_count is not None and row["pages"][-1] > page_count:
            parsed["skipped"].append({"row": row["row"], "line": row["line"], "reason": "page_beyond_deck", "column": "pages", "text": row["pages_text"]})
        elif line_count is not None and max(end for _, end in row["transcript_ranges"]) > line_count:
            parsed["skipped"].append({"row": row["row"], "line": row["line"], "reason": "line_beyond_transcript", "column": "transcript", "text": row["transcript_text"]})
        else:
            kept.append(row)
    parsed["rows"] = kept
    parsed["skipped"].sort(key=lambda item: item["row"])


def parse_study_map(text: str, *, page_count: int | None = None, line_count: int | None = None) -> dict[str, Any]:
    """The statements of one study note: ``{rows, skipped, inputs, tables, problems}``. Pure; reads no file.

    ``rows``: ``{row, line, label, pages, page_ranges, transcript_ranges, questions: [{number, scope, as_written}],
    questions_unparsed, note: {heading: cell}, pages_text, transcript_text}``. ``skipped``: ``{row, line, reason, column,
    text}``. ``inputs``: ``{name, target, sha256 | None, kind: pdf | transcript | other, line, stated_in: table |
    list_item | line}``. ``problems``: ``{code, line, detail}`` in file order.
    """
    parsed = _parse(text.removeprefix(chr(0xFEFF)))  # a byte order mark left at the start of decoded text
    _bound(parsed, page_count, line_count)
    return parsed


# ---- which bytes the rows speak about ----------------------------------------------------------------
def _stream_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unit_sha(root: Path, item: dict, sha_of: Callable[[Path], str] | None) -> tuple[str | None, str | None]:
    """``(sha256, None)`` of a file the inventory lists. ``(None, why)`` when the inventory calls it readable and it cannot
    be hashed, whatever went wrong; ``(None, None)`` when the inventory itself says it is not available."""
    relative = item.get("path")
    if not relative or item.get("state") not in _OPENABLE:
        return None, None
    try:
        path = resolve_inside(root, relative)
        if not path.is_file():
            return None, "the file is not there as a plain file of the course"
        if path.stat().st_size > MAX_HASHED_BYTES:
            return None, "the file is larger than the bound for hashing"
    except (ContractError, OSError) as exc:
        return None, f"the file cannot be reached ({exc.__class__.__name__})"
    try:
        value = (sha_of or _stream_sha256)(path)
    except Exception as exc:  # noqa: BLE001 - a caller's hash function may fail in any way; the binding then verifies nothing
        return None, f"hashing failed ({exc.__class__.__name__})"
    if isinstance(value, str) and _SHA256.fullmatch(value):
        return value.lower(), None
    return None, "the hash function did not return a SHA-256"


def _hasher(root: Path, sha_of: Callable[[Path], str] | None, failures: dict[str, str]) -> Callable[[dict], str | None]:
    """Hash each unit file at most once; a file that should be readable and is not is noted in ``failures`` by source id."""
    known: dict[str, str | None] = {}

    def digest(item: dict) -> str | None:
        source_id = item["source_id"]
        if source_id not in known:
            known[source_id], why = _unit_sha(root, item, sha_of)
            if why:
                failures[source_id] = why
        return known[source_id]

    return digest


def _listed(entries: list[dict]) -> list[str]:
    return list(dict.fromkeys(entry["sha256"] for entry in entries if entry["sha256"]))


def _names(entry: dict, item: dict) -> bool:
    """Whether a listed input is, by the file name the note writes (or links to), this file of the unit."""
    wanted = str(item.get("filename") or "").casefold()
    written = (entry.get("name") or "", _link_path(entry.get("target")))
    return bool(wanted) and any(re.split(r"[\\/]", text.strip())[-1].casefold() == wanted for text in written)


def _bind_deck(lecture: dict, entries: list[dict], digest: Callable[[dict], str | None]) -> dict[str, Any]:
    """Which PDF of the unit the page numbers count. ``entries`` are the note's listed PDF inputs, with or without a hash."""
    listed = _listed(entries)
    shown = primary_deck(lecture)
    shown_pdf = shown is not None and shown.get("rendition") == "native_pdf"
    record: dict[str, Any] = {"source_id": None, "basis": "unit_displayed_deck", "bytes_verified": False, "state": "unresolved", "reason": None,
                              "on_displayed_deck": False, "sha256": None, "listed_sha256": listed}
    if not listed:
        if not shown_pdf:
            return dict(record, reason="no_displayed_deck" if shown is None else "displayed_deck_not_pdf")
        if shown.get("state") not in _OPENABLE:
            return dict(record, reason="displayed_deck_unreadable")
        return dict(record, source_id=shown["source_id"], state="current", on_displayed_deck=True)
    record["basis"] = "listed_sha256_match"
    own = digest(shown) if shown_pdf else None
    if own is not None and own in listed:
        return dict(record, source_id=shown["source_id"], bytes_verified=True, state="current", on_displayed_deck=True, sha256=own)
    # The displayed deck does not have listed bytes. Another file of the unit is the map's deck only when every listed PDF
    # has a hash (so the deck is not a listed file whose bytes the note left out), every listed hash is a file of this unit
    # (so none of them is an earlier version of the deck) and exactly one of those files could be a slide deck.
    pdfs = [item for item in [*lecture["decks"], *lecture["extra_materials"]] if item.get("rendition") == "native_pdf"]
    present = {digest(item) for item in pdfs} - {None}
    others = [item for item in lecture["decks"] if item.get("rendition") == "native_pdf" and _is_slide_candidate(item) and digest(item) in listed
              and (shown is None or item["source_id"] != shown["source_id"])]
    if len(others) == 1 and all(value in present for value in listed) and all(entry["sha256"] for entry in entries):
        return dict(record, source_id=others[0]["source_id"], bytes_verified=True, state="current", sha256=digest(others[0]))
    if shown is None:
        return dict(record, reason="listed_bytes_not_resolved_in_unit")
    if not shown_pdf:
        return dict(record, reason="displayed_deck_not_pdf")
    if own is None:
        return dict(record, reason="displayed_deck_unreadable")
    if any(entry["sha256"] and _names(entry, shown) for entry in entries):  # the note states a hash of this very file, and it has other bytes now
        return dict(record, source_id=shown["source_id"], state="stale", reason="unit_deck_bytes_differ", on_displayed_deck=True, sha256=own)
    return dict(record, reason="no_listed_hash_names_displayed_deck")


def _bind_transcript(lecture: dict, entries: list[dict], digest: Callable[[dict], str | None]) -> dict[str, Any]:
    """Which transcript of the unit the line numbers count. ``entries`` are the note's listed transcript inputs."""
    listed = _listed(entries)
    unit: dict[str, dict] = {}
    for session in lecture.get("sessions") or []:
        for item in session["items"]:
            if item["kind"] == "lecture_transcript":
                unit.setdefault(item["source_id"], item)
    items = list(unit.values())
    record: dict[str, Any] = {"source_id": None, "basis": "unit_transcript", "bytes_verified": False, "state": "unresolved", "reason": None, "sha256": None,
                              "listed_sha256": listed}
    missing = "no_transcript_linked_to_unit" if not items else "transcript_not_unique"
    if not listed:
        if len(items) != 1:
            return dict(record, reason=missing)
        if items[0].get("state") not in _OPENABLE:
            return dict(record, reason="unit_transcript_unreadable")
        return dict(record, source_id=items[0]["source_id"], state="current")
    record["basis"] = "listed_sha256_match"
    hashed = [(item, digest(item)) for item in items]
    matched = [(item, value) for item, value in hashed if value is not None and value in listed]
    if len(matched) == 1:
        return dict(record, source_id=matched[0][0]["source_id"], bytes_verified=True, state="current", sha256=matched[0][1])
    if matched:
        return dict(record, reason="listed_bytes_not_resolved_in_unit")
    if len(items) != 1:
        return dict(record, reason=missing)
    only, own = hashed[0]
    if own is None:
        return dict(record, reason="unit_transcript_unreadable")
    if any(entry["sha256"] and _names(entry, only) for entry in entries):
        return dict(record, source_id=only["source_id"], state="stale", reason="unit_transcript_bytes_differ", sha256=own)
    return dict(record, reason="no_listed_hash_names_unit_transcript")


def _question_map(review: Path, folder: str, names: list[str], number: str, report: Callable[[str, str, str], None]) -> dict[str, Any] | None:
    """The question ids the lecture's own companion question map(s) list: ``{files: [{path, sha256, bytes, questions}],
    question_ids}``, or ``None`` when no such file could be read. Every version present is read and their ids are joined,
    so no version is chosen over another. Only ids are taken; an entry that names two different ids names neither."""
    files: list[dict] = []
    ids: set[str] = set()
    for name in names:
        found = _QUESTION_MAP.match(name)
        if not found or found.group(1) != number:
            continue
        path = review / name
        try:
            if not path.is_symlink() and not path.is_file():
                continue
            data = read_owner_bytes(path, what=name)
            document = parse_owner_json(data, what=name)
        except OwnerReadError as exc:
            report(exc.code, name, "the companion question map could not be read; question numbers are resolved without it")
            continue
        except OSError as exc:
            report("unreadable", name, f"the companion question map could not be read: {exc.__class__.__name__}")
            continue
        entries = document.get("questions") if isinstance(document, dict) else None
        if not isinstance(entries, list):
            report("question_map_unreadable", name, "the companion question map has no list of questions; question numbers are resolved without it")
            continue
        named: set[str] = set()
        for raw in entries:
            own = {str(raw[key]) for key in ("id", "question_id") if raw.get(key)} if isinstance(raw, dict) else set()
            if len(own) == 1:
                named |= own
        files.append({"path": f"{folder}/{name}", "sha256": sha256_hex(data), "bytes": len(data), "questions": len(named)})
        ids |= named
    return {"files": files, "question_ids": sorted(ids)} if files else None


def read_study_maps(root: Path, inventory: dict, *, page_counts: Mapping[str, int] | None = None, line_counts: Mapping[str, int] | None = None,
                    sha_of: Callable[[Path], str] | None = None, only: Iterable[str] | None = None) -> dict[str, Any]:
    """Every study map of a course, per lecture of the inventory: ``{maps_version, lectures: {lecture_id: …}, problems}``.

    ``only`` names the lecture ids whose notes are read; the note of any other lecture is not opened and none of its
    problems is reported (a caller that needs one lecture reads one file).

    Per lecture: ``source {path, sha256, bytes}``, ``deck`` and ``transcript`` (``source_id``, ``basis``
    listed_sha256_match | unit_displayed_deck | unit_transcript, ``bytes_verified``, ``state`` current | stale |
    unresolved, ``reason``, ``sha256``, ``listed_sha256``; the deck also ``on_displayed_deck``), ``question_map``
    (``None`` or ``{files: [{path, sha256, bytes, questions}], question_ids}``), ``rows``, ``skipped``, ``inputs`` and
    ``tables`` as :func:`parse_study_map` returns them. ``page_counts`` and ``line_counts`` (by source id) bound the rows
    of a currently bound deck or transcript when the caller knows them. ``sha_of`` lets a caller supply a cached file
    hash; by default the unit's files are hashed here, and only when the note lists a hash to compare with. A hash
    function that raises or returns anything but a SHA-256 verifies nothing and is reported (``unit_file_not_hashed``).

    Reasons of an unresolved deck: ``no_displayed_deck``, ``displayed_deck_not_pdf``, ``displayed_deck_unreadable``,
    ``no_listed_hash_names_displayed_deck``, ``listed_bytes_not_resolved_in_unit``; of a stale one:
    ``unit_deck_bytes_differ``. Transcript: ``no_transcript_linked_to_unit``, ``transcript_not_unique``,
    ``unit_transcript_unreadable``, ``no_listed_hash_names_unit_transcript``, ``listed_bytes_not_resolved_in_unit``;
    stale: ``unit_transcript_bytes_differ``.
    """
    result: dict[str, Any] = {"maps_version": MAPS_VERSION, "lectures": {}, "problems": []}
    root = Path(root)
    review = root.joinpath(*REVIEW_FOLDER)
    folder = "/".join(REVIEW_FOLDER)

    def problem(code: str, file: str, lecture_id: str | None, detail: str, line: int | None = None) -> None:
        result["problems"].append({"code": code, "file": file, "lecture_id": lecture_id, "line": line, "detail": detail})

    try:
        if not review.is_dir():
            return result
        if review.is_symlink() or review.parent.is_symlink() or not review.resolve().is_relative_to(root.resolve()):
            problem("folder_outside_course", folder, None, "the review folder is a link or leads out of the course folder; it was not entered")
            return result
        listing = sorted(entry.name for entry in review.iterdir())
    except OSError as exc:
        problem("unreadable", folder, None, f"the review folder cannot be listed: {exc.__class__.__name__}")
        return result
    lectures = {lecture["lecture_id"]: lecture for lecture in inventory.get("lectures") or []}
    wanted = None if only is None else set(only)
    for name in listing:
        if not _STUDY_MAP.match(name):
            continue
        path = review / name
        lecture_id = f"lecture-{_STUDY_MAP.match(name).group(1)}"
        if wanted is not None and lecture_id not in wanted:
            continue
        try:
            if path.is_symlink():
                problem("unsafe_path", name, lecture_id if lecture_id in lectures else None, "the file is a link; it was not read")
                continue
            if not path.is_file():
                continue
            lecture = lectures.get(lecture_id)
            if lecture is None:
                problem("lecture_not_in_inventory", name, None, f"the inventory has no lecture unit {lecture_id}; the file was not read")
                continue
            if path.stat().st_size > MAX_MAP_BYTES:
                problem("too_large", name, lecture_id, f"the file exceeds the {MAX_MAP_BYTES}-byte bound for a study map; it was not read")
                continue
            data = read_owner_bytes(path, what=name)
        except OwnerReadError as exc:
            problem(exc.code, name, lecture_id, exc.message)
            continue
        except OSError as exc:
            problem("unreadable", name, lecture_id, f"the file cannot be read: {exc.__class__.__name__}")
            continue
        if len(data) > MAX_MAP_BYTES:
            problem("too_large", name, lecture_id, f"the file exceeds the {MAX_MAP_BYTES}-byte bound for a study map")
            continue
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            problem("not_utf8", name, lecture_id, "the file is not UTF-8 text")
            continue
        parsed = _parse(text)
        failures: dict[str, str] = {}
        digest = _hasher(root, sha_of, failures)
        deck = _bind_deck(lecture, [entry for entry in parsed["inputs"] if entry["kind"] == "pdf"], digest)
        transcript = _bind_transcript(lecture, [entry for entry in parsed["inputs"] if entry["kind"] == "transcript"], digest)
        _bound(parsed, (page_counts or {}).get(deck["source_id"]) if deck["state"] == "current" else None,
               (line_counts or {}).get(transcript["source_id"]) if transcript["state"] == "current" else None)
        for item in parsed["problems"]:
            problem(item["code"], name, lecture_id, item["detail"], item["line"])
        for source_id, why in failures.items():
            problem("unit_file_not_hashed", name, lecture_id, f"{source_id}: {why}; the hash the note lists could not be compared with it")
        if not any(table["kind"] == "study_map" for table in parsed["tables"]):
            problem("no_admitted_table", name, lecture_id, "no table of the file has exactly one slide-pages column and exactly one transcript-lines column")
        companion = _question_map(review, folder, listing, _STUDY_MAP.match(name).group(1), lambda code, file, detail, lecture_id=lecture_id: problem(code, file, lecture_id, detail))
        result["lectures"][lecture_id] = {"lecture_id": lecture_id, "source": {"path": f"{folder}/{name}", "sha256": sha256_hex(data), "bytes": len(data)},
                                          "deck": deck, "transcript": transcript, "question_map": companion, "rows": parsed["rows"], "skipped": parsed["skipped"],
                                          "inputs": parsed["inputs"], "tables": parsed["tables"]}
    return result


# ---- handing the rows on -----------------------------------------------------------------------------
def resolve_section_ties(study_maps: dict, bank: dict) -> dict[str, Any]:
    """Question numbers of the rows, resolved through the bank: ``{ties, unresolved, counts}``.

    A number is looked up among the questions of the collection(s) the bank ties to that lecture. When the lecture has its
    own companion question map, only the ids that map lists count (it narrows; it never adds a question the bank does not
    tie to the lecture). Exactly one question with that number is a tie; none or several is listed under ``unresolved``
    with the candidates and is not guessed. Reasons: ``no_collection_for_lecture``, ``no_question_with_number``,
    ``several_questions_with_number``, ``not_in_question_map`` (the bank has the number, the companion map lists none).
    """
    ties: dict[str, list[dict]] = {}
    unresolved: list[dict] = []
    asked = 0
    questions = bank.get("questions") or {}
    for lecture_id in sorted(study_maps.get("lectures") or {}):
        record = study_maps["lectures"][lecture_id]
        membership = (bank.get("lectures") or {}).get(lecture_id) or {}
        companion = record.get("question_map")
        listed = set(companion["question_ids"]) if companion else None
        by_number: dict[int, list[str]] = {}
        for question_id in membership.get("question_ids") or []:
            number = (questions.get(question_id) or {}).get("number")
            if isinstance(number, int) and not isinstance(number, bool):
                by_number.setdefault(number, []).append(question_id)
        for row in record["rows"]:
            for question in row["questions"]:
                asked += 1
                known = sorted(set(by_number.get(question["number"], [])))
                found = known if listed is None else [question_id for question_id in known if question_id in listed]
                if len(found) != 1:
                    reason = ("no_collection_for_lecture" if not membership.get("collections") else "several_questions_with_number" if found
                              else "not_in_question_map" if known else "no_question_with_number")
                    unresolved.append({"lecture_id": lecture_id, "row": row["row"], "number": question["number"], "reason": reason, "candidates": found or known})
                    continue
                ties.setdefault(found[0], []).append({
                    "lecture_id": lecture_id, "source_id": record["deck"]["source_id"], "pages": list(row["pages"]), "page_ranges": [list(r) for r in row["page_ranges"]],
                    "transcript_ranges": [list(r) for r in row["transcript_ranges"]], "row": row["row"], "label": row["label"], "scope": question["scope"],
                    "map_sha256": record["source"]["sha256"], "deck_state": record["deck"]["state"], "on_displayed_deck": record["deck"]["on_displayed_deck"],
                    "deck_bytes_verified": record["deck"]["bytes_verified"], "as_written": question["as_written"],
                    "number_basis": "lecture_collections" if listed is None else "companion_question_map"})
    return {"ties": ties, "unresolved": unresolved,
            "counts": {"asked": asked, "resolved": sum(len(rows) for rows in ties.values()), "unresolved": len(unresolved), "questions": len(ties)}}


def section_ties(study_maps: dict, bank: dict) -> dict[str, list[dict]]:
    """``{question_id: [{lecture_id, source_id, pages, page_ranges, transcript_ranges, row, label, scope, map_sha256,
    deck_state, on_displayed_deck, deck_bytes_verified, as_written, number_basis}]}`` — one entry per row that names the
    question. ``number_basis`` says how the number became an id: ``companion_question_map`` or ``lecture_collections``.

    A tie is the course's coarse statement that the question sits somewhere in those pages. It is shown as a current
    section tie only when ``deck_state`` is ``"current"`` and ``source_id`` is the deck on screen.
    """
    return resolve_section_ties(study_maps, bank)["ties"]


def timing_hints(study_maps: dict, lecture_id: str, *, deck_source_id: str | None = None, transcript_source_id: str | None = None) -> list[dict]:
    """Slide pages the course says go with transcript line ranges, for the alignment stage.

    ``[{pages, page_ranges, transcript_ranges, row, label, origin: "course_study_map", map_sha256, source_id,
    transcript_source_id, bytes_verified}]``; empty unless both the deck and the transcript binding are current. A caller
    that aligns one particular deck and transcript passes their ids and gets nothing that was made for other files.
    """
    record = (study_maps.get("lectures") or {}).get(lecture_id)
    if record is None:
        return []
    deck, transcript = record["deck"], record["transcript"]
    if deck["state"] != "current" or transcript["state"] != "current" or not deck["source_id"] or not transcript["source_id"]:
        return []
    if (deck_source_id is not None and deck_source_id != deck["source_id"]) or (transcript_source_id is not None and transcript_source_id != transcript["source_id"]):
        return []
    return [{"pages": list(row["pages"]), "page_ranges": [list(r) for r in row["page_ranges"]], "transcript_ranges": [list(r) for r in row["transcript_ranges"]],
             "row": row["row"], "label": row["label"], "origin": ORIGIN, "map_sha256": record["source"]["sha256"], "source_id": deck["source_id"],
             "transcript_source_id": transcript["source_id"], "bytes_verified": bool(deck["bytes_verified"] and transcript["bytes_verified"])}
            for row in record["rows"]]
