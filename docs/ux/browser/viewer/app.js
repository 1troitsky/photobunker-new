/* PhotoBunker UX — Photo Viewer Fieldwork 3.1.
   DEMO ONLY: no real storage, account data, ACL, key handling or shares.
   Gesture thresholds are deliberately conservative; buttons and system
   scrolling never dispatch a swipe. Implement production with existing
   PhotoView.vue, PhotoThumbnail, access-key and Local-First adapters. */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const stage = document.getElementById('image-stage');
  const fullscreen = document.getElementById('fullscreen-layer');
  const fullscreenStage = document.getElementById('fullscreen-photo');
  const sheetLayer = document.getElementById('viewer-sheet-layer');
  const sheet = sheetLayer.querySelector('.viewer-sheet');
  const sheetContent = document.getElementById('sheet-content');
  const webLayer = document.getElementById('web-layer');
  const pop = document.getElementById('download-pop');
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  const photos = [
    {
      id:'SITE0001', name:'Главный фасад',
      description:'Общий вид главного фасада, дневное освещение. Снимок сделан с противоположной стороны улицы, чтобы показать архитектуру здания и расположение входной группы.',
      created:'7 ноя, 10:42', expiration:'20 ноя', daysRemaining:13, type:'facade',
      favorite:false, editable:true, deletable:true, author:'Вы', category:'Фасад',
      gps:'Демоданные: геолокация доступна', resolution:'4032 × 3024'
    },
    {
      id:'SITE0002', name:'Декоративная арка',
      description:'Вертикальная фотография декоративной арки главного входа. Особое внимание уделено фактуре камня и естественному освещению.',
      created:'7 ноя, 10:45', expiration:'20 ноя', daysRemaining:13, type:'portrait',
      favorite:true, editable:true, deletable:true, author:'Вы', category:'Детали',
      gps:'Демоданные: геолокация доступна', resolution:'3024 × 4032'
    },
    {
      id:'SITE0003', name:'Улица и боковой фасад',
      description:'Боковой ракурс здания, окружающая среда, пешеходная дорожка и соседние постройки.',
      created:'7 ноя, 11:12', expiration:'20 ноя', daysRemaining:13, type:'street',
      favorite:false, editable:false, deletable:false, author:'Анна', category:'Фасад',
      gps:'Недоступно', resolution:'4032 × 3024'
    },
    {
      id:'SITE0004', name:'Внутреннее пространство',
      description:'Интерьер со сводчатым проходом, двумя источниками естественного света и переходом между залами.',
      created:'7 ноя, 11:18', expiration:'20 ноя', daysRemaining:13, type:'interior',
      favorite:false, editable:true, deletable:true, author:'Вы', category:'Интерьер',
      gps:'Демоданные: геолокация доступна', resolution:'4032 × 3024'
    }
  ];
  let index = 0;
  let downloading = false;
  let sheetHide = 0;
  let webHide = 0;
  let fullHide = 0;
  let pendingSwipeClick = false;
  let navigationBusy = false;
  let demoFavoritesFolder = false;
  const log = [{ type:'success', title:'В работе', text:'Приложение готово', at:'11:28' }];
  const photo = () => photos[index];
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const motion = duration => reducedMotion() ? 0 : duration;
  const now = () => new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});

  function addLog(type,title,detail) {
    log.unshift({ type,title,text:detail,at:now() });
    if(log.length > 20) log.length = 20;
    $('#status-label').textContent =
      type === 'error' ? 'Ошибка' :
      type === 'warning' ? 'Предупреждение' :
      type === 'busy' ? 'Подготовка' : 'В работе';
    $('.state-led').className = 'state-led ' + (type === 'success' ? '' : type);
  }

  function draw(type) {
    if(type==='portrait') return '<svg class="scene" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 780" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="520" height="780" fill="#cbbca6"/><path d="M45 780V212Q47 43 260 43Q473 43 475 212V780" fill="#e0d0b6"/>' +
      '<path d="M84 780V237Q87 90 260 90Q433 90 436 237V780" fill="#9a8e7b"/>' +
      '<path d="M117 780V256Q120 135 260 135Q400 135 403 256V780" fill="#596964"/>' +
      '<path d="M145 780V279Q146 161 260 161Q374 161 375 279V780" fill="#a1b4ae"/>' +
      '<path d="M145 504L375 469V780H145" fill="#74847c"/>' +
      '<path d="M84 384h352M84 411h352" stroke="#d8c6aa" stroke-width="16"/>' +
      '<path d="M0 712L520 671V780H0z" fill="#928c7d"/><rect x="238" y="437" width="50" height="259" fill="#54665f" opacity=".6"/></svg>';
    if(type==='street') return '<svg class="scene" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 565" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="850" height="565" fill="#b3c1c0"/><rect y="375" width="850" height="190" fill="#b5b7a7"/>' +
      '<rect y="130" width="260" height="385" fill="#879491"/><rect x="274" y="52" width="421" height="467" fill="#cbbda8"/>' +
      '<rect x="704" y="164" width="146" height="355" fill="#748a88"/><g fill="#4a5b60">' +
      '<rect x="39" y="185" width="51" height="68"/><rect x="107" y="185" width="51" height="68"/>' +
      '<rect x="175" y="185" width="51" height="68"/><rect x="317" y="122" width="69" height="91"/>' +
      '<rect x="443" y="122" width="69" height="91"/><rect x="569" y="122" width="69" height="91"/>' +
      '<rect x="317" y="254" width="69" height="91"/><rect x="443" y="254" width="69" height="91"/>' +
      '<rect x="569" y="254" width="69" height="91"/></g>' +
      '<path d="M0 445 850 403V565H0z" fill="#768480"/><path d="M0 508 850 465" stroke="#bcb9aa" stroke-width="8"/>' +
      '<path d="M154 449V272" stroke="#4a594f" stroke-width="14"/><circle cx="153" cy="256" r="72" fill="#6c836e"/>' +
      '<circle cx="107" cy="304" r="54" fill="#748d70"/><circle cx="217" cy="298" r="49" fill="#547762"/></svg>';
    if(type==='interior') return '<svg class="scene" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 565" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="850" height="565" fill="#c1b29f"/><path d="M96 565V225Q97 42 289 42Q481 42 483 225V565" fill="#777a70"/>' +
      '<path d="M138 565V233Q138 86 289 86Q440 86 440 233V565" fill="#abc0bb"/>' +
      '<path d="M149 445 439 410V565H149z" fill="#7d8d83"/><path d="M0 467 850 359V565H0z" fill="#918778"/>' +
      '<rect x="498" width="352" height="565" fill="#ddd0b9"/>' +
      '<path d="M555 565V261Q558 128 692 128Q825 128 827 261V565" fill="#89796c"/>' +
      '<path d="M588 565V278Q590 169 692 169Q794 169 797 278V565" fill="#94aaa4"/>' +
      '<path d="M0 540 850 458" stroke="#e0d2bb" stroke-width="12"/><path d="M503 0v565" stroke="#9e8f7c" stroke-width="15"/></svg>';
    return '<svg class="scene" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 565" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="850" height="565" fill="#aabdc1"/><rect y="398" width="850" height="167" fill="#90978a"/>' +
      '<path d="M67 565V126L710 106V565" fill="#c9bba3"/><path d="M80 151 698 135" stroke="#e0d1b5" stroke-width="23"/>' +
      '<path d="M82 274 699 264M82 393 699 383" stroke="#948d7d" stroke-width="13"/><g fill="#486061">' +
      '<rect x="143" y="180" width="89" height="85"/><rect x="287" y="176" width="89" height="85"/>' +
      '<rect x="431" y="173" width="89" height="85"/><rect x="575" y="169" width="89" height="85"/>' +
      '<rect x="143" y="296" width="89" height="85"/><rect x="287" y="293" width="89" height="85"/>' +
      '<rect x="431" y="290" width="89" height="85"/><rect x="575" y="287" width="89" height="85"/></g>' +
      '<path d="M287 565V434Q288 403 357 403Q423 403 424 434V565" fill="#62746b"/>' +
      '<path d="M0 483 850 445V565H0z" fill="#77877f"/><path d="M0 507 850 476" stroke="#b7bdac" stroke-width="7"/>' +
      '<path d="M724 530V296" stroke="#506251" stroke-width="11"/><circle cx="731" cy="288" r="79" fill="#718e75"/>' +
      '<circle cx="778" cy="353" r="62" fill="#5f816b"/></svg>';
  }

  function render() {
    const p = photo();
    if (!p) {
      $('.image-content').textContent = 'Фотографий нет';
      $('.fullscreen-image').textContent = '';
      $('.photo-name').textContent = 'Нет фотографий';
      $('.photo-id').textContent = '';
      $('.photo-description').textContent = '';
      $('.date-created').textContent = '';
      $('.date-expires').textContent = '';
      $('.page-count').textContent = '0 / 0';
      $('.fullscreen-count').textContent = '0 / 0';
      $$('[data-action="favorite"],[data-action="copy"],[data-action="download"],[data-action="delete"],[data-action="info"],[data-action="public"],[data-action="edit"],[data-action="previous"],[data-action="next"]').forEach(button => { button.disabled = true; });
      return;
    }
    const svg = draw(p.type);
    $('.image-content').innerHTML = svg;
    $('.fullscreen-image').innerHTML = svg;
    $('.photo-name').textContent = p.name;
    $('.photo-id').textContent = p.id;
    $('.photo-description').textContent = p.description;
    $('.date-created').textContent = p.created;
    $('.date-expires').innerHTML = escapeHTML(p.expiration) + ' <em>· ' + p.daysRemaining + ' дней</em>';
    $('.page-count').textContent = (index+1) + ' / ' + photos.length;
    $('.fullscreen-count').textContent = (index+1) + ' / ' + photos.length;
    const star = $('[data-action=favorite]');
    star.classList.toggle('is-favorite',p.favorite);
    star.setAttribute('aria-pressed',String(p.favorite));
    star.title = p.favorite ? 'Убрать из избранного' : 'Добавить в избранное';
    $('[data-action=delete]').disabled = !p.deletable;
    $('[data-action=edit]').disabled = !p.editable;
    $$('[data-action=previous]').forEach(button => { button.disabled = index === 0; });
    $$('[data-action=next]').forEach(button => { button.disabled = index === photos.length-1; });
  }

  function transitionTo(delta) {
    if (navigationBusy) return;
    const next = index+delta;
    if (next<0 || next>=photos.length) return;
    navigationBusy=true;
    closeDownload();
    // Use a slight, directional, non-blocking transition. All controls remain fixed.
    const targets = [$('.image-content'),$('.fullscreen-image')];
    targets.forEach(target => {
      if (target.animate && !reducedMotion())
        target.animate([{opacity:1,transform:'translateX(0)'},{opacity:.32,transform:'translateX(' + (-delta*18) + 'px)'}],
          {duration:95,easing:'ease-in'});
    });
    index=next; render();
    targets.forEach(target => {
      if (target.animate && !reducedMotion())
        target.animate([{opacity:.3,transform:'translateX(' + (delta*30) + 'px)'},{opacity:1,transform:'translateX(0)'}],
          {duration:205,easing:'cubic-bezier(.2,.72,.2,1)'});
    });
    navigationBusy=false;
  }

  function showDownload() {
    if (downloading || !photo()) return;
    pop.hidden=false;
    $('.download-question').hidden=false;
    $('.download-progress').hidden=true;
    $('[data-action=download]').setAttribute('aria-expanded','true');
  }
  function closeDownload() {
    if (downloading) return;
    pop.hidden=true;
    $('[data-action=download]').setAttribute('aria-expanded','false');
  }

  // Save a *compressed demo image*, NEVER an original or real media data.
  async function createImage(type,maxWidth,quality) {
    const p=photo();if(!p)throw new Error('Изображение не найдено');
    const portrait=p.type==='portrait';
    const width=portrait?Math.round(maxWidth*520/780):maxWidth;
    const height=portrait?maxWidth:Math.round(maxWidth*565/850);
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const imageURL=URL.createObjectURL(new Blob([draw(p.type)],{type:'image/svg+xml;charset=utf-8'}));
    try {
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=imageURL;});
      const context=canvas.getContext('2d');
      if(!context)throw new Error('Canvas недоступен');
      context.fillStyle='#fff';context.fillRect(0,0,width,height);
      context.drawImage(img,0,0,width,height);
      return await new Promise((resolve,reject)=>
        canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось создать файл')),type,quality));
    } finally { URL.revokeObjectURL(imageURL); }
  }

  async function copyImage() {
    const p=photo();if(!p)return;
    try {
      if(!navigator.clipboard?.write || !window.ClipboardItem)
        throw new Error('Браузер не поддерживает копирование изображений');
      const blob=await createImage('image/png',900);
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      addLog('success','Копирование',p.id+': сжатая копия скопирована');
    } catch(error) {
      addLog('error','Ошибка копирования',String(error?.message||error));
    }
  }

  async function confirmDownload() {
    const p=photo();
    if(!p||downloading)return;
    const filename=p.id+'-compressed.jpg';
    downloading=true;
    $('.download-question').hidden=true;
    $('.download-progress').hidden=false;
    addLog('busy','Подготовка JPEG','Создаётся сжатая JPEG-копия '+p.id);
    try {
      const blob=await createImage('image/jpeg',1400,.78);
      const file=typeof File==='function' ? new File([blob],filename,{type:'image/jpeg'}) : null;
      if (file && navigator.share && navigator.canShare?.({files:[file]})) {
        try {
          await navigator.share({files:[file],title:p.id});
          addLog('success','Системное меню','JPEG передан системному меню. Сохранение не подтверждается приложением.');
        } catch(error) {
          if(error?.name==='AbortError') addLog('warning','Сохранение отменено','Пользователь закрыл системное меню');
          else throw error;
        }
      } else {
        const url=URL.createObjectURL(blob),anchor=document.createElement('a');
        anchor.href=url;anchor.download=filename;
        document.body.appendChild(anchor);anchor.click();anchor.remove();
        setTimeout(()=>URL.revokeObjectURL(url),3000);
        addLog('success','Загрузка запрошена','Браузеру передана сжатая JPEG-копия');
      }
    } catch(error) {
      addLog('error','Ошибка скачивания',String(error?.message||error));
    } finally {
      downloading=false;
      closeDownload();
    }
  }

  function option(action,label,extra='') {
    return '<button type="button" data-action="'+action+'" class="'+extra+'">'+escapeHTML(label)+'</button>';
  }
  function infoRow(label,value) {
    return '<div><dt>'+escapeHTML(label)+'</dt><dd>'+escapeHTML(value)+'</dd></div>';
  }

  function showSheet(title,html) {
    closeDownload();
    clearTimeout(sheetHide);
    $('#viewer-sheet-title').textContent=title;
    sheetContent.innerHTML=html;
    sheetLayer.hidden=false;
    requestAnimationFrame(()=>sheetLayer.classList.add('visible'));
    sheet.focus();
  }
  function closeSheet() {
    sheetLayer.classList.remove('visible');
    clearTimeout(sheetHide);
    sheetHide=setTimeout(()=>{
      if(!sheetLayer.classList.contains('visible'))sheetLayer.hidden=true;
    },motion(290));
  }
  function information() {
    const p=photo();if(!p)return;
    // Content is intentionally FIRST: never bury full text beneath metadata.
    const description='<div class="description-card"><strong>Полное описание</strong><p>'+
      escapeHTML(p.description||'Описание отсутствует')+'</p></div>';
    const facts='<dl>'+infoRow('NAME-ID',p.id)+infoRow('Название',p.name)+
      infoRow('Задание','Фасады — Site A')+infoRow('Папка','Детали фасада')+
      infoRow('Автор',p.author)+infoRow('Категория',p.category)+
      infoRow('Создано',p.created)+infoRow('Удаление',p.expiration+' · '+p.daysRemaining+' дней')+
      infoRow('Разрешение',p.resolution)+infoRow('GPS',p.gps)+'</dl>';
    showSheet('Информация о фотографии',description+facts);
  }
  function status() {
    const entries=log.map(x=>'<div class="log-item"><i class="log-led '+escapeHTML(x.type)+'"></i><div><strong>'+
      escapeHTML(x.title)+' · '+escapeHTML(x.at)+'</strong><small>'+
      escapeHTML(x.text)+'</small></div></div>').join('');
    showSheet('Состояние PhotoBunker',
      '<div class="note"><strong>Текущий статус: '+escapeHTML($('#status-label').textContent)+
      '</strong><p>Операции, предупреждения и ошибки сохраняются в демо-журнале.</p></div>'+entries);
  }
  function edit() {
    const p=photo();if(!p?.editable)return;
    showSheet('Редактировать',
      '<div class="note">Демонстрационный редактор только названия и описания. Production обязан использовать существующий фоторедактор.</div>'+
      '<label>Название<input name="editName" maxlength="120" value="'+escapeHTML(p.name)+'"></label>'+
      '<label>Описание<textarea name="editDescription" maxlength="2000">'+escapeHTML(p.description)+'</textarea></label>'+
      option('save-edit','Сохранить изменения','primary'));
  }
  function deletePrompt() {
    const p=photo();if(!p?.deletable)return;
    showSheet('Удалить фотографию',
      '<div class="note">Удалить <strong>'+escapeHTML(p.id)+
      '</strong> только из демонстрационных данных? Облако, устройство и ключи не затрагиваются.</div>'+
      option('confirm-delete','Удалить из макета','danger'));
  }

  function openWeb() {
    const p=photo();if(!p)return;
    closeDownload();clearTimeout(webHide);
    $('.web-image').innerHTML=draw(p.type);
    $('.web-photo-title').textContent=p.name;
    $('.web-photo-id').textContent='PHOTO / '+p.id;
    $('.web-description').textContent=p.description;
    webLayer.hidden=false;
    requestAnimationFrame(()=>webLayer.classList.add('visible'));
    webLayer.querySelector('.in-app-browser').focus();
  }
  function closeWeb() {
    webLayer.classList.remove('visible');
    clearTimeout(webHide);
    webHide=setTimeout(()=>{
      if(!webLayer.classList.contains('visible'))webLayer.hidden=true;
    },motion(315));
  }

  function openFullscreen() {
    if(!photo())return;
    fullscreen.classList.remove('exit-up','exit-down');
    fullscreen.style.transform='';fullscreen.style.opacity='';
    fullscreen.hidden=false;
    fullscreen.classList.add('enter');
    fullscreen.focus();
  }
  function closeFullscreen(direction=0) {
    if(fullscreen.hidden)return;
    clearTimeout(fullHide);
    fullscreen.classList.remove('enter','exit-up','exit-down');
    fullscreen.style.transform='';fullscreen.style.opacity='';
    // Any vertical swipe, UP or DOWN, closes with a matching direction.
    if(direction)fullscreen.classList.add(direction<0?'exit-up':'exit-down');
    else fullscreen.classList.add('exit-down');
    fullHide=setTimeout(()=>{
      fullscreen.hidden=true;
      fullscreen.classList.remove('exit-up','exit-down');
      fullscreen.style.transform='';fullscreen.style.opacity='';
    },motion(230));
  }

  function navigateBrowser(location) {
    showSheet('Возврат в Browser',
      '<div class="note">Переход в «'+escapeHTML(location)+
      '». В production сохранить текущую папку, фильтры, позицию и полный путь. Этот UX-эталон изолирован от реального роутера.</div>');
  }

  function toggleFavorite() {
    const p=photo();if(!p)return;
    p.favorite=!p.favorite;
    if(p.favorite && !demoFavoritesFolder) {
      demoFavoritesFolder=true;
      addLog('success','Избранное','В демо создан раздел «Избранное» и добавлено '+p.id);
    } else addLog('success','Избранное',p.favorite?p.id+' добавлен в избранное':p.id+' удалён из избранного');
    render();
  }

  function setupGestures(target,fullMode) {
    let gesture=null;
    const movingSurface=fullMode ? $('.fullscreen-image') : $('.image-content');
    target.addEventListener('pointerdown', event => {
      if(event.target.closest('button') && fullMode)return;
      if(event.pointerType==='mouse' && event.button!==0)return;
      gesture={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,axis:null};
      pendingSwipeClick=false;
    });
    target.addEventListener('pointermove', event => {
      if(!gesture || event.pointerId!==gesture.id)return;
      const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
      gesture.x=event.clientX;gesture.y=event.clientY;
      if(!gesture.axis && Math.max(Math.abs(dx),Math.abs(dy))>12)
        gesture.axis=Math.abs(dx)>Math.abs(dy)*1.2?'horizontal':
          Math.abs(dy)>Math.abs(dx)*1.2?'vertical':'undecided';
      if(fullMode && gesture.axis==='vertical') {
        // Realtime drag, capped to avoid an over-eager dismiss.
        const displacement=Math.max(-260,Math.min(260,dy));
        fullscreen.style.transform='translateY('+displacement+'px)';
        fullscreen.style.opacity=String(Math.max(.48,1-Math.abs(displacement)/510));
      }
    });
    target.addEventListener('pointerup',event=>{
      if(!gesture || event.pointerId!==gesture.id)return;
      const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
      gesture=null;
      if(Math.abs(dx)>=60 && Math.abs(dx)>Math.abs(dy)*1.25) {
        pendingSwipeClick=true;
        fullscreen.style.transform='';fullscreen.style.opacity='';
        transitionTo(dx<0?1:-1);
        return;
      }
      if(fullMode && Math.abs(dy)>=86 && Math.abs(dy)>Math.abs(dx)*1.25) {
        pendingSwipeClick=true;
        closeFullscreen(Math.sign(dy));
        return;
      }
      fullscreen.style.transform='';fullscreen.style.opacity='';
    });
    target.addEventListener('pointercancel',()=>{
      gesture=null;fullscreen.style.transform='';fullscreen.style.opacity='';
    });
  }
  setupGestures(stage,false);
  setupGestures(fullscreenStage,true);

  app.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button || !app.contains(button))return;
    const action=button.dataset.action;
    if(!action)return;
    if(action==='favorite') { toggleFavorite();return; }
    if(action==='copy') { copyImage();return; }
    if(action==='download') { showDownload();return; }
    if(action==='cancel-download') { closeDownload();return; }
    if(action==='confirm-download') { confirmDownload();return; }
    if(action==='info') { information();return; }
    if(action==='status') { status();return; }
    if(action==='edit') { edit();return; }
    if(action==='public') { openWeb();return; }
    if(action==='delete') { deletePrompt();return; }
    if(action==='close-sheet') { closeSheet();return; }
    if(action==='close-web') { closeWeb();return; }
    if(action==='web-share') {
      addLog('warning','Public Card','Нельзя поделиться демонстрационной карточкой: ссылка не создана');
      closeWeb();status();return;
    }
    if(action==='fullscreen') {
      if(pendingSwipeClick){pendingSwipeClick=false;return;}
      openFullscreen();return;
    }
    if(action==='close-fullscreen') { closeFullscreen();return; }
    if(action==='previous') { transitionTo(-1);return; }
    if(action==='next') { transitionTo(1);return; }
    if(action==='back') { navigateBrowser('Детали фасада');return; }
    if(action==='path') { navigateBrowser(button.dataset.location||'Browser');return; }
    if(action==='save-edit') {
      const p=photo();if(!p?.editable)return;
      p.name=sheetContent.querySelector('[name=editName]').value.trim()||p.name;
      p.description=sheetContent.querySelector('[name=editDescription]').value;
      closeSheet();render();
      addLog('success','Изменено','Изменены демонстрационные данные '+p.id);
      return;
    }
    if(action==='confirm-delete') {
      const p=photo();if(!p?.deletable)return;
      const id=p.id;
      photos.splice(index,1);index=Math.max(0,Math.min(index,photos.length-1));
      closeSheet();render();
      addLog('success','Удалено','Фото '+id+' удалено только из макета');
    }
  });
  document.querySelectorAll('[data-device]').forEach(button=>{
    button.addEventListener('click',()=>{
      document.getElementById('device').className='device '+button.dataset.device;
      document.querySelectorAll('[data-device]').forEach(other=>{
        const selected=other===button;
        other.classList.toggle('selected',selected);
        other.setAttribute('aria-pressed',String(selected));
      });
    });
  });
  app.addEventListener('click',event=>{
    const nav=event.target.closest('[data-nav]');
    if(nav)navigateBrowser(nav.dataset.nav);
  });
  sheetLayer.addEventListener('click',event=>{if(event.target===sheetLayer)closeSheet();});
  webLayer.addEventListener('click',event=>{if(event.target===webLayer)closeWeb();});
  app.addEventListener('click',event=>{
    if(!event.target.closest('.download-pop,[data-action=download]') && !downloading)closeDownload();
  });
  app.addEventListener('keydown',event=>{
    if(event.target.closest('input,textarea,select'))return;
    if(event.key==='Escape') {
      if(!webLayer.hidden)closeWeb();
      else if(!sheetLayer.hidden)closeSheet();
      else if(!fullscreen.hidden)closeFullscreen();
      else closeDownload();
      return;
    }
    if(!sheetLayer.hidden || !webLayer.hidden || !pop.hidden)return;
    if(event.key==='ArrowLeft'){event.preventDefault();transitionTo(-1);}
    if(event.key==='ArrowRight'){event.preventDefault();transitionTo(1);}
  });
  render();
})();