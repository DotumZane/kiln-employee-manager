# Kiln Employee Manager

Home Assistant custom integration for employee scheduling, time off, alert
eligibility, and mobile notification routing for kiln operations.

## Installation with HACS

Add this repository to HACS as a custom **Integration** repository. HACS will
install the integration under `custom_components/kiln_employees` and provide
versioned updates from GitHub.

After installing or updating Python code, restart Home Assistant once so the
new integration modules are loaded. Runtime employee and alert settings can be
reloaded through the Home Assistant integration reload control.

## Current version

The current release is **1.9.2**. See
[`custom_components/kiln_employees/CHANGELOG.md`](custom_components/kiln_employees/CHANGELOG.md)
for release notes.

## Node-RED completion signal

Node-RED remains responsible for deciding when a charge is complete. It must
publish a new changing value to `sensor.kiln_3_completion_event` for each
completed charge. The value is used only as an internal deduplication token and
is not included in the employee notification. The integration sends:

> Kiln #3 has stopped. Check whether the drying schedule completed or the kiln was manually stopped.
