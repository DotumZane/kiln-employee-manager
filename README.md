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

The current release is **1.6.0**. See
[`custom_components/kiln_employees/CHANGELOG.md`](custom_components/kiln_employees/CHANGELOG.md)
for release notes.

## Node-RED completion signal

Node-RED remains responsible for deciding when a charge is complete. It must
publish a new unique value to `sensor.kiln_3_completion_id` for each completed
charge. The integration treats each new value as one completion event and
sends this notification to eligible Kiln #3 employees:

> Kiln #3 has completed its drying schedule. Charge ID: `<completion_id>`.
