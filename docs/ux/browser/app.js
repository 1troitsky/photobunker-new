/* PhotoBunker UX / Browser Fieldwork 3.1
   Interactive front-end DEMO ONLY. No real photos, API calls, keys, shares,
   access grants, deletion, ACL, TTL mutations or persistence. */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const device = document.getElementById('device');
  const list = document.getElementById('browser-items');
  const queryInput = document.getElementById('browser-query');
  const overlay = document.getElementById('dialog-overlay');
  const dialog = overlay.querySelector('.dialog-sheet');
  const dialogTitle = document.getElementById('dialog-title');
  const dialogBody = document.getElementById('dialog-content');
  const bySelector = selector => document.querySelector(selector);
  const all = selector => [...document.querySelectorAll(selector)];
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  const folderIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h8v13H3z"/></svg>';
  const colors = [
    ['#9fb0b4','#74858a','#c5b69d','#5b6a69'], ['#b4b4af','#657678','#c2bba7','#414e50'],
    ['#94a9b3','#70868b','#d0c0aa','#455457'], ['#c9b099','#718480','#bdb9a4','#45534d'],
    ['#9db5aa','#64847a','#b0b6a1','#37574c'], ['#a9bdbe','#6e7d86','#c9ac94','#45545b'],
    ['#b1b7c6','#626b81','#cac7bc','#475063'], ['#c1bea8','#657776','#d2bd9e','#465a58']
  ];
  // Abstract illustrations, not fetched images. Production MUST use PhotoThumbnail.
  function scene(number) {
    const p = colors[number % colors.length];
    const variant = number % 4;
    const art = variant === 0
      ? '<rect x="26" y="18" width="109" height="106" fill="' + p[2] + '"/>' +
        '<g fill="' + p[3] + '"><rect x="38" y="47" width="18" height="23"/><rect x="69" y="47" width="18" height="23"/>' +
        '<rect x="101" y="47" width="18" height="23"/><rect x="38" y="82" width="18" height="24"/>' +
        '<rect x="69" y="82" width="18" height="24"/><rect x="101" y="82" width="18" height="24"/></g>'
      : variant === 1
      ? '<rect x="14" y="24" width="63" height="96" fill="' + p[2] + '"/><rect x="83" y="12" width="65" height="108" fill="' + p[1] + '"/>' +
        '<path d="M21 42h49M21 63h49M21 85h49M90 30h52M90 52h52M90 74h52" stroke="' + p[3] + '" stroke-width="5"/>'
      : variant === 2
      ? '<path d="M0 65 37 39 73 58 113 26 160 62V120H0z" fill="' + p[2] + '"/>' +
        '<path d="M0 86 38 57 89 84 124 48 160 70V120H0z" fill="' + p[3] + '"/>'
      : '<rect x="20" y="28" width="52" height="92" fill="' + p[2] + '"/><rect x="83" y="14" width="63" height="106" fill="' + p[1] + '"/>' +
        '<path d="M29 45h34M29 65h34M29 85h34M92 31h44M92 49h44M92 68h44M92 87h44" stroke="' + p[3] + '" stroke-width="4"/>';
    return '<svg class="scene" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<rect width="160" height="120" fill="' + p[0] + '"/><circle cx="132" cy="17" r="17" fill="#fff8e5" opacity=".35"/>' +
      art + '</svg>';
  }

  const photo = (id, parent, label, sceneIndex, order, tags = [], extras = {}) =>
    ({ id, parent, name: label, kind: 'photo', sceneIndex, order,
      tags, daysToExpiry: 13, created: '7 ноя', readable: true, editable: true,
      deletable: true, shareable: false, ...extras });
  const initialEntries = [
    { id: 'personal', parent: 'all', name: 'Мои фото', kind: 'section', order: 80 },
    { id: 'assignments', parent: 'all', name: 'Задания', kind: 'section', order: 70 },
    { id: 'archive', parent: 'all', name: 'Архив', kind: 'section', order: 60 },
    { id: 'city', parent: 'personal', name: 'Городские прогулки', kind: 'folder', order: 55, created: '5 ноя' },
    { id: 'studio', parent: 'personal', name: 'Студия', kind: 'folder', order: 25, created: '3 ноя' },
    photo('pm1','personal','ABCD0012',0,95,['город'],{daysToExpiry:3, shareable:true}),
    photo('pm2','personal','ABCD0011',4,79,['пейзаж'],{daysToExpiry:9, shareable:true}),
    photo('ct1','city','ABCD0008',1,49,['фасад']),
    photo('ct2','city','ABCD0009',2,48,['город']),
    photo('ct3','city','ABCD0010',3,47,['детали']),
    photo('ct4','city','ABCD0013',5,46,['город']),
    photo('st1','studio','ABCD0001',6,29,['работа']),
    photo('st2','studio','ABCD0002',7,28,['интерьер']),
    photo('st3','studio','ABCD0003',0,27,['работа']),
    photo('st4','studio','ABCD0004',1,26,['детали']),
    { id: 'site', parent: 'assignments', name: 'Фасады — Site A', kind: 'assignment', order: 95 },
    { id: 'interior', parent: 'assignments', name: 'Интерьер — зал 02', kind: 'assignment', order: 90 },
    { id: 'coast', parent: 'assignments', name: 'Побережье — репортаж', kind: 'assignment', order: 85 },
    { id: 'details', parent: 'site', name: 'Детали фасада', kind: 'folder', order: 74 },
    photo('s1','site','SITE0001',2,99,['фасад']),
    photo('s2','site','SITE0002',1,93,['фасад']),
    photo('s3','details','SITE0003',5,88,['детали']),
    photo('s4','details','SITE0004',0,87,['детали']),
    photo('s5','details','SITE0005',3,86,['детали']),
    photo('s6','details','SITE0006',7,85,['детали']),
    photo('i1','interior','INT0001',6,69,['интерьер']),
    photo('i2','interior','INT0002',7,68,['интерьер']),
    photo('i3','interior','INT0003',1,67,['интерьер']),
    photo('i4','interior','INT0004',3,66,['интерьер']),
    photo('a1','archive','ABCD0005',4,20,['архив'],{daysToExpiry:5}),
    photo('a2','archive','ABCD0006',5,19,['архив'],{daysToExpiry:5})
  ];
  let entries = initialEntries.map(entry => ({ ...entry, tags: entry.tags ? [...entry.tags] : undefined }));

  const state = {
    location: 'personal', view: 'grid', query: '', tag: '', searchOpen: false,
    selectMode: false, selected: new Set(), expanded: new Set(),
    sort: 'newest', foldersFirst: true, daysLeft: false, openFirst: 'personal',
    dialog: '', dialogTarget: '', returnFocus: null
  };
  // Local demo media: original Browser model is unchanged for real photos.
  let importedCounter = 0;
  let urlController = null;
  const MAX_DEVICE_BYTES = 200 * 1024 * 1024;
  const MAX_LINK_BYTES = 100 * 1024 * 1024;
  const isMedia = entry => !!entry && ['photo','video','audio'].includes(entry.kind);
  const mediaLabel = entry => entry.kind === 'video' ? 'Видео' : entry.kind === 'audio' ? 'Аудио' : 'Фото';
  const sizeLabel = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' МБ' :
    bytes >= 1024 ? Math.round(bytes / 1024) + ' КБ' : bytes + ' Б';
  const get = id => entries.find(entry => entry.id === id);
  const children = id => entries.filter(entry => entry.parent === id);
  function lineage(id) {
    const result = []; let item = get(id), depth = 0;
    while (item && depth++ < 25) { result.unshift(item); item = get(item.parent); }
    return result;
  }
  function descendants(id) {
    const result = [];
    function visit(parent, depth) {
      if (depth > 20) return;
      children(parent).forEach(entry => {
        result.push(entry);
        if (!isMedia(entry)) visit(entry.id, depth + 1);
      });
    }
    visit(id, 0);
    return result;
  }
  const mediaIn = id => descendants(id).filter(isMedia);
  const photosIn = id => mediaIn(id).filter(entry => entry.kind === 'photo');
  const sectionOf = id => lineage(id).find(entry => ['personal','assignments','archive'].includes(entry.id))?.id || 'all';
  const isSelectable = entry => isMedia(entry) || entry?.kind === 'folder';
  const workspaceOf = id =>
    lineage(id).find(entry => entry.kind === 'assignment')?.id ||
    (sectionOf(id) === 'archive' ? 'personal' : sectionOf(id));
  const allowedMove = (source, destination) => workspaceOf(source) === workspaceOf(destination);
  const plural = value => value === 1 ? 'папка' : value >= 2 && value <= 4 ? 'папки' : 'папок';

  function expiryText(entry) {
    if (entry.daysToExpiry === undefined || entry.daysToExpiry === null) return 'Без срока';
    const days = Math.max(0, Math.floor(entry.daysToExpiry));
    if (state.daysLeft) {
      const d = days % 10, mod = days % 100;
      const noun = mod >= 11 && mod <= 14 ? 'дней' : d === 1 ? 'день' : d >= 2 && d <= 4 ? 'дня' : 'дней';
      return 'Осталось: ' + days + ' ' + noun;
    }
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    return 'Удаление: ' + new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(expiryDate);
  }
  function sortRows(rows) {
    return [...rows].sort((a,b) => {
      const x = a.entry, y = b.entry;
      if (state.foldersFirst) {
        const rank = Number(isMedia(x)) - Number(isMedia(y));
        if (rank !== 0) return rank;
      }
      if (state.sort === 'name') return x.name.localeCompare(y.name, 'ru', { numeric: true });
      return state.sort === 'oldest' ? x.order - y.order : y.order - x.order;
    });
  }
  function visibleRows() {
    const location = state.location, term = state.query.trim().toLocaleLowerCase();
    if (term || state.tag) {
      const matches = entry => {
        const tags = entry.readable === false ? [] : entry.tags || [];
        const searchText = entry.name + ' ' + tags.join(' ');
        return (!term || searchText.toLocaleLowerCase().includes(term)) &&
          (!state.tag || (entry.kind === 'photo' && tags.includes(state.tag)));
      };
      return sortRows(descendants(location).filter(matches).map(entry => ({ entry, depth: 0 })));
    }
    if (state.view !== 'tree') return sortRows(children(location).map(entry => ({ entry, depth: 0 })));
    const rows = [];
    function walk(parent, depth) {
      sortRows(children(parent).map(entry => ({ entry, depth }))).forEach(row => {
        rows.push(row);
        if (!isMedia(row.entry) && state.expanded.has(row.entry.id))
          walk(row.entry.id, depth + 1);
      });
    }
    walk(location, 0);
    return rows;
  }

  function mediaPreview(entry) {
    if (entry.kind === 'photo') return entry.objectUrl
      ? '<img class="imported-thumb" src="' + escapeHTML(entry.objectUrl) + '" alt="">'
      : scene(entry.sceneIndex);
    const icon = entry.kind === 'video'
      ? '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'
      : '<path d="M4 11v2m4-6v10m4-14v18m4-14v10m4-6v2"/>';
    return '<span class="imported-media-thumb ' + entry.kind + '"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      icon + '</svg></span>';
  }
  function preview(entry) {
    if (isMedia(entry))
      return '<span class="entry-preview">' + mediaPreview(entry) + '</span>';
    const children = mediaIn(entry.id).slice(0,4);
    const minis = children.length
      ? Array.from({length: 4}, (_, i) => children[i] ? mediaPreview(children[i]) : '<span class="empty-mini"></span>').join('')
      : folderIcon;
    return '<span class="entry-preview ' + (children.length ? 'collage' : 'empty-folder') + '">' + minis +
      '<span class="entry-folder-badge">' + folderIcon +
      (entry.kind === 'assignment' ? 'ЗАДАНИЕ' : entry.kind === 'section' ? 'РАЗДЕЛ' : 'ПАПКА') + '</span></span>';
  }

  function rowHTML(row) {
    const entry = row.entry, file = isMedia(entry), selected = state.selected.has(entry.id);
    const additional = file
      ? '<small>' + escapeHTML(entry.created) + ' · ' +
        (entry.imported ? mediaLabel(entry) + ' · ' + sizeLabel(entry.size) :
          entry.readable === false ? 'Только миниатюра' : escapeHTML(expiryText(entry))) + '</small>' +
        (entry.readable !== false && entry.tags?.length
          ? '<small class="tags">' + entry.tags.map(tag => '#' + escapeHTML(tag)).join(' ') + '</small>' : '')
      : '<small>' + mediaIn(entry.id).length + (mediaIn(entry.id).some(x => x.kind !== 'photo') ? ' файлов' : ' фото') +
        (entry.created ? ' · ' + escapeHTML(entry.created) : '') + '</small>';
    const path = state.query || state.tag
      ? '<small>' + escapeHTML(lineage(entry.parent).map(item => item.name).join(' / ')) + '</small>' : '';
    return '<article class="browser-entry' + (selected ? ' selected' : '') + '" style="--depth:' + row.depth + '">' +
      (state.view === 'tree'
        ? '<button type="button" class="tree-expand" data-action="expand" data-id="' + escapeHTML(entry.id) +
          '" ' + (file ? 'disabled' : '') + ' aria-label="Раскрыть папку">' +
          (file ? '' : state.expanded.has(entry.id) ? '⌄' : '›') + '</button>' : '') +
      (state.selectMode && isSelectable(entry)
        ? '<input type="checkbox" class="entry-check" data-check="' + escapeHTML(entry.id) +
          '" aria-label="Выбрать ' + escapeHTML(entry.name) + '"' + (selected ? ' checked' : '') + '>' : '') +
      '<button type="button" class="entry-open" data-action="open" data-id="' + escapeHTML(entry.id) + '"' +
        (file && entry.readable === false && !state.selectMode ? ' disabled' : '') + '>' +
        preview(entry) + '<span class="entry-copy"><strong>' + escapeHTML(entry.name) +
        '</strong>' + additional + path + '</span></button>' +
      (isSelectable(entry) ? '<button type="button" class="entry-more" data-action="menu" data-id="' +
        escapeHTML(entry.id) + '" aria-label="Действия: ' + escapeHTML(entry.name) + '">•••</button>' : '') +
      '</article>';
  }

  function render() {
    const section = sectionOf(state.location);
    all('[data-section]').forEach(button => {
      const selected = section === button.dataset.section;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    all('[data-view]').forEach(button => {
      const selected = button.dataset.view === state.view;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    bySelector('[data-action="select"]').classList.toggle('selected', state.selectMode);
    const folders = children(state.location).filter(entry => !isMedia(entry)).length;
    const currentFiles = mediaIn(state.location);
    bySelector('#browser-count').textContent = currentFiles.length +
      (currentFiles.some(entry => entry.kind !== 'photo') ? ' файлов · ' : ' фото · ') +
      folders + ' ' + plural(folders);
    const path = state.location === 'all' ? [] : lineage(state.location);
    const crumbs = [{ id: 'all', name: 'Все' }, ...path];
    bySelector('.path-breadcrumbs').innerHTML = crumbs.map((entry,i) =>
      (i ? '<span>›</span>' : '') + '<button type="button" data-action="navigate" data-id="' + escapeHTML(entry.id) +
      '" class="' + (i === crumbs.length - 1 ? 'current' : '') + '">' + escapeHTML(entry.name) + '</button>'
    ).join('');
    bySelector('.path-back').disabled = state.location === 'all';
    bySelector('.browser-search').hidden = !state.searchOpen;
    const tags = [...new Set(photosIn(state.location)
      .filter(entry => entry.readable !== false).flatMap(entry => entry.tags || []))].sort();
    bySelector('.tag-filters').innerHTML = ['', ...tags].map(tag =>
      '<button type="button" data-action="tag" data-tag="' + escapeHTML(tag) + '" class="' +
      (state.tag === tag ? 'selected' : '') + '">' + (tag ? '#' + escapeHTML(tag) : 'Все теги') +
      '</button>').join('');
    bySelector('.selection-bar').hidden = !state.selectMode;
    if (state.selectMode) bySelector('.selection-bar').innerHTML =
      '<strong>Выбрано: ' + state.selected.size + '</strong>' +
      '<button type="button" data-action="cancel">Отмена</button>' +
      '<button type="button" data-action="bulk">Действия</button>';
    list.className = 'browser-items ' + state.view;
    const rows = visibleRows();
    list.innerHTML = rows.length ? rows.map(rowHTML).join('') :
      '<div class="browser-empty">В этой папке пока ничего нет</div>';
  }

  function navigate(id) {
    if (id !== 'all' && !get(id)) return;
    state.location = id; state.query = ''; state.tag = ''; state.searchOpen = false;
    state.selectMode = false; state.selected.clear();
    queryInput.value = '';
    document.getElementById('browser-content').scrollTop = 0;
    render();
  }
  function option(action, label, id = '', kind = '') {
    return '<button type="button" data-action="' + action + '" data-id="' + escapeHTML(id) +
      '" class="' + kind + '">' + escapeHTML(label) + '</button>';
  }
  function message(title, html) {
    openDialog('notice', title, '<div class="info">' + html + '</div>' +
      option('close', 'Понятно', '', 'primary-action'));
  }
  function openDialog(kind, title, html, target = '') {
    state.returnFocus = document.activeElement;
    state.dialog = kind; state.dialogTarget = target;
    dialogTitle.textContent = title; dialogBody.innerHTML = html;
    overlay.hidden = false; dialog.focus();
  }
  function closeDialog() {
    overlay.hidden = true; state.dialog = ''; state.dialogTarget = '';
    if (state.returnFocus?.isConnected) state.returnFocus.focus();
    state.returnFocus = null;
  }

  function show(kind, id = '') {
    const entry = get(id);
    if (kind === 'share') {
      openDialog('share', 'Поделиться',
        '<div class="info">Можно поделиться фотографией или целым заданием. ' +
        '<strong>Механизм передачи, получатели, права доступа и срок действия ещё обсуждаются.</strong> ' +
        'Этот макет не создаёт ссылок и ничего не отправляет.</div>' +
        option('select-for-share', 'Выбрать фотографии') +
        option('share-assignment-info', 'Поделиться заданием · обсудить'));
    } else if (kind === 'share-assignment-info') {
      message('Поделиться заданием', 'Требование зафиксировано: возможно делиться заданием вместе с его фотографиями. ' +
        'До решения владельца не создавать ссылки, не выдавать права чтения/скачивания и не выбирать TTL.');
    } else if (kind === 'settings') {
      openDialog('settings', 'Настройки Browser',
        '<label>Открывать первым<select name="first"><option value="all">Все</option><option value="personal">Мои фото</option><option value="assignments">Задания</option><option value="archive">Архив</option></select></label>' +
        '<label>Сортировка<select name="sort"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По названию</option></select></label>' +
        '<label class="settings-row"><span><strong>Папки всегда сверху</strong><small>Независимо от сортировки</small></span><input type="checkbox" name="foldersFirst" class="setting-toggle"></label>' +
        '<label class="settings-row"><span><strong>Показывать оставшиеся дни</strong><small>Вместо даты удаления фотографии</small></span><input type="checkbox" name="daysLeft" class="setting-toggle"></label>' +
        option('apply-settings', 'Применить', '', 'primary-action'));
      dialogBody.querySelector('[name=first]').value = state.openFirst;
      dialogBody.querySelector('[name=sort]').value = state.sort;
      dialogBody.querySelector('[name=foldersFirst]').checked = state.foldersFirst;
      dialogBody.querySelector('[name=daysLeft]').checked = state.daysLeft;
    } else if (kind === 'status') {
      openDialog('status', 'Состояние приложения',
        '<div class="info">Демонстрация. В production статус связан с реальными очередями и сетевыми операциями.</div>' +
        ['В работе','Загрузка','Подключение','Офлайн','Ошибка','Готово'].map(label =>
          option('set-status', label, label)).join(''));
    } else if (kind === 'create') {
      const chooseParent = state.location === 'all' || state.location === 'assignments' || state.location === 'archive';
      const locations = entries.filter(x => x.id === 'personal' || x.kind === 'assignment');
      const select = '<label>Создать в<select name="parent">' + locations.map(x =>
        '<option value="' + escapeHTML(x.id) + '">' + escapeHTML(x.name) + '</option>').join('') + '</select></label>';
      openDialog('create', 'Новая папка',
        (chooseParent ? select : '<div class="info">Расположение: ' + escapeHTML(get(state.location)?.name || 'Мои фото') + '</div>') +
        '<label>Название<input type="text" name="folderName" maxlength="80" placeholder="Новая папка"></label>' +
        option('create-folder', 'Создать папку', '', 'primary-action'));
    } else if (kind === 'menu' && entry) {
      let html = option('open-item', entry.kind === 'photo' ? 'Открыть фотографию' : 'Открыть папку', id);
      if (entry.kind === 'photo') {
        if (entry.editable) {
          html += option('rename', 'Переименовать', id);
          html += option('tags', 'Изменить теги', id);
        }
        if (sectionOf(id) === 'personal' || sectionOf(id) === 'archive')
          html += option('archive', sectionOf(id) === 'archive' ? 'Восстановить из архива' : 'В архив', id);
      } else if (entry.kind === 'folder') {
        html += option('rename', 'Переименовать папку', id);
      }
      html += option('move', 'Переместить', id);
      if (entry.deletable !== false) html += option('delete', 'Удалить', id, 'danger');
      openDialog('menu', entry.name, html, id);
    } else if (kind === 'rename' && entry) {
      openDialog('rename', 'Переименовать',
        '<label>Название<input name="newName" maxlength="' + (entry.kind === 'photo' ? 120 : 80) +
        '" value="' + escapeHTML(entry.name) + '"></label>' +
        option('save-rename', 'Сохранить', '', 'primary-action'), id);
    } else if (kind === 'tags' && entry) {
      openDialog('tags', 'Теги фотографии',
        '<label>Теги через запятую<input name="tags" value="' + escapeHTML((entry.tags || []).join(', ')) + '"></label>' +
        option('save-tags', 'Сохранить', '', 'primary-action'), id);
    } else if (kind === 'bulk') {
      const ids = [...state.selected];
      const archiveAllowed = ids.length > 0 && ids.every(id => get(id)?.kind === 'photo' &&
        ['personal','archive'].includes(sectionOf(id)));
      openDialog('bulk', 'Действия',
        option('select-all', 'Выбрать всё') +
        '<div class="info">Выбрано: ' + ids.length + '</div>' +
        (ids.length ? option('share-selected', 'Поделиться выбранными фотографиями') +
          option('move-bulk', 'Переместить') +
          (archiveAllowed ? option('archive-bulk', 'В архив / восстановить') : '') +
          option('delete-bulk', 'Удалить', '', 'danger') : ''));
    } else if (kind === 'move' || kind === 'move-bulk') {
      const ids = kind === 'move' ? [id] : [...state.selected];
      const destinations = entries.filter(x => x.id === 'personal' || x.kind === 'assignment' || x.kind === 'folder')
        .filter(destination => ids.every(key => allowedMove(key, destination.id) &&
          key !== destination.id && !lineage(destination.id).some(x => x.id === key)));
      openDialog(kind, 'Переместить',
        '<div class="info">В прототипе показываются только папки внутри того же задания или личного пространства. ' +
        'Production использует существующий валидатор перемещений.</div>' +
        (destinations.length ? destinations.map(x => option('move-to',
          lineage(x.id).map(node => node.name).join(' / '), x.id)).join('') :
          '<div class="info">Нет доступных папок.</div>'), id);
    } else if (kind === 'delete' || kind === 'delete-bulk') {
      openDialog(kind, 'Удалить',
        '<div class="info">Подтвердить удаление только в демонстрационных данных? ' +
        'Настоящие фотографии и папки не затрагиваются.</div>' +
        option('confirm-delete', 'Удалить из макета', '', 'danger'), id);
    } else if (kind === 'photo' && entry && entry.readable !== false) {
      openDialog('photo', entry.name,
        '<div class="photo-large">' + scene(entry.sceneIndex) + '</div>' +
        '<div class="info">Снято: ' + escapeHTML(entry.created) + '<p>' +
        escapeHTML(expiryText(entry)) + '</p>Теги: ' +
        escapeHTML((entry.tags || []).map(x => '#' + x).join(' ') || 'Нет') +
        '<p>В production открывается существующий Photo Viewer с проверкой разрешений.</p></div>', id);
    } else if (kind === 'nav') {
      message(id, 'Другие разделы используют тот же общий UI Shell. Здесь демонстрируется только Browser.');
    }
  }

  function removeDemo(ids) {
    const removed = new Set(ids);
    ids.forEach(id => descendants(id).forEach(child => removed.add(child.id)));
    entries = entries.filter(entry => !removed.has(entry.id));
    state.selected.clear(); state.selectMode = false;
  }
  function handle(action, id, button) {
    const item = get(id);
    if (action === 'close') { closeDialog(); return; }
    if (action === 'back') {
      const parents = lineage(state.location);
      navigate(parents.length > 1 ? parents[parents.length - 2].id : 'all');
      return;
    }
    if (action === 'navigate') { navigate(id); return; }
    if (action === 'search') {
      state.searchOpen = !state.searchOpen;
      if (!state.searchOpen) { state.query = ''; state.tag = ''; queryInput.value = ''; }
      render();
      if (state.searchOpen) queryInput.focus();
      return;
    }
    if (action === 'select' || action === 'cancel') {
      state.selectMode = action === 'select' ? !state.selectMode : false;
      state.selected.clear(); render(); return;
    }
    if (action === 'tag') { state.tag = button.dataset.tag || ''; render(); return; }
    if (action === 'expand') {
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      render(); return;
    }
    if (action === 'open' || action === 'open-item') {
      if (!item) return;
      if (action === 'open' && state.selectMode && isSelectable(item)) {
        state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
        render(); return;
      }
      if (item.kind === 'photo') {
        if (item.readable !== false) show('photo', id);
      } else { closeDialog(); navigate(id); }
      return;
    }
    if (['status','share','settings','create','bulk'].includes(action)) { show(action); return; }
    if (action === 'menu') { show('menu', id); return; }
    if (action === 'share-assignment-info') { show('share-assignment-info'); return; }
    if (action === 'select-for-share') {
      closeDialog(); state.selectMode = true; state.selected.clear(); render(); return;
    }
    if (action === 'share-selected') {
      const chosen = [...state.selected].map(get);
      if (!chosen.length || chosen.some(x => x?.kind !== 'photo' || x.shareable !== true)) {
        message('Передача фотографий',
          'Нельзя автоматически делиться всеми выбранными объектами. Нужно учитывать реальные photo scopes, ' +
          'права, Public Card policy и срок действия. В макете отправка отключена.');
      } else {
        message('Передача фотографий', 'Отмечены демонстрационные фотографии. ' +
          'Настоящая ссылка или передача не создаётся; сценарий следует реализовать через разрешённые механизмы приложения.');
      }
      return;
    }
    if (action === 'apply-settings') {
      state.openFirst = dialogBody.querySelector('[name=first]').value;
      state.sort = dialogBody.querySelector('[name=sort]').value;
      state.foldersFirst = dialogBody.querySelector('[name=foldersFirst]').checked;
      state.daysLeft = dialogBody.querySelector('[name=daysLeft]').checked;
      closeDialog(); render(); return;
    }
    if (action === 'set-status') {
      const label = id;
      document.getElementById('status-label').textContent = label;
      bySelector('.state-led').className = 'state-led ' +
        (label === 'Загрузка' || label === 'Подключение' ? 'busy' :
          label === 'Офлайн' ? 'warning' : label === 'Ошибка' ? 'error' : '');
      closeDialog(); return;
    }
    if (action === 'create-folder') {
      const name = dialogBody.querySelector('[name=folderName]').value.trim();
      const parent = dialogBody.querySelector('[name=parent]')?.value || state.location;
      if (!name || !get(parent) || children(parent).some(x => x.kind === 'folder' &&
          x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return;
      entries.push({ id: 'folder-' + Date.now(), parent, name, kind: 'folder', order: Date.now(), created: 'Сегодня' });
      closeDialog(); navigate(parent); return;
    }
    if (action === 'save-rename') {
      const entry = get(state.dialogTarget);
      const name = dialogBody.querySelector('[name=newName]').value.trim();
      if (!entry || !name) return;
      entry.name = name; closeDialog(); render(); return;
    }
    if (action === 'save-tags') {
      const entry = get(state.dialogTarget);
      if (!entry || entry.kind !== 'photo') return;
      entry.tags = dialogBody.querySelector('[name=tags]').value.split(',').map(t => t.trim()).filter(Boolean);
      closeDialog(); render(); return;
    }
    if (['rename','tags','move','delete'].includes(action)) { show(action, id); return; }
    if (['move-bulk','delete-bulk'].includes(action)) { show(action); return; }
    if (action === 'select-all') {
      visibleRows().filter(row => isSelectable(row.entry))
        .forEach(row => state.selected.add(row.entry.id));
      closeDialog(); render(); return;
    }
    if (action === 'archive' && item && item.kind === 'photo' &&
        ['personal','archive'].includes(sectionOf(id))) {
      item.parent = sectionOf(id) === 'archive' ? 'personal' : 'archive';
      closeDialog(); render(); return;
    }
    if (action === 'archive-bulk') {
      [...state.selected].forEach(id => {
        const entry = get(id);
        if (entry?.kind === 'photo' && ['personal','archive'].includes(sectionOf(id)))
          entry.parent = sectionOf(id) === 'archive' ? 'personal' : 'archive';
      });
      state.selected.clear(); state.selectMode = false; closeDialog(); render(); return;
    }
    if (action === 'move-to') {
      const ids = state.dialog === 'move' ? [state.dialogTarget] : [...state.selected];
      ids.forEach(source => {
        const entry = get(source);
        if (entry && source !== id && allowedMove(source,id) &&
            !lineage(id).some(parent => parent.id === source)) entry.parent = id;
      });
      state.selected.clear(); state.selectMode = false; closeDialog(); render(); return;
    }
    if (action === 'confirm-delete') {
      removeDemo(state.dialog === 'delete' ? [state.dialogTarget] : [...state.selected]);
      closeDialog(); render();
    }
  }

  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !app.contains(button)) return;
    if (button.dataset.section) { navigate(button.dataset.section); return; }
    if (button.dataset.view) { state.view = button.dataset.view; render(); return; }
    if (button.dataset.nav) {
      if (button.dataset.nav !== 'Browser') show('nav', button.dataset.nav);
      return;
    }
    if (button.dataset.action) handle(button.dataset.action, button.dataset.id || '', button);
  });
  all('[data-device]').forEach(button => {
    button.addEventListener('click', () => {
      device.className = 'device ' + button.dataset.device;
      all('[data-device]').forEach(other => {
        const active = other === button;
        other.classList.toggle('selected', active);
        other.setAttribute('aria-pressed', String(active));
      });
    });
  });
  app.addEventListener('change', event => {
    const input = event.target;
    if (input.hasAttribute('data-check')) {
      const id = input.dataset.check;
      input.checked ? state.selected.add(id) : state.selected.delete(id);
      render();
    }
  });
  queryInput.addEventListener('input', () => {
    state.query = queryInput.value; render();
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeDialog();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.preventDefault(); closeDialog();
    }
  });
  render();
})();