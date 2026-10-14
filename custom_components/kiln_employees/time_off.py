"""Persistent all-day employee time-off records; uses stable employee IDs."""
from datetime import date, datetime, timedelta
import re

REASONS = ("Vacation", "Personal Day", "Sick Day", "Other")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}\Z")


def parse_day(value):
    """Strict YYYY-MM-DD, rejecting time-of-day and malformed dates."""
    if not isinstance(value, str) or not _DATE_RE.fullmatch(value):
        raise ValueError("Select a valid date")
    return date.fromisoformat(value)


def validate_range(start, end):
    first = parse_day(start)
    last = parse_day(end)
    if last < first:
        raise ValueError("Last day must be on or after first day")
    if (last - first).days > 366:
        raise ValueError("A time-off entry cannot exceed 367 days")
    return first, last


def employee_on_time_off(records, employee_id, local_now):
    """All-day dates are inclusive and evaluated in HA's local timezone."""
    today = local_now.date()
    for item in records:
        if item.get("employee_id") != employee_id:
            continue
        try:
            first, last = validate_range(item.get("start_date"), item.get("end_date"))
        except (ValueError, TypeError):
            # A malformed record must not silently grant notification eligibility.
            return True
        if first <= today <= last:
            return True
    return False


def convert_legacy_event(event, employees):
    """Convert one all-day Name - Time Off calendar event, if recognizable.

    Calendar event end dates are exclusive; internal end dates are inclusive.
    Returns (employee_id, first_day, last_day), or None for unrecognized entries.
    """
    summary = str(event.get("summary", "")).strip().casefold()
    matched = [e for e in employees if summary == f"{e.get('name', '').strip()} - Time Off".casefold()]
    if len(matched) != 1:
        return None
    first = parse_day(event.get("start"))
    exclusive_end = parse_day(event.get("end"))
    last = exclusive_end - timedelta(days=1)
    validate_range(first.isoformat(), last.isoformat())
    return matched[0]["id"], first.isoformat(), last.isoformat()
