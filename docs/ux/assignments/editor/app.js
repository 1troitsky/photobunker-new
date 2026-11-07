/* PhotoBunker UX Fieldwork editor. All data are synthetic and remain on this page.
   No network, encryption, storage, Identity or production routing is used here. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const device = document.getElementById('device');
  const overlay = document.getElementById('dialog-overlay');
  const dialog = overlay.querySelector('.dialog-sheet');
  const dialogTitle = document.getElementById('dialog-title');
  const dialogContent = document.getElementById('dialog-content');
  const scroll = document.getElementById('editor-content');
  const statusLabel = document.getElementById('status-label');
  const statusLed = document.querySelector('.state-led');
  const panes = ['basics', 'camera', 'participants', 'rules'];
  const roleLabels = { curator: 'Куратор', contributor: 'Исполнитель', viewer: 'Наблюдатель' };
  const photoScopeLabels = { default: 'По правилам задания', none: 'Без доступа к фото', thumbnails: 'Только миниатюры', all: 'Полный доступ' };
  const demoPeople = [
    { id: 1, name: 'Анна', role: 'curator', photoScope: 'all' },
    { id: 2, name: 'Марк', role: 'contributor', photoScope: 'default' }
  ];
  const demoTeams = {
    'Site A Crew': demoPeople,
    'Репортаж': [
      { id: 3, name: 'Ольга', role: 'curator', photoScope: 'default' },
      { id: 4, name: 'Давид', role: 'contributor', photoScope: 'thumbnails' },
      { id: 5, name: 'Никита', role: 'contributor', photoScope: 'default' }
    ],
    '': []
  };
  const contacts = { 3: 'Ольга', 4: 'Давид', 5: 'Никита' };
  const state = { tab: 'basics', team: 'Site A Crew', people: structuredClone(demoPeople), sheet: '', selectedPerson: null, lastFocus: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
  const field = name => app.querySelector('[name="' + name + '"]');
  const lines = value => value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const option = (action, label, attrs = '') =>
    '<button type="button" data-sheet="' + action + '" ' + attrs + '>' + esc(label) + '</button>';

  function setTab(tab) {
    if (!panes.includes(tab)) return;
    state.tab = tab;
    app.querySelectorAll('[data-tab]').forEach(button => {
      const current = button.dataset.tab === tab;
      button.classList.toggle('selected', current);
      button.setAttribute('aria-selected', String(current));
      button.tabIndex = current ? 0 : -1;
    });
    app.querySelectorAll('[data-pane]').forEach(node => { node.hidden = node.dataset.pane !== tab; });
    scroll.scrollTop = 0;
  }
  function markChanged() {
    document.getElementById('draft-state').textContent = 'Изменено';
    document.getElementById('draft-caption').textContent = 'Изменения в макете';
    document.getElementById('form-error').hidden = true;
  }
  function syncDependencies() {
    app.querySelectorAll('[data-toggle]').forEach(toggle => {
      app.querySelectorAll('[data-dep="' + toggle.dataset.toggle + '"]').forEach(node => {
        node.hidden = !toggle.checked;
      });
    });
  }
  function renderPeople() {
    const container = document.getElementById('people-list');
    container.innerHTML =
      '<div class="person-row owner"><span class="person-avatar">Я</span><span class="person-data"><strong>Вы</strong><small>Владелец</small></span><span class="person-check">✓</span></div>' +
      state.people.map(person =>
        '<div class="person-row"><span class="person-avatar">' + esc(person.name.slice(0, 1).toUpperCase()) + '</span>' +
        '<span class="person-data"><strong>' + esc(person.name) + '</strong><small>' +
        esc(roleLabels[person.role] + ' · ' + photoScopeLabels[person.photoScope]) + '</small></span>' +
        '<button type="button" data-action="edit-person" data-person="' + person.id + '" aria-label="Настроить: ' + esc(person.name) + '">›</button></div>'
      ).join('');
    document.getElementById('people-count').textContent = (state.people.length + 1) + ' чел.';
  }
  function openDialog(kind, title, html) {
    state.lastFocus = document.activeElement;
    state.sheet = kind;
    dialogTitle.textContent = title;
    dialogContent.innerHTML = html;
    overlay.hidden = false;
    dialog.focus();
  }
  function closeDialog() {
    overlay.hidden = true;
    state.sheet = '';
    state.selectedPerson = null;
    if (state.lastFocus && state.lastFocus.isConnected) state.lastFocus.focus();
    state.lastFocus = null;
  }
  function message(title, html) {
    openDialog('message', title,
      '<div class="dialog-note">' + html + '</div>' + option('close', 'Понятно', 'class="primary-action"'));
  }
  function personEditor(person) {
    const editing = Boolean(person);
    const contactsList = Object.entries(contacts).filter(([id]) =>
      !state.people.some(p => p.id === Number(id))
    );
    const contactPicker = editing ? '<div class="dialog-note">Участник: ' + esc(person.name) + '</div>' :
      '<div class="dialog-note">Выбери контакт. В приложении список загружается из настоящих контактов пользователя.</div>' +
      '<label>Контакт<select id="person-contact">' +
      (contactsList.length ? contactsList.map(([id, name]) =>
        '<option value="' + id + '">' + esc(name) + '</option>').join('') :
        '<option value="">Нет доступных контактов</option>') +
      '</select></label>';
    const roles = Object.entries(roleLabels).map(([key, label]) =>
      '<option value="' + key + '"' + ((person ? person.role : 'contributor') === key ? ' selected' : '') + '>' + label + '</option>').join('');
    const scopes = Object.entries(photoScopeLabels).map(([key, label]) =>
      '<option value="' + key + '"' + ((person ? person.photoScope : 'default') === key ? ' selected' : '') + '>' + label + '</option>').join('');
    const saveAttrs = !editing && !contactsList.length ? 'disabled' : '';
    return contactPicker +
      '<label>Роль<select id="person-role">' + roles + '</select></label>' +
      '<label>Доступ к фотографиям<select id="person-scope">' + scopes + '</select></label>' +
      option('save-person', editing ? 'Сохранить изменения' : 'Добавить участника',
        'class="primary-action" ' + saveAttrs) +
      (editing ? option('remove-person', 'Удалить участника', 'class="danger"') : '');
  }
  function resetDemo() {
    field('name').value = 'Фасады — Site A';
    field('instructions').value = 'Снять фасад здания с разных ракурсов, включая детали входной группы. Обратить внимание на качество освещения.';
    field('startsAt').value = '2026-11-07T09:00';
    field('finishesAt').value = '2026-11-20T18:00';
    field('presetId').value = 'standard';
    field('targetCount').value = '30';
    field('shots').value = 'Главный фасад\nЛевый ракурс\nПравый ракурс\nВходная группа';
    field('categories').value = 'Фасад\nДетали\nВходная группа';
    field('minLength').value = '10';
    const defaults = {
      useAssignmentPhotoId: true, categoryRequired: false,
      particularCategory: false, descriptionRequired: false,
      changesAllowed: true, keepOriginal: true, deletionAllowed: true,
      galleryAllowed: true, thumbnailsOnly: false, sharingAllowed: true,
      participantsOnly: false, publicEnabled: true, publicContributor: false,
      publicCapturedAt: false, publicEditedAt: false, publicLocation: true,
      publicDescription: true, publicTags: false, publicMetadata: false
    };
    Object.entries(defaults).forEach(([key, checked]) => { field(key).checked = checked; });
    app.querySelector('[data-toggle="deadline"]').checked = false;
    state.people = structuredClone(demoPeople);
    state.team = 'Site A Crew';
    document.getElementById('team-name').textContent = state.team;
    document.getElementById('team-caption').textContent = 'Выбрана команда';
    document.getElementById('shots-count').textContent = '4 пункта в плане';
    document.getElementById('draft-state').textContent = 'Черновик';
    document.getElementById('draft-caption').textContent = 'Демонстрационный черновик';
    document.getElementById('form-error').hidden = true;
    renderPeople();
    syncDependencies();
    setTab('basics');
  }
  function validate() {
    if (!field('name').value.trim()) return { tab: 'basics', target: field('name'), error: 'Укажи название задания.' };
    const start = field('startsAt').value;
    const finish = field('finishesAt').value;
    if (app.querySelector('[data-toggle="deadline"]').checked &&
      (!finish || (start && new Date(finish) <= new Date(start)))) {
      return { tab: 'basics', target: field('finishesAt'), error: 'Окончание должно быть позже начала.' };
    }
    const target = Number(field('targetCount').value);
    if (!Number.isInteger(target) || target < 1 || target > 9999) {
      return { tab: 'camera', target: field('targetCount'), error: 'Количество фотографий: от 1 до 9999.' };
    }
    const shots = lines(field('shots').value);
    if (shots.length > 100 || shots.some(x => x.length > 80)) {
      return { tab: 'camera', target: field('shots'), error: 'Максимум 100 пунктов, не более 80 символов каждый.' };
    }
    if (field('particularCategory').checked && !lines(field('categories').value).length) {
      return { tab: 'rules', target: field('categories'), error: 'Заполни список разрешённых категорий.' };
    }
    if (lines(field('categories').value).length > 30 ||
      lines(field('categories').value).some(x => x.length > 80)) {
      return { tab: 'rules', target: field('categories'), error: 'Максимум 30 категорий, не более 80 символов каждая.' };
    }
    const minLength = Number(field('minLength').value);
    if (!Number.isInteger(minLength) || minLength < 1 || minLength > 2000) {
      return { tab: 'rules', target: field('minLength'), error: 'Минимальная длина описания: 1–2000.' };
    }
    if (state.people.length > 100) {
      return { tab: 'participants', target: document.getElementById('people-list'), error: 'Слишком много участников.' };
    }
    return null;
  }
  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !app.contains(button)) return;
    if (button.dataset.tab) { setTab(button.dataset.tab); return; }
    const action = button.dataset.action;
    if (action === 'close') { closeDialog(); return; }
    if (action === 'back') {
      message('Назад к заданиям', 'В реальном приложении кнопка возвращает на предыдущий экран по истории. Этот прототип не подключён к маршрутам.');
      return;
    }
    if (action === 'info') {
      message('Редактор задания', 'Те же четыре раздела, что в текущем PhotoBunker: Основное, Камера, Участники, Правила. Public Card находится в конце правил, в общем стиле переключателей. Данные не отправляются на сервер.');
      return;
    }
    if (action === 'status') {
      openDialog('status', 'Состояние приложения',
        '<div class="dialog-note">Это демонстрация. В production статус отображает реальные операции.</div>' +
        ['В работе', 'Загрузка', 'Подключение', 'Офлайн', 'Ошибка', 'Готово']
          .map(name => option('set-status', name, 'data-value="' + name + '"')).join(''));
      return;
    }
    if (action === 'preset') {
      openDialog('preset', 'Пресеты камеры',
        option('choose-preset', 'Standard', 'data-value="standard"') +
        option('choose-preset', 'Fieldwork · Высокое качество', 'data-value="field"') +
        option('choose-preset', 'Быстрая съёмка', 'data-value="fast"') +
        '<div class="dialog-note">В приложении «Создать пресет» открывает настоящий редактор и сохраняет контекст задания. Здесь можно переключить демонстрационный пресет.</div>');
      return;
    }
    if (action === 'team') {
      openDialog('team', 'Выбрать команду',
        option('choose-team', 'Site A Crew · 2 участника', 'data-value="Site A Crew"') +
        option('choose-team', 'Репортаж · 3 участника', 'data-value="Репортаж"') +
        option('choose-team', 'Без команды', 'data-value=""') +
        '<div class="dialog-note">Участники копируются в задание. В реальном проекте они выбираются по действительным данным команды.</div>');
      return;
    }
    if (action === 'add-person') {
      state.selectedPerson = null;
      openDialog('person', 'Добавить участника', personEditor(null));
      return;
    }
    if (action === 'edit-person') {
      const person = state.people.find(p => p.id === Number(button.dataset.person));
      if (!person) return;
      state.selectedPerson = person.id;
      openDialog('person', 'Настройка участника', personEditor(person));
      return;
    }
    if (action === 'reset') {
      if (window.confirm('Сбросить демонстрационный черновик?')) resetDemo();
      return;
    }
    if (action === 'save') {
      const invalid = validate();
      if (invalid) {
        setTab(invalid.tab);
        const errorNode = document.getElementById('form-error');
        errorNode.textContent = invalid.error;
        errorNode.hidden = false;
        invalid.target.focus();
        return;
      }
      document.getElementById('draft-state').textContent = 'Проверено';
      document.getElementById('draft-caption').textContent = 'Не отправлено на сервер';
      message('Демонстрация сохранения',
        '<strong>' + esc(field('name').value.trim()) + '</strong><p>Все обязательные поля заполнены. ' +
        'В настоящем PhotoBunker сохраняется полный объект задания с правилами, пресетом, командой и участниками.</p>' +
        '<p>В этом прототипе реальное задание не создаётся.</p>');
      return;
    }

    const sheetAction = button.dataset.sheet;
    if (!sheetAction) return;
    if (sheetAction === 'close') { closeDialog(); return; }
    if (sheetAction === 'set-status') {
      const label = button.dataset.value;
      statusLabel.textContent = label;
      statusLed.className = 'state-led ' +
        (label === 'Загрузка' || label === 'Подключение' ? 'busy' :
          label === 'Ошибка' ? 'error' : label === 'Офлайн' ? 'warning' : '');
      closeDialog();
      return;
    }
    if (sheetAction === 'choose-preset') {
      field('presetId').value = button.dataset.value;
      markChanged();
      closeDialog();
      return;
    }
    if (sheetAction === 'choose-team') {
      state.team = button.dataset.value;
      state.people = structuredClone(demoTeams[state.team] || []);
      document.getElementById('team-name').textContent = state.team || 'Без команды';
      document.getElementById('team-caption').textContent = state.team ? 'Выбрана команда' : 'Команда не выбрана';
      renderPeople();
      markChanged();
      closeDialog();
      return;
    }
    if (sheetAction === 'save-person') {
      const role = dialogContent.querySelector('#person-role').value;
      const photoScope = dialogContent.querySelector('#person-scope').value;
      if (state.selectedPerson !== null) {
        const person = state.people.find(p => p.id === state.selectedPerson);
        if (person) Object.assign(person, { role, photoScope });
      } else {
        const id = Number(dialogContent.querySelector('#person-contact').value);
        if (!id || !contacts[id] || state.people.some(p => p.id === id)) return;
        state.people.push({ id, name: contacts[id], role, photoScope });
      }
      renderPeople();
      markChanged();
      closeDialog();
      return;
    }
    if (sheetAction === 'remove-person') {
      state.people = state.people.filter(p => p.id !== state.selectedPerson);
      renderPeople();
      markChanged();
      closeDialog();
    }
  });

  // Dependency switches use the same interaction as all other Rules switches.
  app.addEventListener('change', event => {
    if (event.target.matches('input,textarea,select')) {
      if (event.target.dataset.toggle) syncDependencies();
      if (event.target.name === 'shots') {
        const shotCount = lines(field('shots').value).length;
        document.getElementById('shots-count').textContent = shotCount + ' пунктов в плане';
        if (Number(field('targetCount').value) < shotCount) field('targetCount').value = String(shotCount);
      }
      markChanged();
    }
  });
  app.addEventListener('input', event => {
    if (event.target.matches('input,textarea,select')) markChanged();
  });
  app.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = panes.indexOf(button.dataset.tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? panes.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length;
      const nextButton = app.querySelector('[data-tab="' + panes[next] + '"]');
      setTab(panes[next]);
      nextButton.focus();
    });
  });
  document.querySelectorAll('[data-device]').forEach(button => {
    button.addEventListener('click', () => {
      const selected = button.dataset.device;
      device.className = 'device ' + selected;
      document.querySelectorAll('[data-device]').forEach(other => {
        other.classList.toggle('selected', other === button);
        other.setAttribute('aria-pressed', String(other === button));
      });
    });
  });
  overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) { event.preventDefault(); closeDialog(); }
  });

  resetDemo();
})();
