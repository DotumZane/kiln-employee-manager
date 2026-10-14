"""Persistent, per-employee manual time off switches."""
from homeassistant.components.switch import SwitchEntity
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
            entity = EmployeeManualTimeOff(manager, employee_id)
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
                registered = registry.async_get_entity_id('switch', DOMAIN, old.unique_id)
                if registered:
                    registry.async_remove(registered)
            hass.async_create_task(remove())
        for entity in entities.values():
            if entity.hass is not None:
                entity.async_write_ha_state()

    sync()
    manager['listeners'].add(sync)
    entry.async_on_unload(lambda: manager['listeners'].discard(sync))


class EmployeeManualTimeOff(SwitchEntity):
    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_icon = 'mdi:account-off'

    def __init__(self, manager, employee_id):
        self.manager = manager
        self.employee_id = employee_id
        self._attr_unique_id = f'kiln_employee_{employee_id}_manual_time_off'

    @property
    def employee(self):
        return next((e for e in self.manager['data']['employees']
                     if e.get('id') == self.employee_id), None)

    @property
    def name(self):
        e = self.employee
        return f"Kiln Employee {e['name']} Manual Time Off" if e else 'Kiln Employee Manual Time Off'

    @property
    def available(self):
        return self.employee is not None

    @property
    def is_on(self):
        e = self.employee
        return bool(e and e.get('manual_time_off', False))

    @property
    def extra_state_attributes(self):
        return {'employee_id': self.employee_id} if self.employee else {}

    async def _set(self, new_value):
        e = self.employee
        if not e:
            return
        previous = e.get('manual_time_off', False)
        e['manual_time_off'] = new_value
        try:
            await self.manager['store'].async_save(self.manager['data'])
        except Exception:
            e['manual_time_off'] = previous
            raise
        for listener in tuple(self.manager.get('listeners', ())):
            listener()
        self.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        await self._set(True)

    async def async_turn_off(self, **kwargs):
        await self._set(False)
