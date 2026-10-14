"""Options-based add/edit/deactivate/delete UI for Kiln Employee Manager."""
import re
from uuid import uuid4

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import DOMAIN

MAX_EMPLOYEES = 10
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
KILNS = ["1", "2", "3"]
TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$"
PHONE_PATTERN = r"^\+[1-9]\d{7,14}$"


def mobile_notification_services(hass):
    """Return currently registered Home Assistant mobile push targets."""
    notify = hass.services.async_services().get("notify", {})
    return {f"notify.{name}": name.removeprefix("mobile_app_").replace("_", " ").title()
            for name in notify if name.startswith("mobile_app_")}


def employee_schema(employee=None, mobile_services=None):
    """Single-page form. Fields not in use remain optional and are ignored."""
    employee = employee or {}
    services = dict(mobile_services or {})
    selected = employee.get("mobile_notify_service", "")
    if selected and selected not in services:
        services[selected] = f"{selected} (not currently available)"
    fields = {
        vol.Required("name", default=employee.get("name", "")): str,
        vol.Required("use_mobile_app", default=employee.get("use_mobile_app", False)):
            selector.BooleanSelector(),
        vol.Optional("phone", default=employee.get("phone", "")): str,
    }
    if services:
        fields[vol.Optional("mobile_notify_service", default=selected or next(iter(services)))] = vol.In(services)
    else:
        fields[vol.Optional("mobile_notify_service", default=selected)] = str
    fields.update({
        vol.Required("all_day", default=employee.get("all_day", False)):
            selector.BooleanSelector(),
        vol.Optional("workdays", default=employee.get("workdays", DAYS[:5])):
            selector.SelectSelector(selector.SelectSelectorConfig(
                options=DAYS, multiple=True, mode=selector.SelectSelectorMode.DROPDOWN)),
        vol.Optional("shift_start", default=employee.get("shift_start", "06:00")):
            selector.TimeSelector(),
        vol.Optional("shift_end", default=employee.get("shift_end", "16:00")):
            selector.TimeSelector(),
        vol.Optional("buffer_before", default=employee.get("buffer_before", 15)):
            vol.All(vol.Coerce(int), vol.Range(min=0, max=180)),
        vol.Optional("buffer_after", default=employee.get("buffer_after", 15)):
            vol.All(vol.Coerce(int), vol.Range(min=0, max=180)),
        vol.Required("kilns", default=employee.get("kilns", ["3"])):
            selector.SelectSelector(selector.SelectSelectorConfig(
                options=KILNS, multiple=True, mode=selector.SelectSelectorMode.DROPDOWN)),
        vol.Required("sms_enabled", default=employee.get("sms_enabled", True)):
            selector.BooleanSelector(),
    })
    return vol.Schema(fields)


def validate_employee(values, employees, exclude_id=None):
    name = values["name"].strip()
    if not name:
        return "invalid_name"
    if values.get("use_mobile_app", False):
        if not values.get("mobile_notify_service"):
            return "missing_mobile_device"
    else:
        if not re.fullmatch(PHONE_PATTERN, values.get("phone", "").strip()):
            return "invalid_phone"
    if not values.get("all_day", False) and not values["workdays"]:
        return "missing_workdays"
    if not values["kilns"]:
        return "missing_kilns"
    if not values.get("all_day", False):
        for field in ("shift_start", "shift_end"):
            if not re.fullmatch(TIME_PATTERN, values.get(field, "")):
                return "invalid_time"
    if not values.get("all_day", False) and values["shift_start"][:5] == values["shift_end"][:5]:
        return "invalid_time"
    for employee in employees:
        if employee.get("id") == exclude_id:
            continue
        if employee.get("name", "").casefold() == name.casefold():
            return "duplicate_name"
    return None


class KilnEmployeesConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id("kiln_employee_manager")
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Kiln Employee Manager", data={})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return KilnEmployeesOptionsFlow()


class KilnEmployeesOptionsFlow(config_entries.OptionsFlow):
    def _manager(self):
        return self.hass.data[DOMAIN][self.config_entry.entry_id]

    def _employees(self):
        return self._manager()["data"]["employees"]

    async def _save(self):
        manager = self._manager()
        await manager["store"].async_save(manager["data"])
        for listener in tuple(manager.get("listeners", ())):
            listener()

    async def async_step_init(self, user_input=None):
        """Show employee management options with explicit labels."""
        return self.async_show_menu(
            step_id="init",
            menu_options={
                "add": "Add Employee",
                "edit_select": "Edit Employee",
                "set_active_select": "Activate / Deactivate Employee",
                "delete_select": "Delete Employee",
                "list": "View Employees",
            },
        )

    async def async_step_add(self, user_input=None):
        if len(self._employees()) >= MAX_EMPLOYEES:
            return self.async_abort(reason="employee_limit")
        self._editing = False
        return await self.async_step_details(user_input)

    async def async_step_details(self, user_input=None):
        """One-screen editor for all employee settings."""
        existing = self._selected() if getattr(self, "_editing", False) else {}
        if existing is None:
            return self.async_abort(reason="employee_missing")
        errors = {}
        if user_input is not None:
            values = dict(user_input)
            # The unselected delivery method retains its prior value.
            # In 24/7 mode, retain last saved shift for switching back.
            for key, default in (
                ("phone", ""),
                ("mobile_notify_service", ""),
                ("workdays", DAYS[:5]),
                ("shift_start", "06:00"),
                ("shift_end", "16:00"),
                ("buffer_before", 15),
                ("buffer_after", 15),
            ):
                if key not in values or values[key] in (None, ""):
                    values[key] = existing.get(key, default)
            values["all_day"] = bool(values.get("all_day", False))
            values["use_mobile_app"] = bool(values.get("use_mobile_app", False))
            error = validate_employee(
                values, self._employees(), exclude_id=existing.get("id")
            )
            if (not error and values["use_mobile_app"] and
                    values.get("mobile_notify_service") not in mobile_notification_services(self.hass)):
                error = "invalid_mobile_device"
            if error:
                errors["base"] = error
            else:
                values["shift_start"] = str(values["shift_start"])[:5]
                values["shift_end"] = str(values["shift_end"])[:5]
                values["name"] = values["name"].strip()
                values["phone"] = values["phone"].strip()
                if getattr(self, "_editing", False):
                    existing.update(values)
                else:
                    values["id"] = uuid4().hex
                    values["active"] = True
                    self._employees().append(values)
                await self._save()
                return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="details",
            data_schema=employee_schema(existing, mobile_notification_services(self.hass)),
            errors=errors,
        )

    def _selector(self):
        return vol.Schema({
            vol.Required("employee"): vol.In({
                e["id"]: e["name"] for e in self._employees() if e.get("id")
            })
        })

    def _selected(self):
        return next((e for e in self._employees()
                     if e.get("id") == getattr(self, "_employee_id", None)), None)

    async def async_step_edit_select(self, user_input=None):
        if not self._employees():
            return self.async_abort(reason="no_employees")
        if user_input is not None:
            self._employee_id = user_input["employee"]
            return await self.async_step_edit()
        return self.async_show_form(step_id="edit_select", data_schema=self._selector())

    async def async_step_edit(self, user_input=None):
        if self._selected() is None:
            return self.async_abort(reason="employee_missing")
        self._editing = True
        return await self.async_step_details()

    async def async_step_set_active_select(self, user_input=None):
        if not self._employees():
            return self.async_abort(reason="no_employees")
        if user_input is not None:
            self._employee_id = user_input["employee"]
            return await self.async_step_set_active()
        return self.async_show_form(step_id="set_active_select", data_schema=self._selector())

    async def async_step_set_active(self, user_input=None):
        employee = self._selected()
        if employee is None:
            return self.async_abort(reason="employee_missing")
        if user_input is not None:
            employee["active"] = bool(user_input["active"])
            await self._save()
            return self.async_create_entry(data={})
        return self.async_show_form(step_id="set_active", data_schema=vol.Schema({
            vol.Required("active", default=employee.get("active", True)): bool
        }), description_placeholders={"employee": employee["name"]})

    async def async_step_delete_select(self, user_input=None):
        if not self._employees():
            return self.async_abort(reason="no_employees")
        if user_input is not None:
            self._employee_id = user_input["employee"]
            return await self.async_step_delete_confirm()
        return self.async_show_form(step_id="delete_select", data_schema=self._selector())

    async def async_step_delete_confirm(self, user_input=None):
        employee = self._selected()
        if employee is None:
            return self.async_abort(reason="employee_missing")
        if user_input is not None:
            if user_input["confirm_delete"]:
                self._manager()["data"]["employees"] = [
                    e for e in self._employees() if e.get("id") != employee["id"]
                ]
                await self._save()
                return self.async_create_entry(data={})
            return self.async_abort(reason="delete_cancelled")
        return self.async_show_form(
            step_id="delete_confirm",
            data_schema=vol.Schema({vol.Required("confirm_delete", default=False): bool}),
            description_placeholders={"employee": employee["name"]},
        )

    async def async_step_list(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(data={})
        employees = self._employees()
        details = "\n".join(
            f"{e['name']} — {'Active' if e.get('active', True) else 'Deactivated'}"
            f" — {'SMS On' if e.get('sms_enabled') else 'SMS Off'}"
            f" — Kilns {', '.join(e.get('kilns', []))}"
            f" — {'Mobile push' if e.get('use_mobile_app') else 'SMS'}"
            for e in employees
        ) if employees else "No employees registered yet."
        return self.async_show_form(
            step_id="list", data_schema=vol.Schema({}),
            description_placeholders={"employees": details},
        )
