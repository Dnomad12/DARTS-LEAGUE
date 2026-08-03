// app.js — client-side upload + preprocessing + Tesseract OCR + simple parsing + local leaderboard
const fileInput = document.getElementById('fileInput');
const fileDrop = document.getElementById('fileDrop');
const progressEl = document.getElementById('progress');
const canvas = document.getElementById('canvas');
const ocrText = document.getElementById('ocrText');
const parseBtn = document.getElementById('parseBtn');
const saveMatchBtn = document.getElementById('saveMatchBtn');
const clearBtn = document.getElementById('clearBtn');
const parsedTableBody = document.querySelector('#parsedTable tbody');
const leaderboardWrap = document.getElementById('leaderboardWrap');
const recalcLbBtn = document.getElementById('recalcLb');

let currentImage = null;
let lastOcr = '';

function setProgress(text){progressEl.textContent = text}

fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if(!f) return;
  await handleFile(f);
});

// drag & drop
fileDrop.addEventListener('drop', async (ev)=>{
  ev.preventDefault();
  const f = ev.dataTransfer.files[0];
  if(f) await handleFile(f);
});
fileDrop.addEventListener('dragover', (e)=>{e.preventDefault()});

async function handleFile(file){
  setProgress('Loading image...');
  const img = await loadImageFromFile(file);
  currentImage = img;
  // draw & preprocess
  drawToCanvas(img);
  setProgress('Running OCR (this may take a few seconds)...');
  lastOcr = '';

  const { createWorker } = Tesseract;
  const worker = createWorker({
    logger: m => {
      if(m.status && m.status !== 'initializing') setProgress(`${m.status} ${(m.progress||0)*100|0}%`);
    }
  });

  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  // use canvas data URL for OCR
  const dataUrl = canvas.toDataURL('image/png');
  const { data: { text } } = await worker.recognize(dataUrl);
  lastOcr = text;
  ocrText.value = text;
  setProgress('OCR complete');
  await worker.terminate();
}

function loadImageFromFile(file){
  return new Promise((res,rej)=>{
    const img = new Image();
    img.onload = ()=>res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

function drawToCanvas(img){
  // scale image to max width 1200 for faster processing
  const maxW = 1200;
  const scale = Math.min(1, maxW / img.width);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  // basic preprocessing: grayscale + simple contrast stretching + optional threshold
  const id = ctx.getImageData(0,0,canvas.width,canvas.height);
  for(let i=0;i<id.data.length;i+=4){
    const r = id.data[i], g = id.data[i+1], b = id.data[i+2];
    // luma
    let v = 0.2126*r + 0.7152*g + 0.0722*b;
    // basic contrast
    v = (v - 128) * 1.2 + 128;
    id.data[i]=id.data[i+1]=id.data[i+2]=v;
  }
  ctx.putImageData(id,0,0);
}

parseBtn.addEventListener('click', ()=>{
  const text = ocrText.value || lastOcr || '';
  const parsed = heuristicParse(text);
  renderParsed(parsed);
});

saveMatchBtn.addEventListener('click', ()=>{
  const rows = Array.from(parsedTableBody.querySelectorAll('tr'));
  const match = { timestamp: Date.now(), players: [] };
  for(const r of rows){
    const name = r.querySelector('.pname').value.trim();
    const score = parseInt(r.querySelector('.pscore').value) || 0;
    if(name) match.players.push({ name, score });
  }
  if(match.players.length===0){ alert('No players to save'); return; }
  const matches = JSON.parse(localStorage.getItem('darts_matches')||'[]');
  matches.push(match);
  localStorage.setItem('darts_matches', JSON.stringify(matches));
  alert('Match saved locally');
  recalcLeaderboard();
});

clearBtn.addEventListener('click', ()=>{
  currentImage = null; lastOcr=''; ocrText.value=''; parsedTableBody.innerHTML=''; setProgress('Cleared');
});

recalcLbBtn.addEventListener('click', recalcLeaderboard);

function heuristicParse(text){
  // Split lines and try to extract "Name ... number" patterns
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const parsed = [];
  for(const ln of lines){
    // look for numbers in the line
    const nums = Array.from(ln.matchAll(/-?\d+/g)).map(m=>m[0]);
    if(nums.length===0) continue;
    // choose last number as score
    const lastNum = nums[nums.length-1];
    // remove numbers to get name candidate
    const nameCandidate = ln.replace(/-?\d+/g,'').replace(/[:\-\|]/g,'').trim();
    const name = nameCandidate || ('Player');
    parsed.push({ name, score: parseInt(lastNum) });
  }
  // If nothing parsed, attempt to parse whitespace-separated tokens
  if(parsed.length===0 && lines.length>0){
    for(const ln of lines){
      const toks = ln.split(/\s{2,}|\t|\s/).filter(Boolean);
      if(toks.length>=2){
        const last = toks[toks.length-1].replace(/[^0-9-]/g,'');
        if(/^-?\d+$/.test(last)){
          const name = toks.slice(0,toks.length-1).join(' ');
          parsed.push({ name, score: parseInt(last) });
        }
      }
    }
  }
  // ensure at least one row if OCR produced any words
  return parsed;
}

function renderParsed(parsed){
  parsedTableBody.innerHTML='';
  parsed.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="pname" value="${escapeHtml(p.name)}"/></td><td><input class="pscore" value="${p.score}"/></td>`;
    parsedTableBody.appendChild(tr);
  });
}

function recalcLeaderboard(){
  const matches = JSON.parse(localStorage.getItem('darts_matches')||'[]');
  const totals = {};
  for(const m of matches){
    for(const p of m.players){
      if(!totals[p.name]) totals[p.name]=0;
      totals[p.name]+=p.score;
    }
  }
  const rows = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  leaderboardWrap.innerHTML = '<ol>' + rows.map(r=>`<li>${escapeHtml(r[0])}: ${r[1]}</li>`).join('') + '</ol>';
}

// small helper
function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])) }

// load existing leaderboard on open
recalcLeaderboard();
