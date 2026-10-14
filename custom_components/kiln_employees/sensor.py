"""Read-only employee shift details for the employee dashboard."""
from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities):
    manager = hass.data[DOMAIN][entry.entry_id]
    entities = {}

    @callback
    def sync():
        employees = {e['id'] for e in manager['data']['employees'] if e.get('id')}
        new = []
        for employee_id in employees - entities.keys():
            entity = EmployeeShift(manager, employee_id)
            entities[employee_id] = entity
            new.append(entity)
        if new:
            async_add_entities(new)
        for employee_id in set(entities) - employees:
            old = entities.pop(employee_id)
            async def remove(old=old):
                if old.hass is not None:
                    await old.async_remove()
                registry = er.async_get(hass)
                registered = registry.async_get_entity_id('sensor', DOMAIN, old.unique_id)
                if registered:
                    registry.async_remove(registered)
            hass.add_job(remove())
        for entity in entities.values():
            if entity.hass is not None:
                entity.async_write_ha_state()

    sync()
    manager['listeners'].add(sync)
    entry.async_on_unload(lambda: manager['listeners'].discard(sync))


class EmployeeShift(SensorEntity):
    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = 'mdi:calendar-clock'

    def __init__(self, manager, employee_id):
        self.manager = manager
        self.employee_id = employee_id
        self._attr_unique_id = f'kiln_employee_{employee_id}_shift'

    @property
    def employee(self):
        return next((e for e in self.manager['data']['employees']
                     if e.get('id') == self.employee_id), None)

    @property
    def name(self):
        e = self.employee
        return f"Kiln Employee {e['name']} Shift" if e else 'Kiln Employee Shift'

    @property
    def available(self):
        return self.employee is not None

    @property
    def native_value(self):
        e = self.employee
        if not e:
            return None
        return f"{e.get('shift_start', '--:--')[:5]} – {e.get('shift_end', '--:--')[:5]}"

    @property
    def extra_state_attributes(self):
        e = self.employee
        if not e:
            return {}
        return {
            'employee_id': self.employee_id,
            'workdays': e.get('workdays', []),
            'buffer_before_minutes': e.get('buffer_before', 15),
            'buffer_after_minutes': e.get('buffer_after', 15),
            'assigned_kilns': e.get('kilns', []),
            'active': e.get('active', True),
        }
