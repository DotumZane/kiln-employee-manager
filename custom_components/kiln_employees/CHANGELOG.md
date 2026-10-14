# Kiln Employee Manager changelog

## 1.6.0

- Added Node-RED-driven Kiln #3 completion notifications.
- Uses `sensor.kiln_3_completion_id` as a unique per-charge identifier.
- Persists processed completion IDs to prevent duplicate notifications after restarts.
- Notifies only eligible employees assigned to Kiln #3.

## 1.5.0

- Added shared constants in `const.py` to remove the `__init__.py` import coupling.
- Made config-entry unload/reload lifecycle handling safer.
- Prevented duplicate registration of the process-global WebSocket commands.
- Prevented duplicate registration of the frontend static path during reloads.
- Added explicit frontend cache versioning (`panel.js?v=15`).
- Kept persistent storage schema version `1`; no employee or vacation data migration is required.

## 1.4.0

- Compact Time Off calendar interface.
