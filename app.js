const SUPABASE_URL='https://cdeufzqwprgauyvrnmre.supabase.co';
const FUNCTION_URL=`${SUPABASE_URL}/functions/v1/champ-submission`;
const STORAGE_URL=`${SUPABASE_URL}/storage/v1/object/upload/sign/live-submissions`;
const WHATSAPP_NUMBER='';

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

$('#year').textContent=new Date().getFullYear();

const revealObserver=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target)}})
},{threshold:.12,rootMargin:'0px 0px -7%'});
$$('.reveal').forEach(el=>revealObserver.observe(el));

$$('.js-open-form').forEach(a=>a.addEventListener('click',()=>{
  setTimeout(()=>$('#submissionForm')?.querySelector('input,button')?.focus({preventScroll:true}),650)
}));

const fileInput=$('#songFile');
fileInput?.addEventListener('change',()=>{
  const f=fileInput.files?.[0];
  $('#fileName').textContent=f?`${f.name} · ${Math.max(0.1,f.size/1024/1024).toFixed(1)} MB`:'Nessun file selezionato';
});

const audioConfig={
  before:{el:$('#audioBefore'),button:$('[data-player="before"] .play-btn'),state:$('[data-player="before"] .player-state')},
  after:{el:$('#audioAfter'),button:$('[data-player="after"] .play-btn'),state:$('[data-player="after"] .player-state')}
};

// Set these file paths when the two verified CHAMP before/after masters are available.
const AUDIO_BEFORE='';
const AUDIO_AFTER='';
if(AUDIO_BEFORE){audioConfig.before.el.src=AUDIO_BEFORE;audioConfig.before.button.disabled=false}
if(AUDIO_AFTER){audioConfig.after.el.src=AUDIO_AFTER;audioConfig.after.button.disabled=false}
Object.values(audioConfig).forEach(cfg=>{
  cfg.button?.addEventListener('click',()=>{
    Object.values(audioConfig).forEach(other=>{if(other!==cfg&&!other.el.paused)other.el.pause()});
    if(cfg.el.paused){cfg.el.play();cfg.state.textContent='In ascolto'}else{cfg.el.pause();cfg.state.textContent='In pausa'}
  });
  cfg.el?.addEventListener('ended',()=>cfg.state.textContent='Riascolta');
});

function qsSource(){
  const q=new URLSearchParams(location.search);
  const bits=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].map(k=>q.get(k)?`${k.replace('utm_','')}:${q.get(k)}`:'').filter(Boolean);
  return (`website-candidatura${bits.length?' | '+bits.join(' | '):''}`).slice(0,120);
}
async function fn(payload){
  const res=await fetch(FUNCTION_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const e=new Error(data.error||'REQUEST_FAILED');e.data=data;throw e}
  return data;
}
async function uploadSigned(path,token,file,contentType){
  const url=`${SUPABASE_URL}/storage/v1/object/upload/sign/live-submissions/${path}?token=${encodeURIComponent(token)}`;
  const res=await fetch(url,{method:'PUT',headers:{'Content-Type':contentType||file.type||'application/octet-stream','x-upsert':'false'},body:file});
  if(!res.ok)throw new Error('UPLOAD_FAILED');
}
function errorMessage(code){
  return ({REQUIRED_FIELDS:'Compila tutti i campi obbligatori.',PRIVACY_REQUIRED:'Devi accettare il consenso privacy per inviare il brano.',INVALID_PHONE:'Controlla il numero WhatsApp.',INVALID_FILE:'Il file deve essere MP3, M4A o WAV e massimo 200 MB.',INVALID_FILE_TYPE:'Formato audio non supportato.',SONG_REQUIRED:'Carica un brano oppure inserisci un link valido.',RATE_LIMIT:'Hai effettuato troppi tentativi. Riprova più tardi.',UPLOAD_FAILED:'Il caricamento del file non è riuscito. Riprova.',SERVER_ERROR:'C’è stato un problema tecnico. Riprova tra poco.'})[code]||'Non siamo riusciti a inviare il brano. Controlla i dati e riprova.';
}

const form=$('#submissionForm');
form?.addEventListener('submit',async e=>{
  e.preventDefault();
  const progress=$('#formProgress');
  const btn=form.querySelector('button[type="submit"]');
  const fd=new FormData(form);
  const stage=fd.get('stage')||'';
  const file=fileInput.files?.[0]||null;
  const songUrl=String(fd.get('songUrl')||'').trim();
  if(!form.reportValidity())return;
  if(!file&&!songUrl){progress.textContent='Carica un brano oppure inserisci un link.';return}
  btn.disabled=true;progress.textContent='Prepariamo l’invio…';
  const base={
    action:'prepare',applicationType:'percorso',entryPoint:'landing-v2',artistName:fd.get('artistName'),firstName:fd.get('firstName'),lastName:fd.get('lastName'),phone:fd.get('phone'),countryCode:'39',city:fd.get('city'),songUrl,website:fd.get('website')||'',consentPrivacy:fd.get('consentPrivacy')==='on',fileMeta:file?{name:file.name,size:file.size,type:file.type}:null
  };
  try{
    const prepared=await fn(base);
    let uploadProof=null;
    if(file&&prepared.upload){
      progress.textContent='Caricamento del brano…';
      await uploadSigned(prepared.upload.path,prepared.upload.token,file,prepared.upload.contentType);
      uploadProof=prepared.upload.proof;
    }
    progress.textContent='Salviamo la candidatura…';
    await fn({
      action:'finalize',applicationType:'percorso',entryPoint:'landing-v2',artistName:fd.get('artistName'),firstName:fd.get('firstName'),lastName:fd.get('lastName'),phone:fd.get('phone'),countryCode:'39',city:fd.get('city'),instagram:fd.get('instagram'),age:fd.get('age'),songUrl,uploadProof,currentMaterial:String(stage),developmentGoal:fd.get('developmentGoal'),sourceDetail:qsSource(),consentPrivacy:fd.get('consentPrivacy')==='on',consentContact:fd.get('consentContact')==='on'
    });
    form.hidden=true;$('#successPanel').hidden=false;
    const text=encodeURIComponent(`Ciao CHAMP, ho appena inviato il mio brano dal sito. Vorrei raccontarvi qualcosa in più sul progetto.`);
    const wa=$('#whatsappAfterSubmit');
    wa.href=WHATSAPP_NUMBER?`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`:`https://wa.me/?text=${text}`;
    $('#successPanel').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(err){
    progress.textContent=errorMessage(err?.message);
    btn.disabled=false;
  }
});
