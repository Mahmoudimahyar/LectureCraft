"""A displayable copy of an original that this app cannot display (R1-Q4).

The original stays authoritative. A copy is offered as a *display rendition* only after its text was compared with the
original's and the comparison was recorded against the exact bytes of both files. The comparison reads text only:
figures are counted, not compared, and the record says so. Nothing is converted and no office program is started.
"""
from __future__ import annotations

from pathlib import Path
import json
import re
import zipfile
from typing import Any

from ..fsutil import replace_atomic

CHECK_METHOD = "docx-xml-text-vs-pdf-page-text/1"
MIN_SHARE = 0.9   # share of the copy's page vocabulary that must occur in the original
MIN_TOKENS = 12   # fewer distinct words than this is too little text to compare
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-]*")
_MAX_XML = 20_000_000


def docx_text(path: Path) -> dict[str, Any]:
    """Text and embedded-image count of a word-processing file, read from its XML part (no program is run)."""
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo("word/document.xml")
        if info.file_size > _MAX_XML:
            raise ValueError("document part is larger than this reader accepts")
        xml = archive.read(info).decode("utf-8", errors="replace")
        images = sum(1 for name in archive.namelist() if name.startswith("word/media/"))
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>|<w:br/>", " ", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    for entity, char in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
        text = text.replace(entity, char)
    return {"text": text, "embedded_images": images}


def _vocabulary(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text) if len(w) > 2}


def compare_rendition(original: Path, rendition: Path, *, page: int) -> dict[str, Any]:
    """Compare one page of a PDF copy with a .docx original. Returns the measured share and a result, never a guess."""
    from pypdf import PdfReader

    if original.suffix.lower() != ".docx" or rendition.suffix.lower() != ".pdf":
        return {"method": CHECK_METHOD, "result": "unsupported", "reason": "this check compares a .docx original with a PDF copy"}
    source = docx_text(original)
    reader = PdfReader(str(rendition))
    if not 1 <= page <= len(reader.pages):
        return {"method": CHECK_METHOD, "result": "page_out_of_range", "pages": len(reader.pages)}
    pdf_page = reader.pages[page - 1]
    copy_words, original_words = _vocabulary(pdf_page.extract_text() or ""), _vocabulary(source["text"])
    try:
        page_images = len(list(pdf_page.images))
    except Exception:  # noqa: BLE001 - an unusual image stream must not fail a text comparison
        page_images = None
    if len(copy_words) < MIN_TOKENS:
        return {"method": CHECK_METHOD, "result": "too_little_text", "distinct_words_on_page": len(copy_words)}
    share = len(copy_words & original_words) / len(copy_words)
    return {"method": CHECK_METHOD, "result": "match" if share >= MIN_SHARE else "mismatch", "score": round(share, 4), "threshold": MIN_SHARE, "page": page,
            "distinct_words_on_page": len(copy_words), "words_not_in_original": len(copy_words - original_words),
            "scope": f"Words on page {page} of the copy were looked up in the original's text. Figures were counted, not compared.",
            "original_embedded_images": source["embedded_images"], "rendition_page_images": page_images}


def _store(state_dir: Path) -> Path:
    return state_dir / "rendition-checks.json"


def load_rendition_checks(state_dir: Path, course_id: str) -> dict[str, dict]:
    try:
        return dict(json.loads(_store(state_dir).read_text(encoding="utf-8")).get(course_id) or {})
    except (OSError, ValueError):
        return {}


def record_rendition_check(state_dir: Path, course_id: str, *, original: dict, rendition: dict, original_sha256: str, rendition_sha256: str, outcome: dict, checked_at: str) -> dict:
    """Keep one comparison, bound to the exact bytes compared. App-local state; never written into a course."""
    path = _store(state_dir)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        doc = {}
    record = dict(outcome, original_source_id=original["source_id"], rendition_source_id=rendition["source_id"], original_sha256=original_sha256, rendition_sha256=rendition_sha256,
                  checked_at=checked_at)
    doc.setdefault(course_id, {})[original["source_id"]] = record
    replace_atomic(path, json.dumps(doc, indent=1, sort_keys=True).encode("utf-8"))
    return record
