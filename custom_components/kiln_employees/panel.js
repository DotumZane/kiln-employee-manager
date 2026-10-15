// Kiln Employee Manager — Home Assistant admin-only sidebar panel (v1.10.0).
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

class KilnEmployeesPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = [];
    this.employeeStatuses = {};
    this.devices = [];
    this.settings = {};
    this.history = [];
    this.timeOff = [];
    this.timeOffMigrated = false;
    this.entities = {};
    this.additionalEntities = [];
    this.plcData = {};
    this.entityRows = [];
    this.timeOffSelected = '';
    this.editTimeOff = null;
    this.showPastTimeOff = false;
    this.current = null;
    this.mode = 'list';
    this.tab = 'employees';
    this.kilnTab = 'overview';
    this.busy = false;
    this.loaded = false;
    this.error = '';
    this.notice = '';
    this._refreshTimer = null;
  }

  connectedCallback() {
    if (this._refreshTimer !== null) return;
    this._refreshTimer = window.setInterval(() => {
      // Never overwrite partially edited forms. Only the read-only Raw PLC
      // Data page is refreshed automatically; settings pages must remain
      // stable while the user edits them.
      if (this.loaded && !this.busy && this.mode === 'list' &&
          this.tab === 'kilns' && this.kilnTab === 'plc') {
        this.load();
      }
    }, 2000);
  }

  disconnectedCallback() {
    if (this._refreshTimer !== null) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  set hass(value) {
    this._hass = value;
    if (!this.loaded && value?.connection) {
      this.loaded = true;
      this.load();
    }
  }
  get hass() { return this._hass; }

  async call(type, payload = {}) {
    return this.hass.connection.sendMessagePromise({
      type: `kiln_employees/${type}`,
      ...payload,
    });
  }

  async load() {
    try {
      const response = await this.call('list');
      this.data = response.employees || [];
      this.employeeStatuses = response.employee_statuses || {};
      this.devices = response.devices || [];
      this.settings = response.settings || {};
      this.history = response.history || [];
      this.timeOff = response.time_off || [];
      this.timeOffMigrated = Boolean(response.time_off_migrated);
      this.entities = response.entities || {};
      this.additionalEntities = response.additional_entities || [];
      this.plcData = response.plc_data || {};
      if (!this.data.some(employee => employee.id === this.timeOffSelected)) {
        this.timeOffSelected = this.data[0]?.id || '';
      }
      this.error = '';
    } catch (error) {
      this.error = String(error.message || error);
    }
    this.render();
  }

  el(tag, props = {}) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') element.textContent = value;
      else if (key === 'class') element.className = value;
      else if (key === 'checked') element.checked = value;
      else if (key === 'value') element.value = value;
      else if (key === 'type') element.type = value;
      else if (key === 'placeholder') element.placeholder = value;
      else if (key === 'title') element.title = value;
    }
    return element;
  }

  field(container, label, name, type = 'text', value = '', options = null) {
    const wrap = this.el('label', { class: type === 'checkbox' ? 'check' : 'field' });
    let input;
    if (type === 'select') {
      input = this.el('select');
      for (const [optionValue, optionLabel] of options) {
        const option = this.el('option', { text: optionLabel });
        option.value = optionValue;
        input.append(option);
      }
      input.value = value;
      wrap.append(this.el('span', { text: label }), input);
    } else if (type === 'checkbox') {
      input = this.el('input', { type: 'checkbox', checked: Boolean(value) });
      wrap.append(input, this.el('span', { text: label }));
    } else {
      input = this.el('input', { type, value });
      wrap.append(this.el('span', { text: label }), input);
    }
    input.name = name;
    container.append(wrap);
    return input;
  }

  numberField(container, label, name, value, min, max, hint) {
    const input = this.field(container, label, name, 'number', String(value));
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.required = true;
    input.inputMode = 'numeric';
    if (hint) container.append(this.el('div', { class: 'muted hint', text: hint }));
    return input;
  }

  static parseIntInRange(input, min, max) {
    const value = input.value.trim();
    if (!/^\d+$/.test(value)) throw new Error(`Enter a whole number from ${min} to ${max}.`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      throw new Error(`Enter a whole number from ${min} to ${max}.`);
    }
    return number;
  }

  static formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || 'Unknown time');
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  static historyLabel(kind) {
    return {
      alert_plc_lost: 'PLC Communication Lost',
      alert_plc_restored: 'PLC Communication Restored',
      alert_kiln_paused: 'Kiln #3 Paused',
      kiln_completion: 'Kiln #3 Stopped',
    }[kind] || String(kind || 'Notification');
  }

  render() {
    const shadow = this.shadowRoot;
    shadow.replaceChildren();
    const style = this.el('style');
    style.textContent = `
      :host{display:block;color:var(--primary-text-color);font-family:Arial,sans-serif;background:var(--primary-background-color);min-height:100vh}
      .shell{max-width:1000px;margin:auto;padding:22px}
      .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .section-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:4px}
      .section-top h2,.section-top h3{margin:0}
      h1{font-size:25px;margin:0 0 16px}h2{font-size:19px;margin:6px 0 12px}h3{font-size:16px;margin:12px 0}
      .card{background:var(--card-background-color,#fff);border:1px solid var(--divider-color,#ccc);padding:18px;border-radius:14px;margin:12px 0}
      .employee{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
      .muted{color:var(--secondary-text-color);font-size:13px}.hint{margin:-4px 0 10px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
      .field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;margin:10px 0}
      input,select{background:var(--card-background-color,#fff);color:var(--primary-text-color);border:1px solid var(--divider-color,#aaa);border-radius:8px;padding:11px;font:inherit;box-sizing:border-box;width:100%}
      input[type=checkbox]{width:20px;height:20px;accent-color:var(--primary-color,#1976d2)}
      .check{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:14px}
      .entity-row{position:relative;border-bottom:1px solid var(--divider-color);padding:4px 120px 10px 0;margin-bottom:8px;min-height:54px}
      .entity-status{font-size:13px;margin-top:4px}.entity-status.ok{color:var(--success-color,#2e9d62)}
      .entity-add-row{display:grid;grid-template-columns:1fr 1fr auto;align-items:end;gap:10px;margin:10px 0}
      .entity-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .entity-actions{position:absolute;right:0;top:7px;display:flex;gap:8px;margin:0}
      @media (max-width:550px){.entity-row{padding-right:0;padding-bottom:52px}.entity-actions{top:auto;bottom:8px}}
      .days{display:flex;flex-wrap:wrap;gap:8px}.days label{border:1px solid var(--divider-color,#aaa);border-radius:8px;padding:8px;display:flex;gap:5px;align-items:center;font-size:13px}.days input{width:16px}
      button{background:var(--primary-color,#1976d2);border:0;border-radius:9px;color:white;padding:11px 16px;cursor:pointer;font-size:14px}
      button.secondary,.tabs button{background:var(--secondary-background-color,#777);color:var(--primary-text-color)}
      button.danger{background:#b3261e;color:white}button:disabled{opacity:.5;cursor:default}
      .actions,.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      .tabs button.active{background:var(--primary-color,#1976d2);color:white}
      .error{background:#ffe6e6;color:#8b0000;padding:12px;border-radius:8px}
      .notice{border:1px solid var(--success-color,#228b22);padding:12px;border-radius:8px}
      .note{padding:12px;border-left:3px solid var(--primary-color);background:var(--secondary-background-color);border-radius:6px}
      hr{border:0;border-top:1px solid var(--divider-color);margin:20px 0}
      .recipients{width:100%;border-collapse:collapse;margin-top:10px}
      .recipients th,.recipients td{border-bottom:1px solid var(--divider-color);padding:11px 7px;text-align:left}
      .recipients th:not(:first-child),.recipients td:not(:first-child){text-align:center}
      .recipients td input{width:20px;height:20px}
      .matrix-wrap{overflow-x:auto}.matrix{min-width:900px}.matrix th{vertical-align:top;font-size:12px}.matrix th input{min-width:125px;font-size:12px;font-weight:400}.matrix td{white-space:nowrap;font-size:13px}
      .pill{display:inline-block;font-size:12px;color:var(--secondary-text-color)}
      .status-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--divider-color);border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;white-space:nowrap;background:var(--secondary-background-color)}
      .status-badge.active{border-color:#4aa67a;color:var(--primary-text-color);background:rgba(28,132,79,.12)}
      .status-badge.off{border-color:#a58b45;color:var(--primary-text-color);background:rgba(165,139,69,.12)}
      .status-badge.vacation{border-color:#d6a043;color:var(--primary-text-color);background:rgba(214,160,67,.13)}
      .status-badge.inactive{opacity:.7}
      .status-badge.unavailable{border-color:#c45d5d;color:var(--primary-text-color)}
      .metric{padding:12px;border:1px solid var(--divider-color);border-radius:10px;background:var(--secondary-background-color)}
      .metric-value{font-size:18px;font-weight:700;margin-top:4px}
      .signal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
      details.card>summary{cursor:pointer;font-size:16px;font-weight:700;list-style:none}
      details.card>summary::-webkit-details-marker{display:none}
      details.card>summary:before{content:'＋';display:inline-block;margin-right:8px;color:var(--primary-color,#1976d2)}
      details.card[open]>summary:before{content:'−'}
      .employee-info{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}
      .employee-info h2{margin:0}
      .employee-status-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      .employee-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .history-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}
      .history-details{display:flex;flex-direction:column;gap:4px;min-width:0}
      .history-kind{font-weight:700}
      .history-count{white-space:nowrap;color:var(--secondary-text-color);font-size:13px}
      .date-input{cursor:pointer}
      .date-input.active{border-color:var(--primary-color,#1976d2);outline:2px solid var(--primary-color,#1976d2);outline-offset:1px}
      .calendar-wrap{max-width:480px;width:100%;border:1px solid var(--divider-color);border-radius:14px;padding:16px;background:var(--card-background-color);box-sizing:border-box;margin:12px 0 18px}
      .calendar-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      .calendar-title{font-weight:700;font-size:17px;text-align:center}
      .calendar-nav{background:var(--secondary-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);padding:8px 13px;font-size:18px}
      .calendar-hint{font-size:13px;color:var(--secondary-text-color);margin:0 0 10px}
      .calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
      .calendar-weekday{text-align:center;color:var(--secondary-text-color);font-size:12px;font-weight:700;padding:5px 0}
      .calendar-empty{min-height:43px}
      .calendar-day{min-height:43px;width:100%;padding:4px 0;border:1px solid transparent;border-radius:9px;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:14px;font-weight:600}
      .calendar-day:hover{border-color:var(--primary-color,#1976d2)}
      .calendar-day.today{outline:1px solid var(--primary-color,#1976d2)}
      .calendar-day.in-range{background:rgba(40,143,191,.20)}
      .calendar-day.selected{background:var(--primary-color,#1976d2);color:white}
      .calendar-day.time-off-day:not(.selected){text-decoration:underline;text-decoration-color:#d6a043;text-decoration-thickness:2px;text-underline-offset:4px}
      .calendar-footer{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px}
      .calendar-footer button{padding:8px 11px}
      @media (max-width:550px){.shell{padding:14px}.calendar-wrap{padding:10px}.calendar-grid{gap:3px}.calendar-day{min-height:38px;font-size:13px}}
      [hidden]{display:none!important}
    `;
    shadow.append(style);
    const shell = this.el('div', { class: 'shell' });
    shadow.append(shell);
    if (this.error) shell.append(this.el('div', { class: 'error', text: this.error }));
    if (this.notice) shell.append(this.el('div', { class: 'notice', text: this.notice }));
    if (this.mode === 'edit') {
      this.renderEditor(shell);
      return;
    }
    this.renderTabs(shell);
    if (this.tab === 'alerts') this.renderManageAlerts(shell);
    else if (this.tab === 'entities') this.renderEntities(shell);
    else if (this.tab === 'timeoff') this.renderTimeOff(shell);
    else if (this.tab === 'history') this.renderHistory(shell);
    else if (this.tab === 'kilns') this.renderKilns(shell);
    else this.renderEmployees(shell);
  }

  renderTabs(shell) {
    const top = this.el('div', { class: 'section-top' });
    top.append(this.el('h1', { text: 'Kiln Employee Manager' }));
    const refresh = this.el('button', { text: 'Refresh', class: 'secondary' });
    refresh.onclick = () => { this.notice = ''; this.load(); };
    top.append(refresh);
    shell.append(top);
    const bar = this.el('nav', { class: 'tabs' });
    for (const [id, label] of [['employees', 'Employees'], ['timeoff', 'Time Off'], ['alerts', 'Manage Alerts'], ['kilns', 'Kilns'], ['entities', 'Entities'], ['history', 'Notification History']]) {
      const button = this.el('button', { text: label, class: this.tab === id ? 'active' : '' });
      button.type = 'button';
      button.onclick = () => {
        this.tab = id;
        this.notice = '';
        this.error = '';
        this.render();
        if (id === 'kilns' && ['3', 'plc'].includes(this.kilnTab)) this.load();
      };
      bar.append(button);
    }
    shell.append(bar);
  }

  renderEmployees(shell) {
    const top = this.el('div', { class: 'section-top' });
    top.append(this.el('h2', { text: 'Employees' }));
    const add = this.el('button', { text: '+ Add Employee' });
    add.onclick = () => { this.current = null; this.mode = 'edit'; this.notice = ''; this.render(); };
    top.append(add);
    shell.append(top);
    shell.append(this.el('p', { class: 'muted', text: `${this.data.length} of 10 employees. Status follows the saved work schedule, not physical attendance. Kiln #3 stop notifications are driven by the Node-RED status entity; PLC communication alerts are managed under Manage Alerts.` }));
    if (!this.data.length) shell.append(this.el('div', { class: 'card', text: 'No employees added yet.' }));
    for (const employee of this.data) {
      const card = this.el('div', { class: 'card employee' });
      const details = this.el('div', { class: 'employee-info' });
      const heading = this.el('div', { class: 'employee-status-line' });
      heading.append(this.el('h2', { text: employee.name }));
      const currentStatus = this.employeeStatuses[employee.id] || { label: 'Checking Status', kind: 'inactive', eligible: false };
      heading.append(this.el('span', { class: `status-badge ${currentStatus.kind}`, text: currentStatus.label }));
      details.append(heading);
      const shift = employee.all_day ? '24/7' : `${(employee.workdays || []).map(day => day.slice(0, 3)).join(', ')} · ${employee.shift_start || ''}–${employee.shift_end || ''}`;
      details.append(this.el('div', { class: 'muted', text: `${shift} · ${employee.use_mobile_app ? 'App' : 'SMS'} · Kilns ${(employee.kilns || []).join(', ')}` }));
      const alertSummary = employee.sms_enabled === false ? 'Notifications: Disabled'
        : currentStatus.eligible ? 'Notifications: Eligible' : 'Notifications: Not eligible';
      details.append(this.el('div', { class: 'muted', text: alertSummary }));
      card.append(details);
      const actions = this.el('div', { class: 'employee-actions' });
      const edit = this.el('button', { text: 'Edit' });
      edit.onclick = () => { this.current = employee; this.mode = 'edit'; this.notice = ''; this.render(); };
      actions.append(edit);
      card.append(actions);
      shell.append(card);
    }
  }

  renderTimeOff(shell) {
    const top = this.el('div', { class: 'section-top' });
    top.append(this.el('h2', { text: 'Employee Time Off' }));
    shell.append(top);
    shell.append(this.el('p', { class: 'muted', text: 'Select an employee and the first and last day off, then save. Both dates are included. Time off automatically blocks PLC alert eligibility.' }));

    const record = this.editTimeOff || {};
    const form = this.el('form', { class: 'card' });
    shell.append(form);
    form.append(this.el('h3', { text: record.id ? 'Edit Time Off' : 'Add Time Off' }));
    if (!this.data.length) {
      form.append(this.el('p', { class: 'muted', text: 'Add an employee before scheduling time off.' }));
      return;
    }
    const selected = record.employee_id || this.timeOffSelected || this.data[0].id;
    const employeeOptions = this.data.map(employee => [employee.id, employee.name]);
    const employee = this.field(form, 'Employee', 'employee_id', 'select', selected, employeeOptions);
    employee.onchange = () => { this.timeOffSelected = employee.value; };
    const grid = this.el('div', { class: 'grid' });
    form.append(grid);
    // Read-only text fields avoid Safari's very small native calendar popup.
    // The larger inline calendar below is shared by Start and End dates.
    const start = this.field(grid, 'First Day Off', 'start_date', 'text', record.start_date || '');
    const end = this.field(grid, 'Last Day Off', 'end_date', 'text', record.end_date || '');
    start.readOnly = true;
    end.readOnly = true;
    start.placeholder = 'Choose first day';
    end.placeholder = 'Choose last day';
    start.required = true;
    end.required = true;
    form.append(this.el('p', { class: 'muted', text: 'Click a date field to open the calendar. It closes after you choose the last day.' }));
    this.mountVacationCalendar(form, employee, start, end);
    const reason = this.field(form, 'Reason', 'reason', 'select', record.reason || 'Vacation',
      [['Vacation', 'Vacation'], ['Personal Day', 'Personal Day'], ['Sick Day', 'Sick Day'], ['Other', 'Other']]);
    const actions = this.el('div', { class: 'actions' });
    const save = this.el('button', { text: record.id ? 'Save Changes' : 'Add Time Off' });
    save.type = 'submit';
    actions.append(save);
    if (record.id) {
      const cancel = this.el('button', { class: 'secondary', text: 'Cancel Editing' });
      cancel.type = 'button';
      cancel.onclick = () => { this.editTimeOff = null; this.render(); };
      actions.append(cancel);
    }
    form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault();
      if (this.busy) return;
      if (!start.value || !end.value || end.value < start.value) {
        this.error = 'Choose a valid first and last day. The last day must not be earlier than the first.';
        this.render();
        return;
      }
      this.busy = true;
      save.disabled = true;
      try {
        await this.call('time_off_save', { time_off: {
          ...(record.id ? { id: record.id } : {}),
          employee_id: employee.value,
          start_date: start.value,
          end_date: end.value,
          reason: reason.value,
        }});
        this.timeOffSelected = employee.value;
        this.editTimeOff = null;
        this.notice = 'Time off saved. Eligibility will now reflect these dates.';
        this.error = '';
        await this.load();
      } catch (error) {
        this.error = String(error.message || error);
        this.render();
      } finally { this.busy = false; }
    };

    const listCard = this.el('div', { class: 'card' });
    shell.append(listCard);
    const listTop = this.el('div', { class: 'section-top' });
    listTop.append(this.el('h3', { text: 'Scheduled Time Off' }));
    const togglePast = this.el('label', { class: 'check' });
    const show = this.el('input', { type: 'checkbox', checked: this.showPastTimeOff });
    togglePast.append(show, this.el('span', { text: 'Show past dates' }));
    show.onchange = () => { this.showPastTimeOff = show.checked; this.render(); };
    listTop.append(togglePast);
    listCard.append(listTop);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const records = [...this.timeOff].filter(item => this.showPastTimeOff || item.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date));
    if (!records.length) {
      listCard.append(this.el('p', { class: 'muted', text: 'No scheduled time off to display.' }));
    }
    for (const item of records) {
      const row = this.el('div', { class: 'employee' });
      const employeeName = this.data.find(e => e.id === item.employee_id)?.name || '(Deleted employee)';
      const desc = this.el('div');
      desc.append(this.el('strong', { text: employeeName }));
      desc.append(this.el('div', { class: 'muted', text: `${item.start_date} through ${item.end_date} · ${item.reason || 'Vacation'}${item.start_date <= today && today <= item.end_date ? ' · ACTIVE' : ''}` }));
      row.append(desc);
      const controls = this.el('div', { class: 'actions' });
      const edit = this.el('button', { class: 'secondary', text: 'Edit' });
      edit.type = 'button';
      edit.onclick = () => { this.editTimeOff = item; this.timeOffSelected = item.employee_id; this.notice = ''; this.render(); };
      const del = this.el('button', { class: 'danger', text: 'Cancel Time Off' });
      del.type = 'button';
      del.onclick = async () => {
        if (this.busy || !confirm(`Cancel ${employeeName}'s time off from ${item.start_date} through ${item.end_date}?`)) return;
        this.busy = true;
        del.disabled = true;
        try {
          await this.call('time_off_delete', { time_off_id: item.id });
          this.editTimeOff = null;
          this.notice = 'Time off canceled.';
          this.error = '';
          await this.load();
        } catch (error) {
          this.error = String(error.message || error);
          this.render();
        } finally { this.busy = false; }
      };
      controls.append(edit, del);
      row.append(controls);
      listCard.append(row);
      listCard.append(this.el('hr'));
    }
  }

  mountVacationCalendar(form, employeeSelect, start, end) {
    // This custom month view is consistently readable on Safari, desktop, and mobile.
    // Values remain ISO YYYY-MM-DD so the existing backend and all-day vacation logic
    // require no changes.
    const wrap = this.el('div', { class: 'calendar-wrap' });
    form.append(wrap);
    const initial = /^\d{4}-\d{2}-\d{2}$/.test(start.value) ? start.value : '';
    const now = new Date();
    let year = initial ? Number(initial.slice(0, 4)) : now.getFullYear();
    let month = initial ? Number(initial.slice(5, 7)) - 1 : now.getMonth();
    let choosing = 'start';
    let isOpen = false;
    wrap.hidden = true;
    const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const currentDay = iso(now.getFullYear(), now.getMonth(), now.getDate());
    const show = () => {
      if (!isOpen) { wrap.hidden = true; return; }
      wrap.hidden = false;
      wrap.replaceChildren();
      const heading = this.el('div', { class: 'calendar-heading' });
      const previous = this.el('button', { class: 'calendar-nav', text: '‹', title: 'Previous month' });
      previous.type = 'button';
      previous.onclick = () => { month -= 1; if (month < 0) { month = 11; year -= 1; } show(); };
      const title = this.el('div', { class: 'calendar-title', text: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1))) });
      const next = this.el('button', { class: 'calendar-nav', text: '›', title: 'Next month' });
      next.type = 'button';
      next.onclick = () => { month += 1; if (month > 11) { month = 0; year += 1; } show(); };
      heading.append(previous, title, next);
      wrap.append(heading);
      wrap.append(this.el('p', { class: 'calendar-hint', text: choosing === 'start' ? 'Select the FIRST day off' : 'Select the LAST day off (or the same date for one day)' }));
      const grid = this.el('div', { class: 'calendar-grid' });
      wrap.append(grid);
      for (const label of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) grid.append(this.el('div', { class: 'calendar-weekday', text: label }));
      const padding = new Date(Date.UTC(year, month, 1)).getUTCDay();
      const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      for (let i = 0; i < padding; i++) grid.append(this.el('span', { class: 'calendar-empty' }));
      const offDays = (this.timeOff || []).filter(item => item.employee_id === employeeSelect.value);
      for (let day = 1; day <= count; day++) {
        const date = iso(year, month, day);
        const isSelected = date === start.value || date === end.value;
        const isRange = start.value && end.value && start.value < date && date < end.value;
        const hasTimeOff = offDays.some(item => item.start_date <= date && date <= item.end_date);
        const classes = ['calendar-day'];
        if (date === currentDay) classes.push('today');
        if (isSelected) classes.push('selected');
        if (isRange) classes.push('in-range');
        if (hasTimeOff) classes.push('time-off-day');
        const button = this.el('button', { class: classes.join(' '), text: String(day), title: date });
        button.type = 'button';
        button.setAttribute('aria-label', date);
        if (isSelected) button.setAttribute('aria-pressed', 'true');
        button.onclick = () => {
          if (choosing === 'start') {
            start.value = date;
            // An old end before the new start would be invalid.
            if (end.value && end.value < date) end.value = '';
            choosing = 'end';
          } else {
            if (start.value && date < start.value) {
              // Selecting an earlier last day starts a new range instead.
              start.value = date;
              end.value = '';
              choosing = 'end';
            } else {
              end.value = date;
              close();
              return;
            }
          }
          updateFocused();
          show();
        };
        grid.append(button);
      }
      const footer = this.el('div', { class: 'calendar-footer' });
      const today = this.el('button', { class: 'secondary', text: 'Go to Today' });
      today.type = 'button';
      today.onclick = () => { year = now.getFullYear(); month = now.getMonth(); show(); };
      const same = this.el('button', { class: 'secondary', text: 'One Day Only' });
      same.type = 'button';
      same.disabled = !start.value;
      same.onclick = () => { end.value = start.value; close(); };
      const dismiss = this.el('button', { class: 'secondary', text: 'Close' });
      dismiss.type = 'button';
      dismiss.onclick = () => close();
      footer.append(today, same, dismiss);
      wrap.append(footer);
    };
    const updateFocused = () => {
      start.classList.toggle('active', isOpen && choosing === 'start');
      end.classList.toggle('active', isOpen && choosing === 'end');
      start.setAttribute('aria-expanded', String(isOpen && choosing === 'start'));
      end.setAttribute('aria-expanded', String(isOpen && choosing === 'end'));
    };
    const close = () => {
      isOpen = false;
      wrap.hidden = true;
      updateFocused();
    };
    const moveTo = (target, dateValue) => {
      if (isOpen && choosing === target) { close(); return; }
      choosing = target;
      isOpen = true;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        year = Number(dateValue.slice(0, 4));
        month = Number(dateValue.slice(5, 7)) - 1;
      }
      updateFocused();
      show();
    };
    for (const [field, target] of [[start, 'start'], [end, 'end']]) {
      field.classList.add('date-input');
      field.setAttribute('aria-label', target === 'start' ? 'First day off. Select from calendar.' : 'Last day off. Select from calendar.');
      field.addEventListener('click', () => moveTo(target, field.value));
      field.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); moveTo(target, field.value); } });
    }
    employeeSelect.addEventListener('change', show);
    form.addEventListener('pointerdown', event => {
      if (isOpen && !wrap.contains(event.target) && event.target !== start && event.target !== end) close();
    });
    wrap.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); start.focus(); }
    });
    updateFocused();
  }

  renderEntities(shell) {
    shell.append(this.el('h2', { text: 'Entity Settings' }));
    shell.append(this.el('p', { class: 'muted', text: 'Each entity can be edited independently. Home Assistant checks the entity state after saving.' }));
    const card = this.el('div', { class: 'card' });
    shell.append(card);
    const persist = async (entities, additionalEntities) => {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.call('save_entities', { entities, additional_entities: additionalEntities });
        this.notice = 'Entity saved.';
        this.entityEditingKey = null;
        this.additionalEditingIndex = null;
        await this.load();
      } catch (error) {
        this.error = String(error.message || error);
        this.render();
      } finally {
        this.busy = false;
      }
    };
    const currentEntities = () => Object.fromEntries(
      Object.entries(this.entities).map(([key, info]) => [key, info.entity_id])
    );
    const currentAdditional = () => this.additionalEntities.map(info => ({
      name: info.label,
      entity_id: info.entity_id,
    }));
    card.append(this.el('h3', { text: 'Active Integration Entities' }));
    for (const [key, info] of Object.entries(this.entities)) {
      const row = this.el('div', { class: 'entity-row' });
      const heading = this.el('div', { class: 'entity-heading' });
      heading.append(this.el('strong', { text: info.label }));
      const actions = this.el('div', { class: 'entity-actions' });
      if (this.entityEditingKey === key) {
        const input = this.el('input', { type: 'text', value: info.entity_id });
        input.setAttribute('aria-label', `${info.label} entity ID`);
        const save = this.el('button', { text: 'Save' });
        save.type = 'button';
        save.onclick = () => persist({ ...currentEntities(), [key]: input.value.trim() }, currentAdditional());
        const cancel = this.el('button', { text: 'Cancel', class: 'secondary' });
        cancel.type = 'button';
        cancel.onclick = () => { this.entityEditingKey = null; this.render(); };
        row.append(heading, input);
        actions.append(save, cancel);
      } else {
        const edit = this.el('button', { text: 'Edit', class: 'secondary' });
        edit.type = 'button';
        edit.onclick = () => { this.entityEditingKey = key; this.notice = ''; this.render(); };
        row.append(heading, this.el('div', { class: 'muted', text: info.entity_id }));
        actions.append(edit);
      }
      const status = info.exists ? `${info.state}${info.friendly_name ? ` · ${info.friendly_name}` : ''}` : 'Entity not found';
      row.append(this.el('div', { class: info.exists ? 'entity-status ok' : 'entity-status error', text: status }), actions);
      card.append(row);
    }
    card.append(this.el('hr'));
    card.append(this.el('h3', { text: 'Additional Entities' }));
    card.append(this.el('p', { class: 'muted', text: 'These can be removed or edited independently. Saving an entity does not enable an alert by itself.' }));
    if (!this.additionalEntities.length) {
      card.append(this.el('p', { class: 'muted', text: 'No additional entities configured.' }));
    }
    this.additionalEntities.forEach((info, index) => {
      const row = this.el('div', { class: 'entity-row' });
      const heading = this.el('div', { class: 'entity-heading' });
      heading.append(this.el('strong', { text: info.label }));
      const actions = this.el('div', { class: 'entity-actions' });
      if (this.additionalEditingIndex === index) {
        const name = this.el('input', { type: 'text', value: info.label });
        const entity = this.el('input', { type: 'text', value: info.entity_id });
        name.setAttribute('aria-label', 'Additional entity name');
        entity.setAttribute('aria-label', 'Additional entity ID');
        const save = this.el('button', { text: 'Save' });
        save.type = 'button';
        save.onclick = () => {
          const additional = currentAdditional();
          additional[index] = { name: name.value.trim(), entity_id: entity.value.trim() };
          persist(currentEntities(), additional);
        };
        const cancel = this.el('button', { text: 'Cancel', class: 'secondary' });
        cancel.type = 'button';
        cancel.onclick = () => {
          if (info.isNew) this.additionalEntities.splice(index, 1);
          this.additionalEditingIndex = null;
          this.render();
        };
        row.append(heading, name, entity);
        actions.append(save, cancel);
      } else {
        const edit = this.el('button', { text: 'Edit', class: 'secondary' });
        edit.type = 'button';
        edit.onclick = () => { this.additionalEditingIndex = index; this.render(); };
        const remove = this.el('button', { text: 'Remove', class: 'secondary' });
        remove.type = 'button';
        remove.onclick = () => persist(currentEntities(), currentAdditional().filter((_, itemIndex) => itemIndex !== index));
        row.append(heading, this.el('div', { class: 'muted', text: info.entity_id }));
        actions.append(edit, remove);
      }
      const status = info.exists ? `${info.state}${info.friendly_name ? ` · ${info.friendly_name}` : ''}` : 'Entity not found';
      row.append(this.el('div', { class: info.exists ? 'entity-status ok' : 'entity-status error', text: status }), actions);
      card.append(row);
    });
    const add = this.el('button', { text: '+ Add Entity', class: 'secondary' });
    add.type = 'button';
    add.onclick = () => {
      this.additionalEntities.push({ label: 'New Entity', entity_id: '', isNew: true });
      this.additionalEditingIndex = this.additionalEntities.length - 1;
      this.render();
    };
    card.append(add);
  }

  renderManageAlerts(shell) {
    shell.append(this.el('h2', { text: 'Manage Alerts' }));
    shell.append(this.el('div', { class: 'note', text: 'These delays apply globally, not per employee. Kiln #3 stop notifications use sensor.kiln_3_status with the exact state Stopped / Idle. Paused alerts use the exact state Paused.' }));
    const form = this.el('form', { class: 'card' });
    shell.append(form);
    form.append(this.el('h3', { text: 'Global PLC Communication Delays' }));
    const grid = this.el('div', { class: 'grid' });
    form.append(grid);
    const lost = this.numberField(grid, 'Communication Lost Delay (seconds)', 'lost', this.settings.plc_lost_delay_seconds ?? 30, 0, 3600);
    const restored = this.numberField(grid, 'Communication Restored Delay (seconds)', 'restored', this.settings.plc_restored_delay_seconds ?? 15, 0, 3600);
    form.append(this.el('p', { class: 'muted', text: 'Whole seconds (0–3600). A value of 0 means the next monitor check, not literally instantaneous. The existing PLC heartbeat detector has its own delay before Home Assistant reports offline.' }));
    form.append(this.el('hr'));
    form.append(this.el('h3', { text: 'Kiln #3 Paused Alert' }));
    const paused = this.numberField(form, 'Send after paused for (seconds)', 'paused', this.settings.kiln_paused_delay_seconds ?? 300, 0, 3600);
    form.append(this.el('p', { class: 'muted', text: 'The timer starts when sensor.kiln_3_status changes to exactly Paused and resets when the status changes. A value of 0 sends on the next monitor check.' }));
    form.append(this.el('hr'));
    form.append(this.el('h3', { text: 'Kiln #3 — Alert Recipients' }));
    form.append(this.el('p', { class: 'muted', text: 'Communication and paused alerts are always active. Choose which employees receive each alert. Their assigned kiln, shift/24/7, vacation, manual Time Off, and notification-enabled setting are still respected. Only App notifications send currently; SMS is not configured.' }));
    const table = this.el('table', { class: 'recipients' });
    const header = this.el('tr');
    for (const label of ['Employee', 'Communication Lost', 'Communication Restored', 'Kiln Paused']) header.append(this.el('th', { text: label }));
    table.append(header);
    const recipientRows = [];
    for (const employee of this.data) {
      const row = this.el('tr');
      const name = this.el('td');
      name.append(this.el('div', { text: employee.name }));
      if (!(employee.kilns || []).includes('3')) name.append(this.el('div', { class: 'muted', text: 'Not assigned to Kiln #3' }));
      row.append(name);
      const flags = [];
      for (const key of ['alert_plc_lost', 'alert_plc_restored', 'alert_kiln_paused']) {
        const cell = this.el('td');
        const check = this.el('input', { type: 'checkbox', checked: employee[key] ?? false });
        const label = key === 'alert_plc_lost' ? 'Communication Lost' : key === 'alert_plc_restored' ? 'Communication Restored' : 'Kiln Paused';
        check.setAttribute('aria-label', `${employee.name}: ${label}`);
        cell.append(check);
        row.append(cell);
        flags.push(check);
      }
      table.append(row);
      recipientRows.push({ employee_id: employee.id, lost: flags[0], restored: flags[1], paused: flags[2] });
    }
    form.append(table);
    if (!this.data.length) form.append(this.el('p', { class: 'muted', text: 'Add an employee first to assign alert recipients.' }));
    const save = this.el('button', { text: 'Save Alert Settings' });
    save.type = 'submit';
    const saveActions = this.el('div', { class: 'actions' });
    saveActions.append(save);
    form.append(saveActions);
    form.onsubmit = async event => {
      event.preventDefault();
      if (this.busy) return;
      let lostSeconds, restoredSeconds, pausedSeconds;
      try {
        lostSeconds = KilnEmployeesPanel.parseIntInRange(lost, 0, 3600);
        restoredSeconds = KilnEmployeesPanel.parseIntInRange(restored, 0, 3600);
        pausedSeconds = KilnEmployeesPanel.parseIntInRange(paused, 0, 3600);
      } catch (error) {
        this.error = error.message;
        this.render();
        return;
      }
      this.busy = true;
      save.disabled = true;
      try {
        await this.call('save_alert_settings', {
          plc_lost_delay_seconds: lostSeconds,
          plc_restored_delay_seconds: restoredSeconds,
          kiln_paused_delay_seconds: pausedSeconds,
          recipients: recipientRows.map(row => ({ employee_id: row.employee_id, lost: row.lost.checked, restored: row.restored.checked, paused: row.paused.checked })),
        });
        this.notice = 'Alert settings and recipients saved.';
        await this.load();
      } catch (error) {
        this.error = String(error.message || error);
        this.render();
      } finally {
        this.busy = false;
      }
    };
  }

  renderHistory(shell) {
    shell.append(this.el('h2', { text: 'Notification History' }));
    shell.append(this.el('p', { class: 'muted', text: 'These entries record notification submissions, not proof that phones displayed a message.' }));
    if (!this.history.length) {
      shell.append(this.el('div', { class: 'card', text: 'No notification attempts recorded yet.' }));
      return;
    }
    const card = this.el('div', { class: 'card' });
    shell.append(card);
    const items = [...this.history].reverse();
    items.forEach((item, index) => {
      const submitted = (item.deliveries || []).filter(delivery => delivery.result === 'submitted').length;
      const row = this.el('div', { class: 'history-row' });
      const details = this.el('div', { class: 'history-details' });
      details.append(this.el('div', { class: 'history-kind', text: KilnEmployeesPanel.historyLabel(item.kind) }));
      details.append(this.el('div', { class: 'muted', text: KilnEmployeesPanel.formatTimestamp(item.timestamp) }));
      row.append(details, this.el('div', { class: 'history-count', text: `${submitted} submitted` }));
      card.append(row);
      if (index < items.length - 1) card.append(this.el('hr'));
    });
  }

  renderKilns(shell) {
    shell.append(this.el('h2', { text: 'Kilns' }));
    shell.append(this.el('p', { class: 'muted', text: 'Kiln-specific status, entity mappings, alarms, and operating configuration.' }));
    const nav = this.el('div', { class: 'actions' });
    for (const [id, label] of [['overview', 'All Kilns'], ['1', 'Kiln 1'], ['2', 'Kiln 2'], ['3', 'Kiln 3'], ['plc', 'Raw PLC Data']]) {
      const button = this.el('button', { text: label, class: this.kilnTab === id ? '' : 'secondary' });
      button.type = 'button';
      button.onclick = () => {
        this.kilnTab = id;
        this.notice = '';
        this.error = '';
        this.render();
        if (['3', 'plc'].includes(id)) this.load();
      };
      nav.append(button);
    }
    shell.append(nav);

    if (this.kilnTab === 'plc') {
      this.renderPlcData(shell);
      return;
    }
    if (this.kilnTab === 'overview') {
      const card = this.el('div', { class: 'card' });
      card.append(this.el('h3', { text: 'Kiln Configuration' }));
      card.append(this.el('p', { class: 'muted', text: 'Select a kiln to configure its PLC/MQTT signals, notifications, alarms, and future schedule-specific behavior.' }));
      [['1', 'Kiln 1', 'Configuration will be added when Kiln 1 monitoring is brought into the integration.'],
       ['2', 'Kiln 2', 'Configuration will be added when Kiln 2 monitoring is brought into the integration.'],
       ['3', 'Kiln 3', `Live status: ${this.plcData.last_status || 'Unknown'}`]].forEach(([id, name, description]) => {
        const row = this.el('div', { class: 'employee' });
        const info = this.el('div', { class: 'employee-info' });
        info.append(this.el('h3', { text: name }), this.el('div', { class: 'muted', text: description }));
        const open = this.el('button', { text: 'Open' });
        open.onclick = () => { this.kilnTab = id; this.render(); if (id === '3') this.load(); };
        row.append(info, open);
        card.append(row);
      });
      shell.append(card);
      return;
    }
    if (this.kilnTab === '3') {
      this.renderKilnThree(shell);
      return;
    }
    const card = this.el('div', { class: 'card' });
    card.append(this.el('h3', { text: `Kiln ${this.kilnTab} Configuration` }));
    card.append(this.el('p', { class: 'muted', text: 'This kiln page is ready for its PLC tag mappings, MQTT signals, alarms, and notification rules.' }));
    shell.append(card);
  }

  renderKilnThree(shell) {
    const data = this.plcData || {};
    const raw = data.raw && typeof data.raw === 'object' ? data.raw : {};
    const status = data.last_status || 'Unknown';
    const communication = this.entities.kiln_3_plc_communication || {};
    const statusCard = this.el('div', { class: 'card' });
    const heading = this.el('div', { class: 'section-top' });
    heading.append(this.el('h3', { text: 'Kiln 3 Monitoring' }));
    const badge = this.el('span', { class: `status-badge ${status === 'Running' ? 'active' : status === 'Unknown' ? 'unavailable' : 'off'}`, text: status });
    heading.append(badge);
    statusCard.append(heading);
    statusCard.append(this.el('p', { class: 'muted', text: 'This page shows what Kiln 3 is doing now and whether Home Assistant is receiving good data from the PLC.' }));
    const metrics = this.el('div', { class: 'grid' });
    [
      ['PLC clock', data.last_clock ?? 'Unknown'],
      ['Data quality', data.data_valid ? 'Valid data' : 'Waiting for valid data'],
      ['PLC connection', communication.state === 'on' ? 'Connected' : communication.state === 'off' ? 'Disconnected' : 'Unknown'],
      ['Last raw message', KilnEmployeesPanel.formatTimestamp(data.last_received)],
    ].forEach(([label, value]) => {
      const item = this.el('div', { class: 'metric' });
      item.append(this.el('div', { class: 'muted', text: label }), this.el('div', { class: 'metric-value', text: String(value) }));
      metrics.append(item);
    });
    statusCard.append(metrics);
    shell.append(statusCard);

    const signals = this.el('details', { class: 'card' });
    const signalSummary = this.el('summary', { text: 'Advanced PLC details' });
    signals.append(signalSummary);
    signals.append(this.el('p', { class: 'muted', text: 'These live signals help determine whether Kiln 3 is running, paused, or stopped.' }));
    const signalGrid = this.el('div', { class: 'signal-grid' });
    [
      ['Kiln 3 On', 'Kiln1_ON'],
      ['Kiln 3 Pause', 'Kiln1_Pause'],
      ['Kiln 3 Normal Stop', 'Program:Kiln1.Normal_Stop'],
      ['Kiln 3 Down', 'Program:Kiln1.Kiln_Down'],
      ['Kiln 3 Step Number', 'Program:Kiln1.Step_Number'],
      ['Kiln 3 Step Stop', 'Program:Kiln1.Step_Stop'],
    ].forEach(([label, key]) => {
      const item = this.el('div', { class: 'metric' });
      item.append(this.el('div', { class: 'muted', text: label }), this.el('div', { class: 'metric-value', text: raw[key] === undefined ? 'Missing' : String(raw[key]) }));
      signalGrid.append(item);
    });
    signals.append(signalGrid);
    shell.append(signals);

    const config = this.el('div', { class: 'card' });
    config.append(this.el('h3', { text: 'Kiln 3 Settings' }));
    config.append(this.el('p', { class: 'muted', text: 'Choose what counts as a completed kiln cycle and open the other Kiln 3 settings.' }));
    config.append(this.el('div', { class: 'muted', text: `Data source: PLC data received through MQTT (${data.topic || 'Unknown'})` }));
    const kilnConfigs = this.settings.kiln_configs || {};
    const kilnThreeConfig = kilnConfigs['3'] || {};
    config.append(this.el('hr'));
    config.append(this.el('h3', { text: 'Kiln 3 State Signals' }));
    config.append(this.el('p', { class: 'muted', text: 'Each column is a Home Assistant entity. The rows show the values expected for each kiln state. Change an entity ID here if another kiln uses different entities.' }));
    const entityDefaults = {
      status: 'sensor.kiln_3_status',
      paused: 'binary_sensor.kiln_3_paused',
      normal_stop: 'binary_sensor.kiln_3_normal_stop',
      down: 'binary_sensor.kiln_3_down',
      current_step: 'sensor.kiln_3_current_step',
      final_step: 'sensor.kiln_3_final_step',
      communication: 'binary_sensor.kiln_3_plc_communication',
    };
    const signalEntities = { ...entityDefaults, ...(kilnThreeConfig.signal_entities || {}) };
    const signalColumns = [
      ['status', 'Status entity'], ['paused', 'Paused entity'],
      ['normal_stop', 'Normal Stop entity'], ['down', 'Kiln Down entity'],
      ['current_step', 'Current Step entity'], ['final_step', 'Final Step entity'],
      ['communication', 'Connection entity'],
    ];
    const entityInputs = {};
    const matrixWrap = this.el('div', { class: 'matrix-wrap' });
    const matrix = this.el('table', { class: 'recipients matrix' });
    const matrixHeader = this.el('tr');
    matrixHeader.append(this.el('th', { text: 'Kiln state' }));
    signalColumns.forEach(([key, label]) => {
      const th = this.el('th');
      th.append(this.el('div', { text: label }));
      const input = this.el('input', { type: 'text', value: signalEntities[key] });
      input.setAttribute('aria-label', label);
      entityInputs[key] = input;
      th.append(input);
      matrixHeader.append(th);
    });
    matrix.append(matrixHeader);
    [
      ['Running', ['Running', 'off', 'Any', 'Any', 'Any', 'Any', 'on']],
      ['Paused', ['Paused', 'on', 'Any', 'Any', 'Any', 'Any', 'on']],
      ['Stopped / Idle', ['Stopped / Idle', 'off', 'Any', 'Any', 'Any', 'Any', 'on']],
    ].forEach(([state, values]) => {
      const row = this.el('tr');
      row.append(this.el('td', { text: state }));
      values.forEach(value => row.append(this.el('td', { text: value })));
      matrix.append(row);
    });
    matrixWrap.append(matrix);
    config.append(matrixWrap);
    config.append(this.el('hr'));
    config.append(this.el('h3', { text: 'When should “Kiln complete” be sent?' }));
    config.append(this.el('p', { class: 'muted', text: 'The integration waits for the kiln to stop, then checks this rule before notifying employees.' }));
    const completionForm = this.el('form');
    const completionRule = this.field(completionForm, 'Send the completion notification when', 'completion_rule', 'select', kilnThreeConfig.completion_rule || 'stopped_idle', [
      ['stopped_idle', 'The kiln stops (current default)'],
      ['normal_stop_or_down', 'Normal Stop or Kiln Down is reported'],
      ['normal_stop', 'Normal Stop is reported'],
      ['kiln_down', 'Kiln Down is reported'],
      ['final_step', 'The kiln reaches or passes the final step'],
    ]);
    const ruleHelp = this.el('div', { class: 'muted hint' });
    const descriptions = {
      stopped_idle: 'Sends when the kiln changes to Stopped / Idle.',
      normal_stop_or_down: 'Sends only when the stopped kiln also reports Normal Stop or Kiln Down.',
      normal_stop: 'Sends only when the stopped kiln reports Normal Stop.',
      kiln_down: 'Sends only when the stopped kiln reports Kiln Down.',
      final_step: 'Sends only when the stopped kiln is at or beyond its configured final step.',
    };
    const updateRuleHelp = () => { ruleHelp.textContent = descriptions[completionRule.value] || ''; };
    completionRule.onchange = updateRuleHelp;
    updateRuleHelp();
    completionForm.append(ruleHelp);
    const saveRule = this.el('button', { text: 'Save Kiln 3 Settings' });
    saveRule.type = 'submit';
    completionForm.append(this.el('div', { class: 'actions' }), saveRule);
    completionForm.onsubmit = async event => {
      event.preventDefault();
      if (this.busy) return;
      this.busy = true;
      saveRule.disabled = true;
      try {
        await this.call('save_kiln_config', {
          kiln_id: '3',
          completion_rule: completionRule.value,
          signal_entities: Object.fromEntries(Object.entries(entityInputs).map(([key, input]) => [key, input.value.trim()])),
        });
        this.notice = 'Kiln 3 completion rule saved.';
        await this.load();
      } catch (error) {
        this.error = String(error.message || error);
        this.render();
      } finally {
        this.busy = false;
      }
    };
    config.append(completionForm);
    const actions = this.el('div', { class: 'actions' });
    const openPage = (label, tab, kilnTab = this.kilnTab) => {
      const button = this.el('button', { text: label, class: 'secondary' });
      button.type = 'button';
      button.onclick = () => { this.tab = tab; this.kilnTab = kilnTab; this.render(); };
      actions.append(button);
    };
    openPage('View PLC Data', 'kilns', 'plc');
    openPage('Choose Home Assistant Entities', 'entities');
    openPage('Choose Alert Recipients and Delays', 'alerts');
    config.append(actions);
    shell.append(config);
  }

  renderPlcData(shell) {
    shell.append(this.el('h2', { text: 'Kiln #3 PLC Data' }));
    shell.append(this.el('p', { class: 'muted', text: 'Read-only diagnostic data received from Node-RED over MQTT. This page refreshes every 2 seconds while open. These values are not editable here.' }));
    const data = this.plcData || {};
    const card = this.el('div', { class: 'card' });
    const grid = this.el('div', { class: 'grid' });
    const fields = [
      ['MQTT topic', data.topic || 'Unknown'],
      ['Interpreted status', data.last_status || 'Unknown'],
      ['PLC clock', data.last_clock ?? 'Unknown'],
      ['Data valid', data.data_valid ? 'Yes' : 'No'],
      ['Last raw message', KilnEmployeesPanel.formatTimestamp(data.last_received)],
      ['Last clock change', KilnEmployeesPanel.formatTimestamp(data.last_clock_received)],
    ];
    fields.forEach(([label, value]) => {
      const item = this.el('div');
      item.append(this.el('div', { class: 'muted', text: label }));
      item.append(this.el('div', { text: String(value) }));
      grid.append(item);
    });
    card.append(grid);
    shell.append(card);

    const rawCard = this.el('div', { class: 'card' });
    rawCard.append(this.el('h3', { text: 'Raw PLC Tags' }));
    const table = this.el('table', { class: 'recipients' });
    const header = this.el('tr');
    header.append(this.el('th', { text: 'Tag' }), this.el('th', { text: 'Value' }));
    table.append(header);
    const raw = data.raw && typeof data.raw === 'object' ? data.raw : {};
    const entries = Object.entries(raw).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) {
      rawCard.append(this.el('p', { class: 'muted', text: 'No raw PLC data has been received yet.' }));
    } else {
      entries.forEach(([key, value]) => {
        const row = this.el('tr');
        row.append(this.el('td', { text: KilnEmployeesPanel.displayPlcTag(key) }), this.el('td', { text: value === null ? 'null' : String(value) }));
        table.append(row);
      });
      rawCard.append(table);
    }
    shell.append(rawCard);
  }

  static displayPlcTag(key) {
    const labels = {
      'Kiln1_ON': 'Kiln 3 On',
      'Kiln1_Pause': 'Kiln 3 Pause',
      'PLC_ClockValues[5]': 'Kiln 3 PLC Clock',
      'Program:Kiln1.Kiln_Down': 'Kiln 3 Down',
      'Program:Kiln1.Normal_Stop': 'Kiln 3 Normal Stop',
      'Program:Kiln1.Step_Number': 'Kiln 3 Step Number',
      'Program:Kiln1.Step_Stop': 'Kiln 3 Step Stop',
    };
    return labels[key] || key.replaceAll('Kiln1', 'Kiln 3');
  }

  renderEditor(shell) {
    const employee = this.current || {};
    const bar = this.el('div', { class: 'top' });
    bar.append(this.el('h1', { text: employee.id ? `Edit ${employee.name}` : 'Add Employee' }));
    const cancel = this.el('button', { text: '← Back', class: 'secondary' });
    cancel.onclick = () => { this.mode = 'list'; this.error = ''; this.render(); };
    bar.append(cancel);
    shell.append(bar);
    const form = this.el('form', { class: 'card' });
    shell.append(form);
    const name = this.field(form, 'Employee Name', 'name', 'text', employee.name || '');
    name.required = true;
    const app = this.field(form, 'Use Home Assistant App Instead of SMS', 'use_mobile_app', 'checkbox', employee.use_mobile_app || false);
    const phoneBox = this.el('div'), deviceBox = this.el('div');
    form.append(phoneBox, deviceBox);
    const phone = this.field(phoneBox, 'Phone Number (e.g. +15035550123)', 'phone', 'tel', employee.phone || '');
    const device = this.field(deviceBox, 'Mobile Device', 'mobile_notify_service', 'select', employee.mobile_notify_service || '',
      [['', 'Select a phone'], ...this.devices.map(item => [item.value, item.label])]);
    if (employee.mobile_notify_service && !this.devices.find(item => item.value === employee.mobile_notify_service)) {
      const option = this.el('option', { text: `${employee.mobile_notify_service} (unavailable)` });
      option.value = employee.mobile_notify_service;
      device.append(option);
      device.value = employee.mobile_notify_service;
    }
    const updateDevice = () => { phoneBox.hidden = app.checked; deviceBox.hidden = !app.checked; };
    app.onchange = updateDevice;
    updateDevice();
    form.append(this.el('hr'));
    const allDay = this.field(form, '24/7 Notifications', 'all_day', 'checkbox', employee.all_day || false);
    const schedule = this.el('div');
    form.append(schedule);
    schedule.append(this.el('h2', { text: 'Work Schedule' }));
    schedule.append(this.el('span', { text: 'Working days', class: 'muted' }));
    const dayBox = this.el('div', { class: 'days' });
    schedule.append(dayBox);
    const selected = new Set(employee.workdays || DAYS.slice(0, 5));
    const dayInputs = [];
    for (const day of DAYS) {
      const label = this.el('label');
      const input = this.el('input', { type: 'checkbox', checked: selected.has(day) });
      dayInputs.push([day, input]);
      label.append(input, this.el('span', { text: day.slice(0, 3) }));
      dayBox.append(label);
    }
    const times = this.el('div', { class: 'grid' });
    schedule.append(times);
    const start = this.field(times, 'Shift Start', 'shift_start', 'time', (employee.shift_start || '06:00').slice(0, 5));
    const end = this.field(times, 'Shift End', 'shift_end', 'time', (employee.shift_end || '16:00').slice(0, 5));
    const before = this.numberField(times, 'Notify Before Shift (minutes)', 'buffer_before', employee.buffer_before ?? 15, 0, 180);
    const after = this.numberField(times, 'Notify After Shift (minutes)', 'buffer_after', employee.buffer_after ?? 15, 0, 180);
    const updateSchedule = () => { schedule.hidden = allDay.checked; };
    allDay.onchange = updateSchedule;
    updateSchedule();
    form.append(this.el('hr'));
    form.append(this.el('h2', { text: 'Notifications' }));
    const enabled = this.field(form, 'Notifications Enabled', 'sms_enabled', 'checkbox', employee.sms_enabled ?? true);
    const active = this.field(form, 'Employee Active', 'active', 'checkbox', employee.active ?? true);
    form.append(this.el('span', { text: 'Kiln assignments', class: 'muted' }));
    const kilnBox = this.el('div', { class: 'days' });
    form.append(kilnBox);
    const kilnInputs = [];
    for (const kiln of ['1', '2', '3']) {
      const label = this.el('label');
      const input = this.el('input', { type: 'checkbox', checked: (employee.kilns || ['3']).includes(kiln) });
      kilnInputs.push([kiln, input]);
      label.append(input, this.el('span', { text: `Kiln ${kiln}` }));
      kilnBox.append(label);
    }
    form.append(this.el('div', { class: 'note', text: '24/7 bypasses shift restrictions only. Vacation, manual Time Off, deactivation, and disabled notifications still block eligibility. Alert recipients are managed separately under Manage Alerts.' }));
    const actions = this.el('div', { class: 'actions' });
    form.append(actions);
    const save = this.el('button', { text: 'Save Employee' });
    save.type = 'submit';
    actions.append(save);
    if (employee.id) {
      const test = this.el('button', { text: 'Send Test Notification', class: 'secondary' });
      test.type = 'button';
      test.onclick = async () => {
        if (this.busy) return;
        if (!app.checked) { this.error = 'Select App notifications and save before testing.'; this.render(); return; }
        if (!confirm(`Send one test notification to ${employee.name}'s saved mobile device?`)) return;
        this.busy = true;
        test.disabled = true;
        try {
          await this.call('test_notification', { employee_id: employee.id });
          this.error = '';
          alert(`Test notification submitted for ${employee.name}. Check the selected device.`);
        } catch (error) {
          this.error = String(error.message || error);
          this.render();
        } finally { this.busy = false; test.disabled = false; }
      };
      actions.append(test);
      const del = this.el('button', { text: 'Delete Employee', class: 'danger' });
      del.type = 'button';
      del.onclick = async () => {
        if (!confirm(`Permanently delete ${employee.name}?`)) return;
        try {
          await this.call('delete', { employee_id: employee.id });
          this.mode = 'list';
          this.notice = 'Employee deleted.';
          await this.load();
        } catch (error) {
          this.error = String(error.message || error);
          this.render();
        }
      };
      actions.append(del);
    }
    form.onsubmit = async event => {
      event.preventDefault();
      if (this.busy) return;
      let beforeMinutes, afterMinutes;
      try {
        beforeMinutes = KilnEmployeesPanel.parseIntInRange(before, 0, 180);
        afterMinutes = KilnEmployeesPanel.parseIntInRange(after, 0, 180);
      } catch (error) {
        this.error = error.message;
        this.render();
        return;
      }
      this.busy = true;
      save.disabled = true;
      const payload = {
        id: employee.id,
        name: name.value.trim(),
        use_mobile_app: app.checked,
        phone: phone.value.trim(),
        mobile_notify_service: device.value,
        all_day: allDay.checked,
        workdays: dayInputs.filter(([, input]) => input.checked).map(([day]) => day),
        shift_start: start.value,
        shift_end: end.value,
        buffer_before: beforeMinutes,
        buffer_after: afterMinutes,
        kilns: kilnInputs.filter(([, input]) => input.checked).map(([kiln]) => kiln),
        sms_enabled: enabled.checked,
        active: active.checked,
      };
      try {
        await this.call('save', { employee: payload });
        this.mode = 'list';
        this.notice = 'Employee saved.';
        await this.load();
      } catch (error) {
        this.error = String(error.message || error);
        this.render();
      } finally { this.busy = false; }
    };
  }
}

if (!customElements.get('kiln-employees-panel')) {
  customElements.define('kiln-employees-panel', KilnEmployeesPanel);
}
