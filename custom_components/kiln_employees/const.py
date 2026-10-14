"""Shared constants for the Kiln Employee Manager integration."""

DOMAIN = "kiln_employees"
INTEGRATION_VERSION = "1.5.0"

# Persistent storage schema version.  Keep this separate from the integration
# version: changing code does not automatically require a data migration.
STORAGE_VERSION = 1
STORAGE_KEY = "kiln_employee_manager"

PANEL_URL_PATH = "kiln-employees"
PANEL_STATIC_URL = "/kiln-employees-static/panel.js"
PANEL_CACHE_VERSION = 16
COMPLETION_ENTITY = "sensor.kiln_3_completion_event"
WS_REGISTERED_KEY = f"{DOMAIN}_websocket_registered"
STATIC_REGISTERED_KEY = f"{DOMAIN}_static_registered"

