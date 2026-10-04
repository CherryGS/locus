(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields = {version:'版本', type:'模型类型', family:'基础模型／系列'};
  const visibilityLabels = {title:'标题',version:'版本',type:'模型类型',family:'基础模型／系列',dimensions:'像素尺寸',format:'文件格式',size:'文件大小'};
  const defaults = () => ({title:true,version:true,type:true,family:true,dimensions:true,format:false,size:false});
  const models = [
    {id:'lineart',title:'Pony ControlNet · Lineart',file:'pony_controlnet_lineart.safetensors',cover:'agnes-day.jpg',size:'1.45 GB',source:{version:'v1.0',type:'ControlNet',family:'Pony'},local:{version:'v1.1 · 本地修订',type:null,family:null}},
    {id:'agnes',title:'Agnes · Character LoRA',file:'agnes_character_v2.safetensors',cover:'agnes-night.jpg',size:'218 MB',source:{version:'v2.0',type:'LoRA',family:'Pony'},local:{version:null,type:null,family:null}},
    {id:'deepnegative',title:'Deep Negative',file:'ng_deepnegative_v1_75t.safetensors',cover:'deepnegative.jpg',size:'29.6 KB',source:{version:'75T',type:'Embedding',family:'SD 1.5'},local:{version:null,type:null,family:null}},
    {id:'armor',title:'Fantasy Armor · Materials and Costume Detail Study / 人物与材质参考 · SDXL 版本记录',file:'fantasy_armor.safetensors',cover:'armor.jpg',size:'144 MB',source:{version:'v1.2',type:'LoRA',family:'SDXL'},local:{version:null,type:null,family:null}},
    {id:'depth',title:'Pony ControlNet · Depth',file:'pony_controlnet_depth.safetensors',cover:'agnes-day.jpg',size:'1.45 GB',source:{version:'v1.0',type:'ControlNet',family:'Pony'},local:{version:null,type:null,family:null}},
    {id:'motion',title:'Night Drive · Cinematic Lighting',file:'night_drive_cinematic.safetensors',cover:'cars.jpg',size:'326 MB',source:{version:'v3.0',type:'LoRA',family:'SDXL'},local:{version:null,type:null,family:null}},
    {id:'archived',title:'Portrait Study · Archive',file:'portrait_study_archive.safetensors',cover:'agnes-night.jpg',size:'6.46 GB',source:{},local:{version:'2024.06',type:'Checkpoint',family:'Pony'}},
    {id:'local',title:'local.safetensors',file:'local.safetensors',cover:null,size:'12.4 MB',source:{},local:{version:null,type:null,family:null}},
  ];

  models.push(
    {id:'photo-day',kind:'media',title:'午后光线 · 人物参考',file:'afternoon_reference.jpg',cover:'agnes-day.jpg',dimensions:'示例 768 × 1024',size:'1.2 MB',source:{},local:{}},
    {id:'photo-drive',kind:'media',title:'Night Drive · 光影与场景参考',file:'night_drive_reference.jpg',cover:'cars.jpg',dimensions:'示例 1024 × 768',size:'2.1 MB',source:{},local:{}}
  );
  const effective = (m,f) => m.local[f] || m.source[f] || '';
  const normalize = value => value.trim() || null;
  const model = id => models.find(m=>m.id===id);
  const draftKey = (id,field) => `${id}:${field}`;
  const names={model:'模型',media:'媒体',all:'全部内容',tags:'标签管理'};
  const icons={model:'box',media:'image',all:'list',tags:'tag',direct:'file'};
  const fullText=m=>[m.title,m.file,...Object.keys(fields).map(f=>effective(m,f))].join(' ').toLowerCase();
  let serial=0,clock=0,activeId=null,failNext=false,slowSave=false,dialogIntent=0,contextTarget=null,tagSession=null;
  let sessions=[];
  const taskRecords=[{id:1,modelId:'armor'}];
  const counters={model:0,media:0,all:0};
  const active=()=>sessions.find(s=>s.id===activeId);
  const visit=s=>s?.history[s.cursor];
  const problemDrafts=s=>[...s.drafts.values()].filter(d=>['failed','conflict'].includes(d.state));
  const newSession=(kind,label)=>({id:++serial,kind,label,query:'',filter:'',selection:null,scroll:0,showInspector:false,coverOnly:false,visible:defaults(),drafts:new Map(),results:[],history:[{view:'grid'}],cursor:0,used:++clock,tag:'Models',refreshing:false,closeNotice:false,closing:false});

  function refreshResults(s){
    const terms=[s.query.trim(),s.filter.trim()].filter(Boolean).map(v=>v.toLowerCase());
    s.results=models.filter(m=>(s.kind==='all'||(s.kind==='media'?m.kind==='media':m.kind!=='media'))&&terms.every(q=>fullText(m).includes(q))).map(m=>m.id);
    if(!s.selection)s.selection=s.results[0]??null;
  }
  function updateCount(message){
    const s=active();
    $('result-count').textContent=message||(s?(s.closeNotice?'仍有未保存修改，请先处理':s.kind==='tags'?'2 个根标签':`${s.results.length} 项${s.query||s.filter?' · 已筛选':''}${s.refreshing?' · 正在刷新…':''}`):'');
  }
  function cardInfo(m,s){
    const v=s.visible;
    const title=v.title&&m.cover?`<h2 class="card-title">${escape(m.title)}</h2>`:'';
    const version=v.version&&effective(m,'version')?`<div class="card-version">${escape(effective(m,'version'))}</div>`:'';
    const badges=['type','family'].filter(f=>v[f]&&effective(m,f)).map(f=>`<span title="${fields[f]}：${escape(effective(m,f))}">${escape(effective(m,f))}</span>`).join('');
    const extra=[v.dimensions?m.dimensions:'',v.format?(m.kind==='media'?'JPEG':'SafeTensors'):'',v.size?m.size:''].filter(Boolean).map(x=>`<span>${escape(x)}</span>`).join('');
    const content=title+version+(extra?`<div class="card-extra">${extra}</div>`:'');
    return (badges?`<div class="classification">${badges}</div>`:'')+(content?`<div class="card-info">${content}</div>`:'');
  }
  function renderGrid(){
    const s=active();if(!s)return;
    $('grid').classList.toggle('cover-only',s.coverOnly);
    $('grid').innerHTML=s.results.map(id=>{const m=model(id);return `<button class="model-card" data-model="${id}" aria-label="${escape(m.title)}" aria-pressed="${s.selection===id}" title="${escape(m.title)}"><span class="cover">${m.cover?`<img src="assets/${m.cover}" alt="" draggable="false">`:`<span class="no-cover">${icon('box')}<span>${escape(m.title)}</span></span>`}</span>${cardInfo(m,s)}</button>`;}).join('');
    $('grid').querySelectorAll('.model-card').forEach(card=>{
      card.onclick=()=>selectModel(card.dataset.model);
      card.ondblclick=()=>openDetail(card.dataset.model);
      card.oncontextmenu=e=>{e.preventDefault();contextTarget={page:s,id:card.dataset.model};const p=$('card-menu');p.style.left=`${Math.max(8,Math.min(innerWidth-210,e.clientX))}px`;p.style.top=`${Math.min(innerHeight-50,e.clientY)}px`;p.showPopover();};
      card.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();openDetail(card.dataset.model);}if(e.key.startsWith('Arrow')){e.preventDefault();const cards=[...$('grid').querySelectorAll('.model-card')],i=cards.indexOf(card),cols=Math.max(1,Math.floor($('grid').clientWidth/252)),offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols}[e.key];cards[Math.max(0,Math.min(cards.length-1,i+offset))]?.focus();}};
    });
    $('empty').hidden=!!s.results.length;
    updateCount();updateNavigation();
  }
  function updateCards(){const s=active();if(!s)return;$('grid').classList.toggle('cover-only',s.coverOnly);$('grid').querySelectorAll('.model-card').forEach(card=>{card.querySelectorAll('.card-info,.classification').forEach(n=>n.remove());card.insertAdjacentHTML('beforeend',cardInfo(model(card.dataset.model),s));card.setAttribute('aria-pressed',String(card.dataset.model===s.selection));});}
  function updateLocate(){updateNavigation();}
  function updateNavigation(){
    const s=active(),detail=visit(s)?.view==='detail';
    $('back').disabled=!s||s.cursor===0;$('forward').disabled=!s||s.cursor===s.history.length-1;
    $('source-return').disabled=!detail;$('source-return').title=s?.kind==='direct'?'关闭详情标签':'返回来源';
    $('locate').disabled=!s||detail||!s.results.includes(s.selection);
    $('refresh').disabled=!s||s.kind==='tags'||s.kind==='direct'||s.refreshing;
  }
  function updateAttention(){
    for(const s of sessions){const button=$('tabs').querySelector(`[data-attention="${s.id}"]`);if(button){button.hidden=!problemDrafts(s).length;button.setAttribute('aria-label',`${s.label}：${problemDrafts(s).length} 项修改需处理`);}if(!s.drafts.size)s.closeNotice=false;}
  }
  function renderTabs(){
    const position=$('tabs').scrollLeft;
    $('tabs').innerHTML=sessions.map(s=>`<div class="tab-item ${s.id===activeId?'active':''}"><button id="tab-${s.id}" class="tab" role="tab" aria-controls="page-panel" aria-selected="${s.id===activeId}" tabindex="${s.id===activeId?0:-1}" data-tab="${s.id}" title="${escape(s.label)}">${icon(icons[s.kind])}<span>${escape(s.label)}</span></button><button class="attention-dot" data-attention="${s.id}" aria-label="${escape(s.label)}：修改需处理" title="修改需处理" ${problemDrafts(s).length?'':'hidden'}><span></span></button><button class="icon-button" data-close="${s.id}" aria-label="关闭 ${escape(s.label)} 标签">${icon('close')}</button></div>`).join('');
    $('tabs').scrollLeft=position;
    $('tabs').querySelectorAll('[data-tab]').forEach(button=>{
      button.onclick=()=>switchTab(Number(button.dataset.tab),true);
      button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=sessions.findIndex(s=>s.id===Number(button.dataset.tab)),next=e.key==='Home'?0:e.key==='End'?sessions.length-1:(i+(e.key==='ArrowRight'?1:-1)+sessions.length)%sessions.length;switchTab(sessions[next].id,true);};
    });
    $('tabs').querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeTab(Number(b.dataset.close)));
    $('tabs').querySelectorAll('[data-attention]').forEach(b=>b.onclick=()=>showAttention(Number(b.dataset.attention),b));
    $('tab-list-trigger').hidden=!sessions.length;
    if(activeId)$('tabs').querySelector(`[data-tab="${activeId}"]`)?.closest('.tab-item').scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function preserveView(){const s=active();if(s&&visit(s).view==='grid')s.scroll=$('grid-scroll').scrollTop;}
  function switchTab(id,focus=false){preserveView();activeId=id;const s=active();if(s)s.used=++clock;hidePopovers();renderSession();if(focus)$(`tab-${id}`)?.focus();}
  function renderSession(){
    const s=active();renderTabs();$('page-panel').hidden=!s;$('page-toolbar').hidden=!s;$('no-tabs').hidden=!!s;
    $('inspector').hidden=!s||s.kind==='tags';
    if(!s){updateCount();return;}
    const detail=visit(s).view==='detail',tags=s.kind==='tags';
    $('page-panel').setAttribute('aria-labelledby',`tab-${s.id}`);
    $('grid-scroll').hidden=detail||tags;$('detail-view').hidden=!detail;$('tags-view').hidden=!tags;
    document.querySelector('.search-group').hidden=detail||tags;$('filmstrip').hidden=!detail;$('page-caption').hidden=!tags;$('page-caption').textContent='标签管理';
    $('display-trigger').disabled=tags||detail;$('inspector-toggle').disabled=tags;
    $('search-input').value=s.query;$('search-input').placeholder=`搜索${names[s.kind]||'内容'}…`;$('search-input').setAttribute('aria-label',`搜索${names[s.kind]||'内容'}`);
    $('filter-input').value=s.filter;$('filter-trigger').classList.toggle('applied',!!s.filter);
    $('workspace').classList.toggle('no-inspector',!s.showInspector||tags);$('inspector-toggle').setAttribute('aria-pressed',String(s.showInspector));
    if(tags){renderTag();}else{renderGrid();if(detail)renderDetail();renderInspector();renderVisibility();}
    $('grid-scroll').scrollTop=s.scroll;updateNavigation();updateCount();
  }
  function openPage(kind='model'){
    if(kind==='tags'&&sessions.includes(tagSession)){switchTab(tagSession.id,true);return;}
    preserveView();const n=kind==='tags'?1:++counters[kind];const s=kind==='tags'&&tagSession?tagSession:newSession(kind,`${names[kind]}${n>1?' '+n:''}`);
    if(kind==='tags')tagSession=s;else refreshResults(s);
    sessions.push(s);activeId=s.id;s.used=++clock;hidePopovers();renderSession();$(`tab-${s.id}`).focus();
  }
  function openDirect(id,long=false){
    preserveView();const m=model(id),s=newSession('direct',m.title);
    s.selection=id;s.results=[id];s.history=[{view:'detail',id}];sessions.push(s);activeId=s.id;hidePopovers();renderSession();$(`tab-${s.id}`).focus();
  }
  async function closeTab(id){
    const s=sessions.find(x=>x.id===id);if(!s||s.closing)return;s.closing=true;
    await Promise.all([...s.drafts.values()].map(d=>flush(d)));s.closing=false;
    if(s.drafts.size){s.closeNotice=true;updateAttention();if(active()===s)updateCount();return;}
    const wasActive=activeId===id;preserveView();sessions=sessions.filter(x=>x.id!==id);
    if(wasActive){activeId=[...sessions].sort((a,b)=>b.used-a.used)[0]?.id??null;if(active())active().used=++clock;}
    renderSession();if(wasActive){if(activeId)$(`tab-${activeId}`).focus();else $('empty-new').focus();}
  }
  function selectModel(id){const s=active();if(!s)return;s.selection=id;updateCards();if(s.showInspector)renderInspector();updateNavigation();}
  function toggleInspector(){const s=active();if(!s)return;s.showInspector=!s.showInspector;$('workspace').classList.toggle('no-inspector',!s.showInspector);$('inspector-toggle').setAttribute('aria-pressed',String(s.showInspector));if(s.showInspector)renderInspector();}
  function openDetail(id){const s=active();if(!s)return;preserveView();s.history=s.history.slice(0,s.cursor+1);s.history.push({view:'detail',id});s.cursor++;s.selection=id;renderSession();$('detail-view').focus();}
  function goHistory(delta){const s=active();if(!s)return;const next=s.cursor+delta;if(next<0||next>=s.history.length)return;preserveView();s.cursor=next;if(visit(s).id)s.selection=visit(s).id;renderSession();}
  function sourceReturn(){const s=active();if(!s||visit(s).view!=='detail')return;if(s.kind==='direct'){closeTab(s.id);return;}s.history=s.history.slice(0,s.cursor+1);s.history.push({view:'grid'});s.cursor++;renderSession();$('grid').querySelector(`[data-model="${s.selection}"]`)?.focus({preventScroll:true});}
  function renderDetail(){const s=active(),m=model(s.selection);$('detail-view').tabIndex=-1;$('detail-view').innerHTML=`<div class="detail-art">${m.cover?`<img src="assets/${m.cover}" alt="${escape(m.title)}">`:`<div class="detail-fallback">${icon('box')}<span>${escape(m.title)}</span></div>`}</div><div class="detail-caption"><h1>${escape(m.title)}</h1><span>${escape(m.file)}</span></div>`;$('filmstrip').innerHTML=s.results.map(id=>{const item=model(id);return `<button class="film-frame" data-frame="${id}" title="${escape(item.title)}" aria-label="查看 ${escape(item.title)}" aria-pressed="${id===m.id}">${item.cover?`<img src="assets/${item.cover}" alt="">`:icon('box')}</button>`;}).join('');$('filmstrip').querySelectorAll('button').forEach(b=>b.onclick=()=>openDetail(b.dataset.frame));}
  function renderTag(){const s=active();$('tags-view').querySelectorAll('[data-tag]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.tag===s.tag));b.onclick=()=>{s.tag=b.dataset.tag;renderTag();};});$('tag-children').innerHTML=(s.tag==='Models'?['Pony','SDXL']:['人物','光影']).map(t=>`<span class="tag-leaf">${escape(t)}</span>`).join('');updateCount();}
  function showAttention(id,anchor){const s=sessions.find(x=>x.id===id),p=$('attention-popover');$('attention-items').replaceChildren();for(const d of problemDrafts(s)){const b=document.createElement('button');b.className='menu-item';b.textContent=`${model(d.modelId).title} · ${fields[d.field]}`;b.onclick=()=>{switchTab(s.id);s.selection=d.modelId;s.showInspector=true;renderSession();$(`edit-${d.field}`).focus();};$('attention-items').append(b);}const r=anchor.getBoundingClientRect();p.style.left=`${Math.max(8,Math.min(innerWidth-310,r.left))}px`;p.style.top='44px';p.showPopover();}
  function renderInspector() {
    const s=active(),m=model(s?.selection);if(!m)return;
    if(m.kind==='media'){$('inspector-content').innerHTML=`<section class="inspector-section"><h1>${escape(m.title)}</h1><p class="filename">${escape(m.file)}</p><dl class="facts"><dt>尺寸</dt><dd>${escape(m.dimensions)}</dd><dt>格式</dt><dd>JPEG</dd></dl></section>`;return;}
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
    updateAttention();
    const s=active(),m=model(s?.selection);if(!m)return;
    for(const f of Object.keys(fields)){
      const input=$(`edit-${f}`);if(!input)continue;
      const d=s.drafts.get(draftKey(m.id,f)),error=d&&['conflict','failed'].includes(d.state);
      $(`origin-${f}`).textContent='';
      input.setAttribute('aria-invalid',String(Boolean(error)));
      const status=d?.state==='conflict'?'此字段已被其他编辑修改':d?.state==='failed'?'保存失败，修改仍保留':d?.state==='saving'&&slowSave?'正在保存…':d?.state==='pending'?'尚未保存':'';
      $(`state-${f}`).textContent=status;$(`state-${f}`).classList.toggle('field-error',Boolean(error));
      const recovery=$(`recovery-${f}`);recovery.replaceChildren();
      if(d?.state==='failed'){addRecovery(recovery,'重试',()=>{d.state='pending';flush(d);});addRecovery(recovery,'放弃修改',()=>{s.drafts.delete(draftKey(m.id,f));input.value=m.local[f]??'';updateEditorFeedback();updateCount();});}
      if(d?.state==='conflict'){
        const saved=document.createElement('div');saved.className='saved-value';saved.textContent=`已保存：${d.observed??'留空（使用来源）'}`;recovery.append(saved);
        addRecovery(recovery,'使用已保存值',()=>{s.drafts.delete(draftKey(m.id,f));input.value=m.local[f]??'';updateEditorFeedback();updateCards();});
        addRecovery(recovery,'保存我的值',()=>{d.base=d.observed;d.state='pending';flush(d);});
      }
    }
  }
  function addRecovery(parent,label,action){const button=document.createElement('button');button.textContent=label;button.onclick=action;parent.append(button);}

  function renderVisibility(){const s=active();if(!s)return;$('display-options').innerHTML=Object.entries(visibilityLabels).map(([f,label])=>`<label class="check-row"><input type="checkbox" data-visible="${f}" ${s.visible[f]?'checked':''}>${label}</label>`).join('');$('cover-only').checked=s.coverOnly;$('display-options').querySelectorAll('input').forEach(input=>input.onchange=()=>{s.visible[input.dataset.visible]=input.checked;updateCards();});}
  function hidePopovers(){document.querySelectorAll('[popover]').forEach(p=>{if(p.matches(':popover-open'))p.hidePopover();});}
  function openDialog(kind){
    hidePopovers();const token=++dialogIntent;$('global-dialog').dataset.kind=kind;
    $('dialog-title').textContent={tasks:'任务',settings:'设置',notifications:'通知'}[kind];
    if(kind==='tasks')$('dialog-content').innerHTML=taskRecords.map(record=>`<div class="task-record"><span class="task-done">已完成</span><h3>导入模型示例 ${record.id}</h3><p>${escape(model(record.modelId).title)}</p><button data-view-result="${record.modelId}" class="text-button bordered">查看结果</button><span class="view-pending" role="status"></span></div>`).join('');
    else if(kind==='settings')$('dialog-content').innerHTML='<div class="settings-sample"><h3>当前资料库</h3><dl class="facts"><dt>名称</dt><dd>交互样例</dd><dt>存储</dt><dd>本页内存 · 刷新重置</dd></dl><p class="muted">此处仅演示设置弹窗的工作区位置。</p></div>';
    else $('dialog-content').innerHTML='<div class="dialog-empty">暂无通知</div>';
    if(!$('global-dialog').open)$('global-dialog').showModal();
    $('dialog-close').focus();
    let currentView=0;
    if(kind==='tasks')$('dialog-content').querySelectorAll('[data-view-result]').forEach(button=>button.onclick=()=>{const intent=++currentView;button.disabled=true;button.nextElementSibling.textContent='正在读取…';setTimeout(()=>{if(token!==dialogIntent||intent!==currentView||!$('global-dialog').open)return;openDirect(button.dataset.viewResult);$('global-dialog').close();queueMicrotask(()=>$(`tab-${activeId}`)?.focus());},1000);});
  }
  $('global-dialog').addEventListener('close',()=>{dialogIntent++;});
  $('global-dialog').addEventListener('cancel',e=>{e.stopPropagation();dialogIntent++;});
  $('dialog-close').onclick=()=>{$('global-dialog').close();};
  $('tasks-trigger').onclick=()=>openDialog('tasks');$('settings-trigger').onclick=()=>openDialog('settings');$('notifications-trigger').onclick=()=>openDialog('notifications');
  $('import-demo').onclick=()=>{hidePopovers();taskRecords.push({id:taskRecords.length+1,modelId:'armor'});$('task-count').textContent=String(taskRecords.length);$('demo-state').textContent='已添加一个内存中的导入示例。';};
  $('new-model').onclick=()=>openPage();document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openPage(b.dataset.open));
  $('many-tabs').onclick=()=>{for(let i=0;i<8;i++)openPage();};$('long-detail').onclick=()=>{openDirect('armor',true);};
  $('tab-list').addEventListener('beforetoggle',e=>{if(e.newState!=='open')return;$('tab-list-items').innerHTML=sessions.map(s=>`<button class="menu-item" data-jump="${s.id}">${icon(icons[s.kind])}<span>${escape(s.label)}</span>${s.id===activeId?'<span class="menu-note">当前</span>':''}</button>`).join('');$('tab-list-items').querySelectorAll('button').forEach(b=>b.onclick=()=>switchTab(Number(b.dataset.jump),true));});
  $('search-input').oninput=e=>{const s=active();s.query=e.target.value;s.scroll=0;refreshResults(s);renderGrid();$('grid-scroll').scrollTop=0;};
  $('grid-scroll').onscroll=()=>{const s=active();if(s)s.scroll=$('grid-scroll').scrollTop;};
  $('clear-query').onclick=()=>{const s=active();s.query='';s.filter='';refreshResults(s);renderSession();};
  $('inspector-toggle').onclick=toggleInspector;$('close-inspector').onclick=toggleInspector;
  $('back').onclick=()=>goHistory(-1);$('forward').onclick=()=>goHistory(1);$('source-return').onclick=sourceReturn;
  $('locate').onclick=()=>$('grid').querySelector(`[data-model="${active().selection}"]`)?.scrollIntoView({block:'nearest'});
  $('refresh').onclick=()=>{const s=active();s.refreshing=true;updateCount();updateNavigation();setTimeout(()=>{refreshResults(s);s.refreshing=false;if(active()===s){renderGrid();updateCount();}},500);};
  $('display-popover').addEventListener('beforetoggle',e=>{if(e.newState==='open'){$('display-popover').style.left=`${Math.min(innerWidth-216,Math.max(12,$('display-trigger').getBoundingClientRect().right-204))}px`;renderVisibility();}});
  $('filter-popover').addEventListener('beforetoggle',e=>{if(e.newState==='open'){$('filter-input').value=active()?.filter??'';$('filter-error').textContent='';}});
  $('filter-apply').onclick=()=>{const s=active();s.filter=$('filter-input').value.trim();s.scroll=0;refreshResults(s);hidePopovers();renderSession();};$('filter-clear').onclick=()=>{$('filter-input').value='';};
  $('cover-only').onchange=()=>{active().coverOnly=$('cover-only').checked;updateCards();};
  $('display-default').onclick=()=>{active().visible=defaults();active().coverOnly=false;updateCards();renderVisibility();};
  $('slow-save').onchange=e=>{slowSave=e.target.checked;};$('fail-next').onclick=()=>{failNext=true;$('demo-state').textContent='下一次修改将模拟保存失败。';};
  $('conflict-next').onclick=()=>{const m=model(active()?.selection);if(!m){$('demo-state').textContent='请先打开模型页。';return;}m.local.version=`v${Date.now().toString().slice(-4)} · 其他编辑`;updateCards();syncUntouchedInputs();updateEditorFeedback();$('demo-state').textContent='示例中另一处已改写版本；已有草稿保存时会检查旧值。';};
  $('card-new-tab').onclick=()=>{if(!contextTarget)return;const {page,id}=contextTarget;preserveView();const n=++counters[page.kind],s=newSession(page.kind,`${names[page.kind]} ${n}`);s.results=[...page.results];s.query=page.query;s.filter=page.filter;s.selection=id;s.history=[{view:'detail',id}];sessions.push(s);activeId=s.id;hidePopovers();renderSession();};
  window.addEventListener('keydown',e=>{if(e.defaultPrevented||$('global-dialog').open||document.querySelector('[popover]:popover-open')||e.target.closest('input,textarea,[contenteditable]'))return;if(e.key==='Escape'&&visit(active())?.view==='detail'){e.preventDefault();sourceReturn();}if(e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();goHistory(e.key==='ArrowLeft'?-1:1);}});
  window.addEventListener('beforeunload',e=>{if(sessions.some(s=>s.drafts.size)){e.preventDefault();e.returnValue='';}});
  window.addEventListener('resize',()=>{if(activeId)$(`tab-${activeId}`)?.closest('.tab-item').scrollIntoView({block:'nearest',inline:'nearest'});});
  renderSession();
})();
