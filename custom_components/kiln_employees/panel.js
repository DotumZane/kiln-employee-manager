// Kiln Employee Manager — Home Assistant admin-only sidebar panel (v1.6.4).
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
    this.timeOffSelected = '';
    this.editTimeOff = null;
    this.showPastTimeOff = false;
    this.current = null;
    this.mode = 'list';
    this.tab = 'employees';
    this.busy = false;
    this.loaded = false;
    this.error = '';
    this.notice = '';
    this._refreshTimer = null;
  }

  connectedCallback() {
    if (this._refreshTimer !== null) return;
    this._refreshTimer = window.setInterval(() => {
      // Never overwrite partially edited employee or time-off forms.
      if (this.loaded && !this.busy && this.mode === 'list' && this.tab === 'employees') {
        this.load();
      }
    }, 60000);
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
      .pill{display:inline-block;font-size:12px;color:var(--secondary-text-color)}
      .status-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--divider-color);border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;white-space:nowrap;background:var(--secondary-background-color)}
      .status-badge.active{border-color:#4aa67a;color:var(--primary-text-color);background:rgba(28,132,79,.12)}
      .status-badge.off{border-color:#a58b45;color:var(--primary-text-color);background:rgba(165,139,69,.12)}
      .status-badge.vacation{border-color:#d6a043;color:var(--primary-text-color);background:rgba(214,160,67,.13)}
      .status-badge.inactive{opacity:.7}
      .status-badge.unavailable{border-color:#c45d5d;color:var(--primary-text-color)}
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
    else if (this.tab === 'timeoff') this.renderTimeOff(shell);
    else if (this.tab === 'history') this.renderHistory(shell);
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
    for (const [id, label] of [['employees', 'Employees'], ['timeoff', 'Time Off'], ['alerts', 'Manage Alerts'], ['history', 'Notification History']]) {
      const button = this.el('button', { text: label, class: this.tab === id ? 'active' : '' });
      button.type = 'button';
      button.onclick = () => { this.tab = id; this.notice = ''; this.error = ''; this.render(); };
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
    shell.append(this.el('p', { class: 'muted', text: `${this.data.length} of 10 employees. Status follows the saved work schedule, not physical attendance. Kiln #3 stop notifications are driven by the Node-RED completion event; PLC communication alerts are managed under Manage Alerts.` }));
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

  renderManageAlerts(shell) {
    shell.append(this.el('h2', { text: 'Manage Alerts' }));
    shell.append(this.el('div', { class: 'note', text: 'These delays apply globally, not per employee. Kiln #3 stop notifications use the Node-RED completion event. Future equipment-alarm delivery is not enabled.' }));
    const form = this.el('form', { class: 'card' });
    shell.append(form);
    form.append(this.el('h3', { text: 'Global PLC Communication Delays' }));
    const grid = this.el('div', { class: 'grid' });
    form.append(grid);
    const lost = this.numberField(grid, 'Communication Lost Delay (seconds)', 'lost', this.settings.plc_lost_delay_seconds ?? 30, 0, 3600);
    const restored = this.numberField(grid, 'Communication Restored Delay (seconds)', 'restored', this.settings.plc_restored_delay_seconds ?? 15, 0, 3600);
    form.append(this.el('p', { class: 'muted', text: 'Whole seconds (0–3600). A value of 0 means the next monitor check, not literally instantaneous. The existing PLC heartbeat detector has its own delay before Home Assistant reports offline.' }));
    const enableLost = this.field(form, 'Enable PLC Communication Lost Alerts', 'plc_lost_enabled', 'checkbox', this.settings.plc_lost_enabled ?? true);
    const enableRestored = this.field(form, 'Enable PLC Communication Restored Alerts', 'plc_restored_enabled', 'checkbox', this.settings.plc_restored_enabled ?? true);
    form.append(this.el('hr'));
    form.append(this.el('h3', { text: 'Kiln #3 — Alert Recipients' }));
    form.append(this.el('p', { class: 'muted', text: 'Choose which employees receive each alert. Their assigned kiln, shift/24/7, vacation, manual Time Off, and notification-enabled setting are still respected. Only App notifications send currently; SMS is not configured.' }));
    const table = this.el('table', { class: 'recipients' });
    const header = this.el('tr');
    for (const label of ['Employee', 'Communication Lost', 'Communication Restored']) header.append(this.el('th', { text: label }));
    table.append(header);
    const recipientRows = [];
    for (const employee of this.data) {
      const row = this.el('tr');
      const name = this.el('td');
      name.append(this.el('div', { text: employee.name }));
      if (!(employee.kilns || []).includes('3')) name.append(this.el('div', { class: 'muted', text: 'Not assigned to Kiln #3' }));
      row.append(name);
      const flags = [];
      for (const key of ['alert_plc_lost', 'alert_plc_restored']) {
        const cell = this.el('td');
        const check = this.el('input', { type: 'checkbox', checked: employee[key] ?? false });
        check.setAttribute('aria-label', `${employee.name}: ${key === 'alert_plc_lost' ? 'Communication Lost' : 'Communication Restored'}`);
        cell.append(check);
        row.append(cell);
        flags.push(check);
      }
      table.append(row);
      recipientRows.push({ employee_id: employee.id, lost: flags[0], restored: flags[1] });
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
      let lostSeconds, restoredSeconds;
      try {
        lostSeconds = KilnEmployeesPanel.parseIntInRange(lost, 0, 3600);
        restoredSeconds = KilnEmployeesPanel.parseIntInRange(restored, 0, 3600);
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
          plc_lost_enabled: enableLost.checked,
          plc_restored_enabled: enableRestored.checked,
          recipients: recipientRows.map(row => ({ employee_id: row.employee_id, lost: row.lost.checked, restored: row.restored.checked })),
        });
        this.notice = 'Global PLC alert settings and recipients saved.';
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

customElements.define('kiln-employees-panel', KilnEmployeesPanel);
