"""Notification dispatcher for Kiln Employee Manager (mobile push only)."""
import logging
from datetime import datetime, timezone

_LOGGER = logging.getLogger(__name__)


def get_mobile_action(hass, employee):
    """Return validated service name; never dispatch to an unregistered target."""
    if not employee.get("use_mobile_app"):
        raise ValueError("Employee uses SMS, which is not configured yet")
    service = employee.get("mobile_notify_service", "")
    if not isinstance(service, str) or not service.startswith("notify.mobile_app_"):
        raise ValueError("Employee has no valid Home Assistant mobile device")
    domain, name = service.split(".", 1)
    if not hass.services.has_service(domain, name):
        raise ValueError("Selected mobile notification service is unavailable")
    return domain, name


async def send_mobile(hass, employee, title, message):
    domain, service = get_mobile_action(hass, employee)
    await hass.services.async_call(domain, service, {"title": title, "message": message}, blocking=True)
    _LOGGER.info("Mobile notification action completed for employee ID %s", employee.get("id"))
    return {"result": "submitted", "method": "mobile_app", "time": datetime.now(timezone.utc).isoformat()}
