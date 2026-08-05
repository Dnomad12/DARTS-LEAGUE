// Admin OCR client-side script
// - Loads docs/uploads/list.json to show thumbnails
// - Runs Tesseract.js in browser to extract text
// - Parses text into standings using heuristics similar to server script
// - Allows committing updated docs/data/standings.json via GitHub API using a provided PAT

const owner = 'Dnomad12';
const repo = 'DARTS-LEAGUE';
const uploadsBase = '/docs/uploads/';

const uploadsEl = document.getElementById('uploads');
const runBtn = document.getElementById('runOcr');
const imageWrap = document.getElementById('imageWrap');
const selectedInfo = document.getElementById('selectedInfo');
const ocrRaw = document.getElementById('ocrRaw');
const preview = document.getElementById('preview');
const commitBtn = document.getElementById('commitBtn');
const commitMsgInput = document.getElementById('commitMsg');
const tokenInput = document.getElementById('token');
const commitStatus = document.getElementById('commitStatus');

let selectedImage = null;
let lastParsed = null;

async function init(){
  try{
    const res = await fetch('/docs/uploads/list.json');
    const list = await res.json();
    uploadsEl.innerHTML = '';
    for(const name of list){
      const img = document.createElement('img');
      img.src = uploadsBase + name;
      img.alt = name;
      img.className = 'thumb';
      img.addEventListener('click', ()=> selectImage(name, img.src));
      uploadsEl.appendChild(img);
    }
  }catch(err){
    uploadsEl.textContent = 'Failed to load uploads list: '+err;
  }
}

function selectImage(name, url){
  selectedImage = {name,url};
  selectedInfo.textContent = name;
  imageWrap.innerHTML = `<img src="${url}" style="max-width:400px;display:block;margin-top:8px" />`;
  runBtn.disabled = false;
}

async function runOcrOnSelected(){
  if(!selectedImage) return;
  runBtn.disabled = true;
  ocrRaw.textContent = 'Running OCR... (this may take a few seconds)';
  preview.innerHTML = '';
  try{
    const worker = Tesseract.createWorker();
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    const { data: { text } } = await worker.recognize(selectedImage.url);
    await worker.terminate();
    ocrRaw.textContent = text;
    const players = parseText(text);
    lastParsed = players;
    renderPreview(players);
    commitBtn.disabled = players.length === 0;
    commitStatus.textContent = players.length ? `Parsed ${players.length} players` : 'No players parsed';
  }catch(err){
    ocrRaw.textContent = 'OCR error: '+err;
    console.error(err);
  }finally{
    runBtn.disabled = false;
  }
}

function parseText(text){
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const players = [];
  for(const line of lines){
    let ln = line.replace(/\t|\u00A0/g,' ').replace(/ {2,}/g,' ');
    const tokens = ln.split(' ');
    for(const numCount of [7,6]){
      if(tokens.length < numCount+1) continue;
      const trailing = tokens.slice(-numCount);
      if(trailing.every(t=>/^[-]?\d+$/.test(t))){
        let prefix = tokens.slice(0, tokens.length - numCount);
        if(prefix.length && /^\d{1,2}$/.test(prefix[0])) prefix = prefix.slice(1);
        const name = prefix.join(' ').trim();
        if(!name) break;
        const nums = trailing.map(Number);
        let matchesPlayed,wins,losses,legsFor,legsAgainst,diff,points;
        if(numCount === 7){
          [matchesPlayed,wins,losses,legsFor,legsAgainst,diff,points] = nums;
        }else{
          [matchesPlayed,wins,losses,legsFor,legsAgainst,points] = nums;
          diff = legsFor - legsAgainst;
        }
        players.push({name,matchesPlayed,wins,losses,legsFor,legsAgainst,diff,points});
        break;
      }
    }
  }
  // dedupe by name
  const seen = new Set();
  const dedup = [];
  for(const p of players){
    const k = p.name.toLowerCase();
    if(seen.has(k)) continue; seen.add(k); dedup.push(p);
  }
  return dedup;
}

function renderPreview(players){
  if(!players.length){ preview.innerHTML = '<p class="small">No players parsed</p>'; return; }
  const table = document.createElement('table');
  table.style.width='100%';
  table.style.borderCollapse='collapse';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>#</th><th>Player</th><th>MP</th><th>W</th><th>L</th><th>LF</th><th>LA</th><th>Diff</th><th>Pts</th></tr>`;
  table.appendChild(thead);
  const tb = document.createElement('tbody');
  players.forEach((p,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(p.name)}</td><td>${p.matchesPlayed}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.legsFor}</td><td>${p.legsAgainst}</td><td>${p.diff}</td><td>${p.points}</td>`;
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  preview.innerHTML = '';
  preview.appendChild(table);
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function commitStandings(){
  if(!lastParsed || !lastParsed.length){ alert('No parsed standings to commit'); return; }
  const token = tokenInput.value.trim();
  if(!token){ alert('Enter a GitHub token (public_repo scope)'); return; }
  commitBtn.disabled = true; commitStatus.textContent = 'Preparing commit...';
  const path = 'docs/data/standings.json';
  const apiBase = 'https://api.github.com';
  try{
    // fetch existing file to get sha (if exists)
    const getRes = await fetch(`${apiBase}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`);
    let sha = null;
    if(getRes.status === 200){
      const obj = await getRes.json(); sha = obj.sha;
    }
    const data = { season: null, sourceImage: selectedImage ? 'docs/uploads/'+selectedImage.name : null, players: lastParsed };
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    const body = { message: commitMsgInput.value || 'Update standings from OCR', content };
    if(sha) body.sha = sha;
    const putRes = await fetch(`${apiBase}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Authorization': 'token '+token, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if(putRes.status === 201 || putRes.status === 200){
      const resObj = await putRes.json();
      commitStatus.textContent = 'Committed: ' + (resObj.commit && resObj.commit.html_url ? resObj.commit.html_url : 'OK');
    }else{
      const text = await putRes.text();
      commitStatus.textContent = 'Commit failed: ' + putRes.status + ' ' + text;
    }
  }catch(err){
    commitStatus.textContent = 'Error: '+err;
    console.error(err);
  }finally{ commitBtn.disabled = false; }
}

runBtn.addEventListener('click', runOcrOnSelected);
commitBtn.addEventListener('click', commitStandings);
init();
