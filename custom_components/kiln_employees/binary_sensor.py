"""Live employee SMS eligibility; fail closed if shared vacation calendar cannot be read."""
import asyncio
import logging
from datetime import date, datetime, timedelta, time

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .time_off import employee_on_time_off

_LOGGER = logging.getLogger(__name__)
CALENDAR = "calendar.kiln_employee_time_off"


def within_notification_window(employee: dict, local_now: datetime) -> bool:
    """Workdays identify the day each shift starts, including overnight shifts."""
    if (not employee.get("active", True) or not employee.get("sms_enabled", False)
            or employee.get("manual_time_off", False)):
        return False
    if employee.get("all_day", False):
        return True
    try:
        start_h, start_m = [int(x) for x in employee["shift_start"].split(":")[:2]]
        end_h, end_m = [int(x) for x in employee["shift_end"].split(":")[:2]]
        before = int(employee.get("buffer_before", 15))
        after = int(employee.get("buffer_after", 15))
        if not (0 <= start_h < 24 and 0 <= end_h < 24 and
                0 <= start_m < 60 and 0 <= end_m < 60 and
                0 <= before <= 180 and 0 <= after <= 180):
            return False
    except (KeyError, ValueError, TypeError, AttributeError):
        return False
    start_min = start_h * 60 + start_m
    end_min = end_h * 60 + end_m
    if start_min == end_min:
        return False
    workdays = set(employee.get("workdays", []))
    # Localized arithmetic with HA timezone; typical transitions on DST boundaries
    # should be independently tested for sites operating overnight during DST.
    for offset in (-1, 0, 1):
        shift_date = local_now.date() + timedelta(days=offset)
        if shift_date.strftime("%A") not in workdays:
            continue
        start = datetime.combine(shift_date, time.min, tzinfo=local_now.tzinfo) + timedelta(minutes=start_min)
        end = datetime.combine(shift_date, time.min, tzinfo=local_now.tzinfo) + timedelta(minutes=end_min)
        if end_min < start_min:
            end += timedelta(days=1)
        if start - timedelta(minutes=before) <= local_now < end + timedelta(minutes=after):
            return True
    return False


def _event_timestamp(value, local_now):
    """Calendar can return ISO date, ISO datetime, or a Python datetime/date."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=local_now.tzinfo)
    return parsed.timestamp()


def vacation_active(events: list, employee: dict, local_now: datetime) -> bool:
    """Match this employee's existing 'Name - Time Off' calendar events only."""
    expected = f"{employee.get('name', '').strip()} - Time Off".casefold()
    at = local_now.timestamp()
    for event in events:
        if str(event.get("summary", "")).strip().casefold() != expected:
            continue
        starts = _event_timestamp(event.get("start"), local_now)
        ends = _event_timestamp(event.get("end"), local_now)
        if starts is None or ends is None:
            # Fail closed for this employee if their event has malformed dates.
            return True
        if starts <= at < ends:
            return True
    return False


def employee_eligible(manager: dict, employee: dict, local_now: datetime) -> bool:
    """Single source of truth shared by employee sensors and PLC alert routing."""
    if not manager.get("vacation_ok", False):
        return False
    if not within_notification_window(employee, local_now):
        return False
    if employee_on_time_off(manager["data"].get("time_off", []), employee.get("id"), local_now):
        return False
    if not manager["data"].get("time_off_migrated", False):
        if vacation_active(manager.get("vacation_events", []), employee, local_now):
            return False
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities) -> None:
    manager = hass.data[DOMAIN][entry.entry_id]
    manager["vacation_events"] = []
    manager["vacation_ok"] = bool(manager["data"].get("time_off_migrated", False))
    # Legacy calendar remains authoritative until a successful explicit migration.
    entities = {}
    removal_tasks = set()
    refresh_running = False
    calendar_failures = 0
    CALENDAR_RETRY_ATTEMPTS = 3
    CALENDAR_FAILURE_LIMIT = 4

    @callback
    def sync_employees():
        nonlocal removal_tasks
        ids = {e.get("id") for e in manager["data"].get("employees", []) if e.get("id")}
        new = []
        for employee_id in ids:
            if employee_id not in entities:
                sensor = KilnEmployeeSMSEligible(manager, employee_id)
                entities[employee_id] = sensor
                new.append(sensor)
        if new:
            async_add_entities(new)
        for employee_id in set(entities) - ids:
            sensor = entities.pop(employee_id)

            async def remove_sensor(old=sensor):
                entity_id = old.entity_id
                if old.hass is not None:
                    await old.async_remove()
                registry = er.async_get(hass)
                reg_entity_id = registry.async_get_entity_id(
                    "binary_sensor", DOMAIN, old.unique_id
                )
                if reg_entity_id:
                    registry.async_remove(reg_entity_id)
                elif entity_id and registry.async_get(entity_id):
                    registry.async_remove(entity_id)

            task = hass.async_create_task(remove_sensor())
            removal_tasks.add(task)
            task.add_done_callback(removal_tasks.discard)
        for sensor in entities.values():
            if sensor.hass is not None:
                sensor.async_write_ha_state()

    async def sync_employee_selector():
        """Keep the existing vacation-form dropdown aligned with employee records."""
        selector_entity = "input_select.kiln_employee_selector"
        if hass.states.get(selector_entity) is None:
            return
        names = sorted(e["name"] for e in manager["data"].get("employees", [])
                       if e.get("name"))
        if not names:
            return
        try:
            await hass.services.async_call(
                "input_select", "set_options",
                {"entity_id": selector_entity, "options": names}, blocking=True,
            )
        except Exception as exc:
            _LOGGER.warning("Could not update employee vacation dropdown: %s", exc)

    async def refresh_calendar():
        nonlocal refresh_running, calendar_failures
        if manager["data"].get("time_off_migrated", False):
            manager["vacation_ok"] = True
            manager["vacation_events"] = []
            sync_employees()
            return
        if refresh_running:
            return
        if not hass.services.has_service("calendar", "get_events"):
            # Calendar integrations can register their actions after this
            # integration is set up during Home Assistant startup. Keep the
            # check fail-closed, but let the scheduled retry recover without
            # requiring a restart.
            calendar_failures += 1
            if calendar_failures >= CALENDAR_FAILURE_LIMIT:
                manager["vacation_ok"] = False
            _LOGGER.debug("Calendar get_events action is not registered yet; retrying")
            sync_employees()
            return
        refresh_running = True
        local_now = dt_util.as_local(dt_util.utcnow())
        start = datetime.combine(local_now.date() - timedelta(days=1), time.min, tzinfo=local_now.tzinfo)
        end = start + timedelta(days=4)
        last_error = None
        try:
            # Explicit response ensures overlaps and deletions are checked; a single
            # calendar entity's on/off state is insufficient for multiple employees.
            for attempt in range(CALENDAR_RETRY_ATTEMPTS):
                try:
                    response = await hass.services.async_call(
                        "calendar", "get_events",
                        {"start_date_time": start.isoformat(),
                         "end_date_time": end.isoformat()},
                        target={"entity_id": [CALENDAR]},
                        blocking=True, return_response=True,
                    )
                    payload = response.get(CALENDAR, {}) if isinstance(response, dict) else {}
                    events = payload.get("events")
                    if not isinstance(events, list):
                        raise ValueError("Missing calendar event list")
                    manager["vacation_events"] = events
                    manager["vacation_ok"] = True
                    calendar_failures = 0
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if attempt < CALENDAR_RETRY_ATTEMPTS - 1:
                        await asyncio.sleep(1)
            else:
                calendar_failures += 1
                # Do not turn a temporary service hiccup into a false alarm. The
                # last successful event set remains authoritative until repeated
                # failures exceed the limit.
                if calendar_failures >= CALENDAR_FAILURE_LIMIT:
                    manager["vacation_ok"] = False
                    calendar_state = hass.states.get(CALENDAR)
                    _LOGGER.warning(
                        "Kiln vacation check unavailable for %s after %s failed checks "
                        "(state=%s): %s",
                        CALENDAR,
                        calendar_failures,
                        calendar_state.state if calendar_state else "missing",
                        last_error,
                    )
        finally:
            refresh_running = False
            sync_employees()

    @callback
    def tick(_now):
        if manager["data"].get("time_off_migrated", False):
            sync_employees()
        else:
            hass.async_create_task(refresh_calendar())

    @callback
    def on_employee_change():
        sync_employees()
        hass.async_create_task(sync_employee_selector())
        hass.async_create_task(refresh_calendar())

    sync_employees()
    manager["listeners"].add(on_employee_change)
    cancel_interval = async_track_time_interval(hass, tick, timedelta(seconds=15))
    entry.async_on_unload(cancel_interval)
    # Retry shortly after startup in case the calendar integration registers
    # its action after this integration's first setup pass.
    entry.async_on_unload(
        async_call_later(
            hass, 10,
            lambda _now: hass.async_create_task(refresh_calendar()),
        )
    )
    entry.async_on_unload(lambda: manager["listeners"].discard(on_employee_change))
    hass.async_create_task(refresh_calendar())
    hass.async_create_task(sync_employee_selector())


class KilnEmployeeSMSEligible(BinarySensorEntity):
    """Read-only employee status; never expose phone numbers as attributes."""
    _attr_has_entity_name = False
    _attr_icon = "mdi:message-check"
    _attr_should_poll = False

    def __init__(self, manager: dict, employee_id: str):
        self._manager = manager
        self._employee_id = employee_id
        self._attr_unique_id = f"kiln_employee_{employee_id}_sms_eligible"

    @property
    def _employee(self):
        return next((e for e in self._manager["data"].get("employees", [])
                     if e.get("id") == self._employee_id), None)

    @property
    def name(self):
        employee = self._employee
        return (f"Kiln Employee {employee['name']} SMS Eligible" if employee
                else "Kiln Employee SMS Eligible")

    @property
    def available(self):
        return self._employee is not None

    @property
    def is_on(self):
        employee = self._employee
        if not employee:
            return False
        current = dt_util.as_local(dt_util.utcnow())
        return employee_eligible(self._manager, employee, current)

    @property
    def extra_state_attributes(self):
        employee = self._employee
        if not employee:
            return {}
        now = dt_util.as_local(dt_util.utcnow())
        ok = self._manager.get("vacation_ok", False)
        return {
            "employee_id": self._employee_id,
            "shift_start": employee.get("shift_start"),
            "shift_end": employee.get("shift_end"),
            "workdays": employee.get("workdays", []),
            "buffer_before": employee.get("buffer_before", 15),
            "buffer_after": employee.get("buffer_after", 15),
            "assigned_kilns": employee.get("kilns", []),
            "sms_enabled": employee.get("sms_enabled", False),
            "manual_time_off": employee.get("manual_time_off", False),
            "active": employee.get("active", True),
            "vacation_check": "ok" if ok else "unavailable_blocking_sms",
            "vacation_active": (
                employee_on_time_off(self._manager["data"].get("time_off", []), self._employee_id, now)
                or (not self._manager["data"].get("time_off_migrated", False)
                    and vacation_active(self._manager.get("vacation_events", []), employee, now))
            ) if ok else None,
            "vacation_source": "integration" if self._manager["data"].get("time_off_migrated", False) else "integration_and_legacy_calendar",
        }
