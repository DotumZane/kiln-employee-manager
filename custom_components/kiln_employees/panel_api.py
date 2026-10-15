"""Admin-only WebSocket API for the employee management panel."""
from uuid import uuid4
from datetime import datetime, timedelta, time
import re
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import callback
from .const import (
    COMPLETION_RULES,
    DEFAULT_ENTITIES,
    DOMAIN,
    ENTITY_LABELS,
    KILN_3_RAW_MQTT_TOPIC,
    WS_REGISTERED_KEY,
)
from .config_flow import validate_employee, DAYS
from .notifications import send_mobile
from .time_off import REASONS, validate_range, convert_legacy_event

DEFAULT_PLC_LOST_SECONDS = 30
DEFAULT_PLC_RESTORED_SECONDS = 15
DEFAULT_KILN_PAUSED_SECONDS = 300
MAX_PLC_DELAY_SECONDS = 3600
ENTITY_ID_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def _manager(hass):
    entries = hass.data.get(DOMAIN, {})
    return next((v for v in entries.values() if isinstance(v, dict) and "store" in v), None)


def _entity_info(hass, entity_id: str, label: str) -> dict:
    state = hass.states.get(entity_id)
    return {
        "label": label,
        "entity_id": entity_id,
        "exists": state is not None,
        "state": state.state if state else "missing",
        "friendly_name": state.attributes.get("friendly_name") if state else None,
    }


def _employee_display_status(manager: dict, employee: dict, local_now) -> dict:
    """Admin-only display status, derived from the SAME eligibility rules as the sensors.

    This reflects the configured schedule, not physical employee attendance.
    Phone numbers and notification targets are never included in this status.
    """
    from .binary_sensor import (
        employee_eligible, within_notification_window, vacation_active,
    )
    from .time_off import employee_on_time_off

    if employee.get("active") is False:
        label, kind = "Inactive", "inactive"
    elif employee.get("manual_time_off", False):
        label, kind = "Manual Time Off", "vacation"
    elif employee_on_time_off(manager["data"].get("time_off", []), employee.get("id"), local_now):
        today = local_now.date().isoformat()
        match = next((item for item in manager["data"].get("time_off", [])
                      if item.get("employee_id") == employee.get("id")
                      and item.get("start_date", "") <= today <= item.get("end_date", "")), None)
        label = "On Vacation" if match and match.get("reason") == "Vacation" else "Scheduled Time Off"
        kind = "vacation"
    elif not manager["data"].get("time_off_migrated", False) and vacation_active(
        manager.get("vacation_events", []), employee, local_now
    ):
        label, kind = "On Vacation", "vacation"
    elif not manager.get("vacation_ok", False):
        label, kind = "Vacation Check Unavailable", "unavailable"
    elif employee.get("all_day", False):
        label, kind = "24/7 Available", "active"
    elif within_notification_window(
        {**employee, "sms_enabled": True, "buffer_before": 0, "buffer_after": 0}, local_now
    ):
        label, kind = "On Shift", "active"
    elif within_notification_window({**employee, "sms_enabled": True}, local_now):
        label, kind = "Shift Buffer", "active"
    else:
        label, kind = "Off Shift", "off"
    return {
        "label": label,
        "kind": kind,
        "eligible": employee_eligible(manager, employee, local_now),
    }


def _plc_data(manager: dict) -> dict:
    """Return read-only raw PLC diagnostics for the admin panel."""
    monitor = manager.get("kiln_monitor", {})
    raw = monitor.get("raw", {})
    return {
        "topic": KILN_3_RAW_MQTT_TOPIC,
        "raw": raw if isinstance(raw, dict) else {},
        "last_received": monitor.get("last_received"),
        "last_clock_received": monitor.get("last_clock_received"),
        "last_clock": monitor.get("last_clock"),
        "last_status": monitor.get("last_status", "Unknown"),
        "data_valid": monitor.get("data_valid", False),
    }


@websocket_api.websocket_command({vol.Required("type"): "kiln_employees/list"})
@websocket_api.require_admin
@callback
def ws_list(hass, connection, msg):
    mgr = _manager(hass)
    if not mgr:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    notify = hass.services.async_services().get("notify", {})
    targets = [{"value": f"notify.{name}", "label": name.removeprefix("mobile_app_").replace("_", " ").title()}
               for name in notify if name.startswith("mobile_app_")]
    from homeassistant.util import dt as dt_util
    local_now = dt_util.as_local(dt_util.utcnow())
    employees = mgr["data"].get("employees", [])
    status_by_id = {
        employee["id"]: _employee_display_status(mgr, employee, local_now)
        for employee in employees if employee.get("id")
    }
    connection.send_result(msg["id"], {
        "employees": employees,
        "employee_statuses": status_by_id,
        "devices": targets,
        "history": mgr["data"].get("notification_history", [])[-30:],
        "settings": mgr["data"].get("settings", {}),
        "time_off": mgr["data"].get("time_off", []),
        "time_off_migrated": mgr["data"].get("time_off_migrated", False),
        "entities": {
            key: _entity_info(
                hass,
                mgr["data"].get("entities", {}).get(key, default),
                ENTITY_LABELS[key],
            )
            for key, default in DEFAULT_ENTITIES.items()
        },
        "additional_entities": [
            _entity_info(hass, item["entity_id"], item["name"])
            for item in mgr["data"].get("additional_entities", [])
            if isinstance(item, dict) and item.get("entity_id") and item.get("name")
        ],
        "plc_data": _plc_data(mgr),
    })


@websocket_api.websocket_command({vol.Required("type"): "kiln_employees/save", vol.Required("employee"): dict})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    mgr = _manager(hass)
    if not mgr:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    employees = mgr["data"].setdefault("employees", [])
    raw = msg["employee"]
    existing = next((e for e in employees if e.get("id") == raw.get("id")), None)
    if raw.get("id") and existing is None:
        connection.send_error(msg["id"], "not_found", "Employee was not found")
        return
    if existing is None and len(employees) >= 10:
        connection.send_error(msg["id"], "limit", "Maximum of 10 employees")
        return
    values = dict(existing or {})
    allowed = ("name", "phone", "use_mobile_app", "mobile_notify_service", "all_day", "workdays", "shift_start", "shift_end", "buffer_before", "buffer_after", "kilns", "sms_enabled", "active")
    for key in allowed:
        if key in raw:
            values[key] = raw[key]
    values.setdefault("phone", "")
    values.setdefault("mobile_notify_service", "")
    values.setdefault("all_day", False)
    values.setdefault("use_mobile_app", False)
    values.setdefault("workdays", DAYS[:5])
    values.setdefault("shift_start", "06:00")
    values.setdefault("shift_end", "16:00")
    values.setdefault("buffer_before", 15)
    values.setdefault("buffer_after", 15)
    values.setdefault("kilns", ["3"])
    values.setdefault("sms_enabled", True)
    values.setdefault("active", True)
    values.setdefault("alert_plc_lost", False)
    values.setdefault("alert_plc_restored", False)
    for key in ("name", "phone", "mobile_notify_service", "shift_start", "shift_end"):
        if not isinstance(values[key], str):
            connection.send_error(msg["id"], "invalid_input", f"Invalid {key}")
            return
    for key in ("workdays", "kilns"):
        if not isinstance(values[key], list) or any(not isinstance(v, str) for v in values[key]):
            connection.send_error(msg["id"], "invalid_input", f"Invalid {key}")
            return
    for key in ("all_day", "use_mobile_app", "sms_enabled", "active"):
        if not isinstance(values[key], bool):
            connection.send_error(msg["id"], "invalid_input", f"Invalid {key}")
            return
    try:
        values["buffer_before"] = int(values["buffer_before"])
        values["buffer_after"] = int(values["buffer_after"])
    except (ValueError, TypeError):
        connection.send_error(msg["id"], "invalid_input", "Invalid shift buffer")
        return
    if not (0 <= values["buffer_before"] <= 180 and 0 <= values["buffer_after"] <= 180):
        connection.send_error(msg["id"], "invalid_input", "Shift buffers must be 0–180 minutes")
        return
    if any(d not in DAYS for d in values["workdays"]) or any(k not in ("1", "2", "3") for k in values["kilns"]):
        connection.send_error(msg["id"], "invalid_input", "Invalid workday or kiln assignment")
        return
    values["name"] = values["name"].strip()
    values["phone"] = values["phone"].strip()
    values["shift_start"] = values["shift_start"][:5]
    values["shift_end"] = values["shift_end"][:5]
    error = validate_employee(values, employees, exclude_id=existing.get("id") if existing else None)
    if error:
        connection.send_error(msg["id"], error, error.replace("_", " "))
        return
    if values["use_mobile_app"]:
        name = values["mobile_notify_service"]
        available = hass.services.async_services().get("notify", {})
        if not name.startswith("notify.mobile_app_") or name.split(".", 1)[1] not in available:
            connection.send_error(msg["id"], "device_missing", "Select a registered mobile app device")
            return
    if existing:
        original = dict(existing)
        existing.update(values)
    else:
        values["id"] = uuid4().hex
        original = None
        employees.append(values)
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        if original is not None:
            existing.clear(); existing.update(original)
        else:
            employees.remove(values)
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"id": values["id"]})


@websocket_api.websocket_command({vol.Required("type"): "kiln_employees/delete", vol.Required("employee_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete(hass, connection, msg):
    mgr = _manager(hass)
    if not mgr:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    items = mgr["data"].get("employees", [])
    new = [e for e in items if e.get("id") != msg["employee_id"]]
    if len(new) == len(items):
        connection.send_error(msg["id"], "not_found", "Employee not found")
        return
    old_time_off = mgr["data"].get("time_off", [])
    mgr["data"]["employees"] = new
    mgr["data"]["time_off"] = [item for item in old_time_off if item.get("employee_id") != msg["employee_id"]]
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        mgr["data"]["employees"] = items
        mgr["data"]["time_off"] = old_time_off
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"deleted": True})


@websocket_api.websocket_command({vol.Required("type"): "kiln_employees/test_notification", vol.Required("employee_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_test_notification(hass, connection, msg):
    """Send one manual app test; does not dispatch SMS or kiln events."""
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager is not loaded")
        return
    employee = next((e for e in mgr["data"].get("employees", []) if e.get("id") == msg["employee_id"]), None)
    if employee is None:
        connection.send_error(msg["id"], "not_found", "Employee not found")
        return
    if employee.get("active") is False:
        connection.send_error(msg["id"], "inactive", "Reactivate this employee before testing")
        return
    try:
        result = await send_mobile(hass, employee,
            "Kiln Employees - Test Notification",
            "This is a test from Kiln Employee Manager. It does not represent a kiln completion.")
    except ValueError as exc:
        connection.send_error(msg["id"], "invalid_target", str(exc))
        return
    except Exception:
        connection.send_error(msg["id"], "delivery_failed", "Home Assistant could not submit the mobile notification. Check logs.")
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    vol.Required("type"): "kiln_employees/save_entities",
    vol.Required("entities"): dict,
    vol.Required("additional_entities"): list,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_entities(hass, connection, msg):
    """Save entity mappings used by the integration and future signals."""
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager is not loaded")
        return
    entities = msg["entities"]
    if set(entities) != set(DEFAULT_ENTITIES) or any(
        not isinstance(value, str) or not ENTITY_ID_RE.fullmatch(value)
        for value in entities.values()
    ):
        connection.send_error(msg["id"], "invalid_entities", "Enter valid Home Assistant entity IDs")
        return
    additional = msg["additional_entities"]
    if len(additional) > 25:
        connection.send_error(msg["id"], "invalid_entities", "You can add up to 25 additional entities")
        return
    cleaned = []
    seen = set(entities.values())
    for item in additional:
        if not isinstance(item, dict):
            connection.send_error(msg["id"], "invalid_entities", "Invalid additional entity")
            return
        raw_name = item.get("name", "")
        raw_entity_id = item.get("entity_id", "")
        name = raw_name.strip() if isinstance(raw_name, str) else ""
        entity_id = raw_entity_id.strip() if isinstance(raw_entity_id, str) else ""
        if (not name or len(name) > 80
                or not ENTITY_ID_RE.fullmatch(entity_id) or entity_id in seen):
            connection.send_error(msg["id"], "invalid_entities", "Additional entities must have unique names and valid entity IDs")
            return
        seen.add(entity_id)
        cleaned.append({"name": name, "entity_id": entity_id})
    previous_entities = dict(mgr["data"].get("entities", {}))
    previous_additional = list(mgr["data"].get("additional_entities", []))
    mgr["data"]["entities"] = dict(entities)
    mgr["data"]["additional_entities"] = cleaned
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        mgr["data"]["entities"] = previous_entities
        mgr["data"]["additional_entities"] = previous_additional
        raise
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command({
    vol.Required("type"): "kiln_employees/save_alert_settings",
    vol.Required("plc_lost_delay_seconds"): int,
    vol.Required("plc_restored_delay_seconds"): int,
    vol.Required("kiln_paused_delay_seconds"): int,
    vol.Required("recipients"): list,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_alert_settings(hass, connection, msg):
    """Save global PLC delays and recipient subscriptions together."""
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    lost = msg["plc_lost_delay_seconds"]
    restored = msg["plc_restored_delay_seconds"]
    paused = msg["kiln_paused_delay_seconds"]
    if (isinstance(lost, bool) or isinstance(restored, bool)
            or not (0 <= lost <= MAX_PLC_DELAY_SECONDS)
            or not (0 <= restored <= MAX_PLC_DELAY_SECONDS)):
        connection.send_error(msg["id"], "invalid_delay", "Delays must be 0–3600 whole seconds")
        return
    if isinstance(paused, bool) or not 0 <= paused <= MAX_PLC_DELAY_SECONDS:
        connection.send_error(msg["id"], "invalid_delay", "Delays must be 0–3600 whole seconds")
        return
    employees = mgr["data"].setdefault("employees", [])
    employee_ids = {employee.get("id") for employee in employees}
    selections = {}
    for row in msg["recipients"]:
        if (not isinstance(row, dict) or not isinstance(row.get("employee_id"), str)
                or type(row.get("lost")) is not bool
                or type(row.get("restored")) is not bool
                or type(row.get("paused")) is not bool):
            connection.send_error(msg["id"], "invalid_recipients", "Invalid recipient settings")
            return
        employee_id = row["employee_id"]
        if employee_id not in employee_ids or employee_id in selections:
            connection.send_error(msg["id"], "invalid_recipients", "Unknown or repeated employee")
            return
        selections[employee_id] = row
    if set(selections) != employee_ids:
        connection.send_error(msg["id"], "invalid_recipients", "Recipient list is incomplete; reload and retry")
        return

    previous_settings = dict(mgr["data"].setdefault("settings", {}))
    previous_recipients = {e["id"]: (e.get("alert_plc_lost", False), e.get("alert_plc_restored", False), e.get("alert_kiln_paused", False))
                           for e in employees}
    settings = mgr["data"]["settings"]
    settings.update({
        "plc_lost_delay_seconds": lost,
        "plc_restored_delay_seconds": restored,
        "kiln_paused_delay_seconds": paused,
    })
    for employee in employees:
        row = selections[employee["id"]]
        employee["alert_plc_lost"] = row["lost"]
        employee["alert_plc_restored"] = row["restored"]
        employee["alert_kiln_paused"] = row["paused"]
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        mgr["data"]["settings"] = previous_settings
        for employee in employees:
            employee["alert_plc_lost"], employee["alert_plc_restored"], employee["alert_kiln_paused"] = previous_recipients[employee["id"]]
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"saved": True})


@websocket_api.websocket_command({
    vol.Required("type"): "kiln_employees/save_kiln_config",
    vol.Required("kiln_id"): str,
    vol.Required("completion_rule"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_kiln_config(hass, connection, msg):
    """Save configuration that belongs to one physical kiln."""
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager is not loaded")
        return
    kiln_id = msg["kiln_id"].strip()
    rule = msg["completion_rule"]
    if kiln_id not in {"1", "2", "3"} or rule not in COMPLETION_RULES:
        connection.send_error(msg["id"], "invalid_kiln_config", "Invalid kiln or completion rule")
        return
    settings = mgr["data"].setdefault("settings", {})
    configs = settings.setdefault("kiln_configs", {})
    previous = dict(configs.get(kiln_id, {}))
    configs[kiln_id] = {**previous, "completion_rule": rule}
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        configs[kiln_id] = previous
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"saved": True})



@websocket_api.websocket_command({
    vol.Required("type"): "kiln_employees/time_off_save",
    vol.Required("time_off"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_time_off_save(hass, connection, msg):
    """Add or edit an all-day time-off range; never alter the shared calendar."""
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    raw = msg["time_off"]
    employee_id = raw.get("employee_id")
    if not isinstance(employee_id, str) or not any(
            e.get("id") == employee_id for e in mgr["data"].get("employees", [])):
        connection.send_error(msg["id"], "invalid_employee", "Choose a registered employee")
        return
    reason = raw.get("reason", "Vacation")
    if not isinstance(reason, str) or reason not in REASONS:
        connection.send_error(msg["id"], "invalid_reason", "Choose a valid time-off reason")
        return
    try:
        start, end = validate_range(raw.get("start_date"), raw.get("end_date"))
    except (ValueError, TypeError) as exc:
        connection.send_error(msg["id"], "invalid_dates", str(exc))
        return
    items = mgr["data"].setdefault("time_off", [])
    entry_id = raw.get("id")
    existing = None
    if entry_id:
        existing = next((item for item in items if item.get("id") == entry_id), None)
        if existing is None:
            connection.send_error(msg["id"], "not_found", "Time-off entry no longer exists")
            return
    for item in items:
        if item is existing or item.get("employee_id") != employee_id:
            continue
        try:
            a, b = validate_range(item.get("start_date"), item.get("end_date"))
        except (ValueError, TypeError):
            connection.send_error(msg["id"], "invalid_saved_record", "Existing time-off dates need repair")
            return
        if start <= b and a <= end:
            connection.send_error(msg["id"], "overlap", "This employee already has time off during those dates")
            return
    new = {"id": existing["id"] if existing else uuid4().hex,
           "employee_id": employee_id,
           "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": reason}
    if existing:
        previous = dict(existing)
        existing.update(new)
    else:
        items.append(new)
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        if existing:
            existing.clear(); existing.update(previous)
        else:
            items.remove(new)
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"id": new["id"]})


@websocket_api.websocket_command({
    vol.Required("type"): "kiln_employees/time_off_delete",
    vol.Required("time_off_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_time_off_delete(hass, connection, msg):
    """Cancel a saved vacation; affects eligibility immediately."""
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    old = mgr["data"].get("time_off", [])
    filtered = [item for item in old if item.get("id") != msg["time_off_id"]]
    if len(old) == len(filtered):
        connection.send_error(msg["id"], "not_found", "Time-off entry not found")
        return
    mgr["data"]["time_off"] = filtered
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        mgr["data"]["time_off"] = old
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"deleted": True})


@websocket_api.websocket_command({
    vol.Required("type"): "kiln_employees/time_off_import",
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_time_off_import(hass, connection, msg):
    """One-time import of legacy all-day 'Name - Time Off' calendar events.

    Do not switch off legacy enforcement unless *all* calendar reads succeed.
    Existing Local Calendar events are not modified or deleted.
    """
    mgr = _manager(hass)
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Employee manager not loaded")
        return
    if mgr["data"].get("time_off_migrated", False):
        connection.send_error(msg["id"], "already_imported", "Legacy vacation calendar already imported")
        return
    cal = mgr["data"].get("entities", {}).get(
        "time_off_calendar", DEFAULT_ENTITIES["time_off_calendar"]
    )
    from homeassistant.util import dt as dt_util
    local_now = dt_util.as_local(dt_util.utcnow())
    beginning = datetime.combine(local_now.date() - timedelta(days=1), time.min, tzinfo=local_now.tzinfo)
    stop = beginning + timedelta(days=732)
    found = []
    cursor = beginning
    try:
        while cursor < stop:
            next_cursor = min(cursor + timedelta(days=90), stop)
            response = await hass.services.async_call(
                "calendar", "get_events",
                {"entity_id": cal,
                 "start_date_time": cursor.isoformat(),
                 "end_date_time": next_cursor.isoformat()},
                blocking=True, return_response=True,
            )
            calendar_result = response.get(cal) if isinstance(response, dict) else None
            if not isinstance(calendar_result, dict) or not isinstance(calendar_result.get("events"), list):
                raise ValueError("Calendar did not return events")
            found.extend(calendar_result["events"])
            cursor = next_cursor
    except Exception:
        connection.send_error(msg["id"], "calendar_unavailable", "Could not read the existing vacation calendar. Nothing was changed.")
        return
    employees = mgr["data"].get("employees", [])
    old = mgr["data"].setdefault("time_off", [])
    new_items = []
    seen = {(item.get("employee_id"), item.get("start_date"), item.get("end_date")) for item in old}
    ignored = 0
    problems = 0
    for event in found:
        summary = str(event.get("summary", "")).strip()
        if not summary.casefold().endswith(" - time off"):
            ignored += 1
            continue
        try:
            matched = convert_legacy_event(event, employees)
        except (ValueError, TypeError):
            problems += 1
            continue
        if matched is None:
            problems += 1
            continue
        if matched in seen:
            continue
        seen.add(matched)
        employee_id, start, end = matched
        new_items.append({"id": uuid4().hex, "employee_id": employee_id,
                          "start_date": start, "end_date": end, "reason": "Vacation"})
    if problems:
        connection.send_error(
            msg["id"], "unmatched_vacations",
            f"Found {problems} time-off calendar events without matching registered employee names or valid all-day dates. Fix these in the calendar before importing; nothing has changed.",
        )
        return
    mgr["data"]["time_off"] = old + new_items
    mgr["data"]["time_off_migrated"] = True
    try:
        await mgr["store"].async_save(mgr["data"])
    except Exception:
        mgr["data"]["time_off"] = old
        mgr["data"]["time_off_migrated"] = False
        raise
    for listener in tuple(mgr.get("listeners", ())):
        listener()
    connection.send_result(msg["id"], {"imported": len(new_items), "ignored": ignored})


@callback
def register(hass):
    # Register handlers once; data is resolved at call time.
    if hass.data.get(WS_REGISTERED_KEY):
        return
    for func in (ws_list, ws_save, ws_delete, ws_test_notification, ws_save_entities, ws_save_alert_settings, ws_save_kiln_config, ws_time_off_save, ws_time_off_delete, ws_time_off_import):
        websocket_api.async_register_command(hass, func)
    hass.data[WS_REGISTERED_KEY] = True
