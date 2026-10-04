(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields = {version:'版本', type:'模型类型', family:'基础模型／系列'};
  const visibilityLabels = {title:'标题', version:'版本', type:'模型类型', family:'基础模型／系列', format:'文件格式', size:'文件大小'};
  const defaults = () => ({title:true,version:true,type:true,family:true,format:false,size:false});
  const models = [
    {id:'lineart',title:'Pony ControlNet · Lineart',file:'pony_controlnet_lineart.safetensors',cover:'agnes-day.jpg',size:'1.45 GB',source:{version:'v1.0',type:'ControlNet',family:'Pony'},local:{version:'v1.1 · 本地修订',type:null,family:null}},
    {id:'agnes',title:'Agnes · Character LoRA',file:'agnes_character_v2.safetensors',cover:'agnes-night.jpg',size:'218 MB',source:{version:'v2.0',type:'LoRA',family:'Pony'},local:{version:null,type:null,family:null}},
    {id:'deepnegative',title:'Deep Negative',file:'ng_deepnegative_v1_75t.safetensors',cover:'deepnegative.jpg',size:'29.6 KB',source:{version:'75T',type:'Embedding',family:'SD 1.5'},local:{version:null,type:null,family:null}},
    {id:'armor',title:'Fantasy Armor · Materials and Costume Detail Study',file:'fantasy_armor.safetensors',cover:'armor.jpg',size:'144 MB',source:{version:'v1.2',type:'LoRA',family:'SDXL'},local:{version:null,type:null,family:null}},
    {id:'depth',title:'Pony ControlNet · Depth',file:'pony_controlnet_depth.safetensors',cover:'agnes-day.jpg',size:'1.45 GB',source:{version:'v1.0',type:'ControlNet',family:'Pony'},local:{version:null,type:null,family:null}},
    {id:'motion',title:'Night Drive · Cinematic Lighting',file:'night_drive_cinematic.safetensors',cover:'cars.jpg',size:'326 MB',source:{version:'v3.0',type:'LoRA',family:'SDXL'},local:{version:null,type:null,family:null}},
    {id:'archived',title:'Portrait Study · Archive',file:'portrait_study_archive.safetensors',cover:'agnes-night.jpg',size:'6.46 GB',source:{},local:{version:'2024.06',type:'Checkpoint',family:'Pony'}},
    {id:'local',title:'local.safetensors',file:'local.safetensors',cover:null,size:'12.4 MB',source:{},local:{version:null,type:null,family:null}},
  ];
  const effective = (m,f) => m.local[f] || m.source[f] || '';
  const normalize = value => value.trim() || null;
  let counter = 2;
  const newSession = (id,label,query='') => ({id,label,query,filter:'',selection:'lineart',scroll:0,showInspector:innerWidth>700,visible:defaults(),drafts:new Map(),results:[]});
  let sessions = [newSession(1,'模型'),newSession(2,'Pony','Pony')];
  let activeId = 1;
  let failNext = false;
  let slowSave = false;
  let refreshTimer;
  const active = () => sessions.find(s => s.id===activeId);
  const model = id => models.find(m => m.id===id);
  const draftKey = (id,field) => `${id}:${field}`;
  const fullText = m => [m.title,m.file,...Object.keys(fields).map(f=>effective(m,f))].join(' ').toLowerCase();

  function refreshResults(s) {
    const terms = [s.query.trim(),s.filter.trim()].filter(Boolean).map(v=>v.toLowerCase());
    s.results = models.filter(m=>terms.every(q=>fullText(m).includes(q))).map(m=>m.id);
  }
  sessions.forEach(refreshResults);

  function cardInfo(m,s) {
    const v=s.visible;
    const title=v.title?`<h2 class="card-title">${escape(m.title)}</h2>`:'';
    const version=v.version&&effective(m,'version')?`<div class="card-version">${escape(effective(m,'version'))}</div>`:'';
    const classifications=['type','family'].filter(f=>v[f]&&effective(m,f)).map(f=>`<span title="${fields[f]}：${escape(effective(m,f))}">${escape(effective(m,f))}</span>`).join('');
    const extra=[v.format?'SafeTensors':'',v.size?m.size:''].filter(Boolean).map(x=>`<span>${escape(x)}</span>`).join('');
    const content=title+version+(extra?`<div class="card-extra">${extra}</div>`:'');
    return (classifications?`<div class="classification">${classifications}</div>`:'')+(content?`<div class="card-info">${content}</div>`:'');
  }
  function renderGrid() {
    const s=active(); if(!s)return;
    $('grid').innerHTML=s.results.map(id=>{
      const m=model(id);
      return `<button class="model-card" data-model="${id}" aria-label="选择 ${escape(m.title)}" aria-pressed="${s.selection===id}" title="${escape(m.title)}"><span class="cover">${m.cover?`<img src="assets/${m.cover}" alt="" draggable="false">`:`<span class="no-cover">${icon('box')}</span>`}</span>${cardInfo(m,s)}</button>`;
    }).join('');
    $('grid').querySelectorAll('.model-card').forEach(card=>card.onclick=()=>selectModel(card.dataset.model));
    $('empty').hidden=s.results.length>0;
    updateCount(); updateLocate();
  }
  function updateCards() {
    const s=active(); if(!s)return;
    $('grid').querySelectorAll('.model-card').forEach(card=>{
      card.querySelectorAll('.card-info,.classification').forEach(info=>info.remove());
      card.insertAdjacentHTML('beforeend',cardInfo(model(card.dataset.model),s));
      card.setAttribute('aria-pressed',String(card.dataset.model===s.selection));
    });
  }
  function updateLocate() {$('locate').disabled=!active()?.results.includes(active()?.selection);}
  function updateCount(message) {
    const s=active();
    $('result-count').textContent=message||(s?`${s.results.length} 个模型${s.query||s.filter?' · 已筛选':''}`:'');
  }
  function renderTabs() {
    $('tabs').innerHTML=sessions.map(s=>`<div class="tab-item ${s.id===activeId?'active':''}"><button class="tab" role="tab" aria-selected="${s.id===activeId}" tabindex="${s.id===activeId?0:-1}" data-tab="${s.id}">${icon('box')}<span>${escape(s.label)}</span></button><button class="icon-button" data-close="${s.id}" aria-label="关闭 ${escape(s.label)} 标签">${icon('close')}</button></div>`).join('');
    $('tabs').querySelectorAll('[data-tab]').forEach(button=>{
      button.onclick=()=>switchTab(Number(button.dataset.tab));
      button.onkeydown=e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault(); const i=sessions.findIndex(s=>s.id===activeId);
        const next=e.key==='Home'?0:e.key==='End'?sessions.length-1:(i+(e.key==='ArrowRight'?1:-1)+sessions.length)%sessions.length;
        switchTab(sessions[next].id); $('tabs').querySelector(`[data-tab="${activeId}"]`).focus();
      };
    });
    $('tabs').querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>closeTab(Number(button.dataset.close)));
  }
  function preserveView() {const s=active(); if(s)s.scroll=$('grid-scroll').scrollTop;}
  function switchTab(id) {preserveView();activeId=id;hidePopovers();renderSession();}
  function renderSession() {
    const s=active(); renderTabs();
    $('workspace').querySelector('.collection').hidden=!s;
    $('no-tabs').hidden=Boolean(s);
    $('inspector').hidden=!s;
    if(!s){updateCount();return;}
    $('search-input').value=s.query;
    $('filter-input').value=s.filter;
    $('filter-trigger').classList.toggle('applied',Boolean(s.filter));
    $('workspace').classList.toggle('no-inspector',!s.showInspector);
    $('inspector-toggle').setAttribute('aria-pressed',String(s.showInspector));
    renderGrid(); renderInspector(); renderVisibility();
    $('grid-scroll').scrollTop=s.scroll;
  }
  function openModel() {
    preserveView(); const s=newSession(++counter,`模型 ${counter}`);refreshResults(s);
    sessions.push(s);activeId=s.id;hidePopovers();renderSession();
  }
  async function closeTab(id) {
    const s=sessions.find(x=>x.id===id);if(!s)return;
    await Promise.all([...s.drafts.values()].map(d=>flush(d)));
    if(s.drafts.size){switchTab(id);const d=[...s.drafts.values()][0];selectModel(d.modelId);updateCount('仍有未保存修改，请先处理');return;}
    preserveView();const i=sessions.indexOf(s);sessions=sessions.filter(x=>x.id!==id);
    if(activeId===id)activeId=sessions[Math.min(i,sessions.length-1)]?.id??null;
    renderSession();
  }
  function selectModel(id) {
    const s=active(); if(!s)return;s.selection=id;s.showInspector=true;
    $('workspace').classList.remove('no-inspector');$('inspector-toggle').setAttribute('aria-pressed','true');
    updateCards();renderInspector();updateLocate();
  }
  function toggleInspector() {const s=active();if(!s)return;s.showInspector=!s.showInspector;$('workspace').classList.toggle('no-inspector',!s.showInspector);$('inspector-toggle').setAttribute('aria-pressed',String(s.showInspector));}

  function renderInspector() {
    const s=active(),m=model(s?.selection);if(!m)return;
    $('inspector-content').innerHTML=`<section class="inspector-section"><div class="model-heading">${icon('box')}<h1>${escape(m.title)}</h1></div><p class="filename">${escape(m.file)}</p></section>
      <section class="inspector-section"><div class="section-heading"><h2>本地资料</h2><button class="icon-button" aria-label="本地资料与来源信息的规则" popovertarget="info-popover">${icon('info')}</button></div>${Object.entries(fields).map(([f,label])=>`<div class="field" data-field="${f}"><div class="field-label"><label for="edit-${f}">${label}</label><span class="field-origin" id="origin-${f}"></span></div><input id="edit-${f}" aria-describedby="origin-${f} state-${f}" autocomplete="off" maxlength="180"><div class="field-state" id="state-${f}" aria-live="polite"></div><div id="recovery-${f}" class="recovery"></div></div>`).join('')}</section>
      <section class="inspector-section"><h2>文件</h2><dl class="facts"><dt>格式</dt><dd>SafeTensors</dd><dt>大小</dt><dd>${m.size}</dd><dt>位置</dt><dd>models / ${escape(m.file)}</dd></dl></section>
      <section class="inspector-section"><h2>Components</h2><div class="components"><span class="component">${icon('file')}File</span><span class="component">${icon('box')}Model</span>${Object.keys(m.source).length?'<span class="component">Civitai</span>':''}</div></section>`;
    for(const f of Object.keys(fields)){
      const d=s.drafts.get(draftKey(m.id,f));const input=$(`edit-${f}`);
      input.value=d?d.input:m.local[f]??'';
      input.placeholder=m.source[f]||'未设置';
      input.oninput=()=>editField(s,m,f,input.value);
      input.onblur=()=>{const current=s.drafts.get(draftKey(m.id,f));if(current)flush(current);};
    }
    $('inspector-content').scrollTop=0;
    updateEditorFeedback();
  }
  function editField(s,m,field,value) {
    const key=draftKey(m.id,field);
    let d=s.drafts.get(key);
    if(!d){d={session:s,modelId:m.id,field,base:m.local[field],input:value,state:'pending',timer:null,running:null};s.drafts.set(key,d);}
    d.input=value;
    if(d.state!=='conflict'){d.state='pending';clearTimeout(d.timer);d.timer=setTimeout(()=>flush(d),600);}
    updateEditorFeedback();
  }
  async function flush(d) {
    clearTimeout(d.timer);
    if(d.running){await d.running;if(d.session.drafts.has(draftKey(d.modelId,d.field))&&d.state==='pending')return flush(d);return;}
    if(['conflict','failed'].includes(d.state))return;
    const m=model(d.modelId),value=normalize(d.input),expected=d.base,key=draftKey(m.id,d.field);
    if(value===expected){d.session.drafts.delete(key);updateEditorFeedback();if(!active()?.drafts.size)updateCount();return;}
    const shouldFail=failNext;failNext=false;
    if(shouldFail)$('demo-state').textContent='已触发一次模拟失败；重试将正常保存。';
    d.state='saving';updateEditorFeedback();
    d.running=new Promise(resolve=>setTimeout(resolve,slowSave?2600:280));
    await d.running;d.running=null;
    if(shouldFail){d.state='failed';}
    else if(m.local[d.field]!==expected){d.state='conflict';d.observed=m.local[d.field];}
    else{
      m.local[d.field]=value;d.base=value;
      if(normalize(d.input)===value)d.session.drafts.delete(key);
      else{d.state='pending';d.timer=setTimeout(()=>flush(d),300);}
    }
    updateCards();updateEditorFeedback();
    if(!active()?.drafts.size)updateCount();
    // Other sessions keep their private drafts; untouched fields observe shared data.
    syncUntouchedInputs();
  }
  function syncUntouchedInputs() {
    const s=active(),m=model(s?.selection);if(!m)return;
    Object.keys(fields).forEach(f=>{const input=$(`edit-${f}`);if(input&&!s.drafts.has(draftKey(m.id,f))&&document.activeElement!==input)input.value=m.local[f]??'';});
  }
  function updateEditorFeedback() {
    const s=active(),m=model(s?.selection);if(!m)return;
    for(const f of Object.keys(fields)){
      const input=$(`edit-${f}`);if(!input)continue;
      const d=s.drafts.get(draftKey(m.id,f)),error=d&&['conflict','failed'].includes(d.state);
      $(`origin-${f}`).textContent=m.local[f]?'本地值':m.source[f]?'来源 · Civitai':'无来源值';
      input.setAttribute('aria-invalid',String(Boolean(error)));
      const status=d?.state==='conflict'?'此字段已被其他编辑修改':d?.state==='failed'?'保存失败，修改仍保留':d?.state==='saving'&&slowSave?'正在保存…':d?.state==='pending'?'尚未保存':'';
      $(`state-${f}`).textContent=status;$(`state-${f}`).classList.toggle('field-error',Boolean(error));
      const recovery=$(`recovery-${f}`);recovery.replaceChildren();
      if(d?.state==='failed')addRecovery(recovery,'重试',()=>{d.state='pending';flush(d);});
      if(d?.state==='conflict'){
        const saved=document.createElement('div');saved.className='saved-value';saved.textContent=`已保存：${d.observed??'留空（使用来源）'}`;recovery.append(saved);
        addRecovery(recovery,'使用已保存值',()=>{s.drafts.delete(draftKey(m.id,f));input.value=m.local[f]??'';updateEditorFeedback();updateCards();});
        addRecovery(recovery,'保存我的值',()=>{d.base=d.observed;d.state='pending';flush(d);});
      }
    }
  }
  function addRecovery(parent,label,action){const button=document.createElement('button');button.textContent=label;button.onclick=action;parent.append(button);}
  function renderVisibility(){const s=active();if(!s)return;$('display-options').innerHTML=Object.entries(visibilityLabels).map(([f,label])=>`<label class="check-row"><input type="checkbox" data-visible="${f}" ${s.visible[f]?'checked':''}>${label}</label>`).join('');$('display-options').querySelectorAll('input').forEach(input=>input.onchange=()=>{s.visible[input.dataset.visible]=input.checked;updateCards();});}
  function hidePopovers(){document.querySelectorAll('[popover]').forEach(p=>{if(p.matches(':popover-open'))p.hidePopover();});}

  $('new-model').onclick=openModel;$('empty-new').onclick=openModel;
  $('search-input').oninput=e=>{const s=active();s.query=e.target.value;s.scroll=0;refreshResults(s);renderGrid();$('grid-scroll').scrollTop=0;};
  $('grid-scroll').onscroll=()=>{const s=active();if(s)s.scroll=$('grid-scroll').scrollTop;};
  $('clear-query').onclick=()=>{const s=active();s.query='';s.filter='';refreshResults(s);renderSession();};
  $('inspector-toggle').onclick=toggleInspector;$('close-inspector').onclick=toggleInspector;
  $('locate').onclick=()=>$('grid').querySelector(`[data-model="${active().selection}"]`)?.scrollIntoView({block:'nearest'});
  $('refresh').onclick=()=>{const s=active();clearTimeout(refreshTimer);updateCount('正在刷新…');refreshTimer=setTimeout(()=>{refreshResults(s);if(active()===s){renderGrid();updateCount();}},500);};
  $('display-popover').addEventListener('beforetoggle',e=>{if(e.newState==='open'){$('display-popover').style.left=`${Math.min(innerWidth-216,Math.max(12,$('display-trigger').getBoundingClientRect().right-204))}px`;renderVisibility();}});
  $('filter-popover').addEventListener('beforetoggle',e=>{if(e.newState==='open'){$('filter-input').value=active()?.filter??'';$('filter-error').textContent='';}});
  $('filter-apply').onclick=()=>{const s=active();s.filter=$('filter-input').value.trim();s.scroll=0;refreshResults(s);hidePopovers();renderSession();};
  $('filter-clear').onclick=()=>{$('filter-input').value='';};
  $('cover-only').onclick=()=>{Object.keys(active().visible).forEach(f=>active().visible[f]=false);updateCards();renderVisibility();};
  $('display-default').onclick=()=>{active().visible=defaults();updateCards();renderVisibility();};
  $('slow-save').onchange=e=>{slowSave=e.target.checked;};
  $('fail-next').onclick=()=>{failNext=true;$('demo-state').textContent='下一次修改将模拟保存失败。';};
  $('conflict-next').onclick=()=>{
    const s=active(),m=model(s?.selection);if(!m){$('demo-state').textContent='请先打开模型页。';return;}
    m.local.version=`v${Date.now().toString().slice(-4)} · 其他编辑`;
    updateCards();syncUntouchedInputs();updateEditorFeedback();
    $('demo-state').textContent='示例中另一处已改写版本；已有草稿保存时会检查旧值。';
  };
  window.addEventListener('beforeunload',e=>{if(sessions.some(s=>s.drafts.size)){e.preventDefault();e.returnValue='';}});
  renderSession();
})();
