// Simple script: fetches data/standings.json and renders a table sorted by points, then diff.
async function loadStandings() {
  try {
    const res = await fetch('./data/standings.json', {cache: "no-cache"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // optional: show season if provided
    if (data.season) document.getElementById('season').textContent = data.season;

    const players = data.players || [];
    // sorting: points desc, diff desc, legsFor desc, name asc
    players.sort((a,b) => {
      if (b.points !== a.points) return b.points - a.points;
      if ((b.diff||0) !== (a.diff||0)) return (b.diff||0) - (a.diff||0);
      if ((b.legsFor||0) !== (a.legsFor||0)) return (b.legsFor||0) - (a.legsFor||0);
      return a.name.localeCompare(b.name);
    });

    const tbody = document.querySelector('#standings tbody');
    tbody.innerHTML = '';
    players.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="center">${idx+1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="center">${p.matchesPlayed ?? 0}</td>
        <td class="center">${p.wins ?? 0}</td>
        <td class="center">${p.losses ?? 0}</td>
        <td class="center">${p.legsFor ?? 0}</td>
        <td class="center">${p.legsAgainst ?? 0}</td>
        <td class="center">${p.diff ?? ( (p.legsFor||0) - (p.legsAgainst||0) )}</td>
        <td class="center"><strong>${p.points ?? 0}</strong></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load standings', err);
    document.querySelector('#standings-section').innerHTML = '<p class="small">Unable to load standings data.</p>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

loadStandings();
