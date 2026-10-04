"""Closed mapping from wire actions to workflow contracts and scheduling classes.

A request selects an allowed action only. The workflow, its priority class and whether it needs a
reasoning turn are decided here from the trusted table, never from the payload.
"""
from __future__ import annotations

# Priority classes (lower = more urgent), from worker-lifecycle.md:
P_RECOVERY = 1      # retained learner input / commit recovery / control
P_INTERACTIVE = 2   # interactive replies and assessments
P_SELECTED = 3      # user-selected review, needed source preparation
P_BACKGROUND = 4    # archive backfill, routine projections

ACTION_WORKFLOW: dict[str, tuple[str, int, bool]] = {
    # action: (workflow, priority, needs_native_reasoning)
    "ask": ("WF04", P_INTERACTIVE, True),
    "explain": ("WF05", P_INTERACTIVE, True),
    "practice": ("WF05", P_INTERACTIVE, True),
    "review_answer": ("WF05", P_INTERACTIVE, True),
    "diagnose": ("WF06", P_INTERACTIVE, True),
    "select_review": ("WF07", P_SELECTED, False),
    "edit_review": ("WF07", P_SELECTED, False),
    "correct_assessment": ("WF09", P_INTERACTIVE, True),
    "correct_source": ("WF09", P_SELECTED, False),
    "save_note": ("WF10", P_SELECTED, False),
    "resume": ("WF10", P_BACKGROUND, False),
    "cancel": ("WF00", P_RECOVERY, False),
    "source_hint": ("WF01", P_SELECTED, False),
}

NATIVE_WORKFLOWS = frozenset({"WF04", "WF05", "WF06"})
BACKGROUND_WORKFLOWS = frozenset({"WF02", "WF03", "WF10-projection"})

WORKFLOW_TITLES = {
    "WF00": "Observe, admit and dispatch", "WF01": "Consume existing source discovery and publication", "WF02": "Prepare renditions and align evidence",
    "WF03": "Extend owned catalogs and project concept trees", "WF04": "Answer a source-grounded question", "WF05": "Assess a submitted explanation or answer",
    "WF06": "Diagnose and remediate a specific difficulty", "WF07": "Prepare questions and richer review cards", "WF08": "Schedule and conduct deliberate review",
    "WF09": "Apply reviewed corrections and invalidate dependents", "WF10": "Project memory, gaps and cross-device study state",
    "WF11": "Supervise health, recovery and controlled maintenance",
}


def workflow_for(action: str) -> tuple[str, int, bool]:
    try:
        return ACTION_WORKFLOW[action]
    except KeyError as exc:  # closed set: an unknown action is never routed by guess
        raise ValueError(f"No workflow for action {action!r}") from exc
