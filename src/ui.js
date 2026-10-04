// ui.js
// Everything that touches the DOM (except the canvases).

import { TOWERS, ENEMIES, TOTAL_WAVES, MAX_LEVEL } from './config.js';
import { describeWave } from './waves.js';

const $ = (id) => document.getElementById(id);

const MODES = ['First', 'Last', 'Strong', 'Close'];

// little svg icon for each tower card
function towerIcon(i) {
  const [r, g, b] = TOWERS[i].color;
  const c = `rgb(${r},${g},${b})`;
  const shapes = [
    `<rect x="19" y="17" width="15" height="6" rx="3" fill="${c}"/><circle cx="20" cy="20" r="8" fill="${c}"/>`,
    `<rect x="20" y="15.5" width="12" height="9" rx="3" fill="${c}"/><circle cx="20" cy="20" r="10" fill="${c}"/><circle cx="20" cy="20" r="4" fill="#1c2c28"/>`,
    `<path d="M20 9 31 20 20 31 9 20Z" fill="${c}"/><path d="M20 14 26 20 20 26 14 20Z" fill="#e9f6ff"/>`,
    `<rect x="18" y="17.5" width="17" height="5" rx="2.5" fill="${c}"/><circle cx="18" cy="20" r="7" fill="${c}"/>`,
  ];
  return `<svg viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="8" fill="#1c2c28" stroke="#465c50" stroke-width="2"/>${shapes[i]}</svg>`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.el = {
      lives: $('lives'), gold: $('gold'), wave: $('wave'), score: $('score'),
      livesStat: $('lives').parentElement,
      waveBtn: $('btn-wave'), pause: $('btn-pause'), speed: $('speed'),
      towers: $('towers'), next: $('next'), inspect: $('inspect'),
      perf: $('perf'), perfStats: $('perf-stats'), graph: $('graph'),
      banner: $('banner'), toast: $('toast'),
      start: $('screen-start'), end: $('screen-end'), endTitle: $('end-title'), endText: $('end-text'), best: $('best'),
      benchOut: $('bench-out'), benchCopy: $('bench-copy'), benchRun: $('bench-run'),
    };
    this.graphCtx = this.el.graph.getContext('2d');
    this.last = { lives: -1, gold: -1, wave: -1, score: -1, waveBtn: '', next: '', cards: '', inspect: '' };
    this.hudTimer = 0;
    this.perfTimer = 0;
    this.toastTimer = 0;
    this.buildCards();
    this.showBest();
  }

  buildCards() {
    this.el.towers.innerHTML = TOWERS.map((t, i) => `
      <button class="tcard" data-tower="${i}" title="${t.desc}">
        ${towerIcon(i)}
        <span class="tname">${t.name}</span>
        <span class="tcost">${t.cost} gold</span>
        <kbd>${t.hotkey}</kbd>
      </button>`).join('');
  }

  showBest() {
    let best = 0;
    try { best = Number(localStorage.getItem('bastion-best')) || 0; } catch (e) { /* storage blocked */ }
    this.el.best.textContent = best > 0 ? `Best score: ${best.toLocaleString()}` : '';
  }

  saveBest(score) {
    try {
      const best = Number(localStorage.getItem('bastion-best')) || 0;
      if (score > best) localStorage.setItem('bastion-best', String(score));
    } catch (e) { /* storage blocked */ }
    this.showBest();
  }

  // ---------- hud ----------

  // dt in seconds. throttled mode updates 10 times a second and only
  // when a value changed. naive mode rewrites the html every frame.
  updateHud(dt, force) {
    const { game, settings } = this.app;
    const lives = game.lives, gold = Math.floor(game.gold), wave = game.wave, score = game.score;

    if (!settings.hudThrottle) {
      this.el.lives.innerHTML = `${lives}`;
      this.el.gold.innerHTML = `${gold}`;
      this.el.wave.innerHTML = `${wave}`;
      this.el.score.innerHTML = `${score.toLocaleString()}`;
      this.updateControls();
      return;
    }

    this.hudTimer -= dt;
    if (this.hudTimer > 0 && !force) return;
    this.hudTimer = 0.1;
    const L = this.last;
    if (L.lives !== lives) { this.el.lives.textContent = lives; L.lives = lives; }
    if (L.gold !== gold) { this.el.gold.textContent = gold; L.gold = gold; }
    if (L.wave !== wave) { this.el.wave.textContent = wave; L.wave = wave; }
    if (L.score !== score) { this.el.score.textContent = score.toLocaleString(); L.score = score; }
    this.updateControls();
  }

  updateControls() {
    const { game, placing, paused, speed } = this.app;
    const L = this.last;

    // wave button
    let label, enabled;
    if (game.state === 'stress') { label = 'Stress test running'; enabled = false; }
    else if (game.state === 'ready') { label = 'Start wave 1'; enabled = true; }
    else if (game.state === 'playing') {
      if (game.canCallWave()) {
        label = game.cleared ? `Next wave in ${Math.ceil(game.nextTimer)}s` : 'Call next wave early';
        enabled = true;
      } else { label = game.wave >= TOTAL_WAVES ? 'Final wave' : 'Wave incoming'; enabled = false; }
    } else { label = 'Game over'; enabled = false; }
    const key = label + enabled;
    if (L.waveBtn !== key) {
      this.el.waveBtn.textContent = label;
      this.el.waveBtn.disabled = !enabled;
      L.waveBtn = key;
    }

    // next wave preview
    let next = '';
    if (game.state === 'stress' && game.stress) next = `Stress test: <b>${game.stress.nEnemies}</b> enemies, <b>${game.stress.nTowers}</b> towers, <b>${game.stress.nProj}</b>+ shots`;
    else if (game.wave < TOTAL_WAVES && (game.state === 'ready' || game.state === 'playing')) {
      if (this.previewWave !== game.wave + 1) {
        this.previewWave = game.wave + 1;
        this.previewText = describeWave(game.wave + 1, ENEMIES);
      }
      next = `Next, wave ${game.wave + 1}: <b>${this.previewText}</b>`;
    }
    if (L.next !== next) { this.el.next.innerHTML = next; L.next = next; }

    // tower cards: highlight picked one, dim the ones we cannot afford
    const gold = Math.floor(game.gold);
    const cards = `${placing}|${TOWERS.map((t) => (gold >= t.cost ? 1 : 0)).join('')}`;
    if (L.cards !== cards) {
      L.cards = cards;
      this.el.towers.querySelectorAll('.tcard').forEach((b, i) => {
        b.classList.toggle('on', placing === i);
        b.classList.toggle('poor', gold < TOWERS[i].cost);
      });
    }

    this.el.pause.classList.toggle('on', paused);
    this.el.pause.textContent = paused ? 'Resume' : 'Pause';
    this.el.speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));

    this.updateInspect();
  }

  flashLives() {
    const s = this.el.livesStat;
    s.classList.add('hit');
    clearTimeout(this.hitT);
    this.hitT = setTimeout(() => s.classList.remove('hit'), 350);
  }

  // ---------- tower inspector ----------

  updateInspect() {
    const { game, selected } = this.app;
    const T = game.T;
    const el = this.el.inspect;
    if (selected < 0 || !T.alive[selected]) {
      if (!el.hidden) { el.hidden = true; this.last.inspect = ''; }
      return;
    }
    const type = T.type[selected], lvl = T.level[selected];
    const gold = Math.floor(game.gold);
    const key = `${selected}|${lvl}|${T.mode[selected]}|${gold >= game.upgradeCost(selected)}|${T.kills[selected]}`;
    if (this.last.inspect === key) return;
    this.last.inspect = key;

    const def = TOWERS[type];
    const st = game.stats[type][lvl];
    const nx = lvl < MAX_LEVEL ? game.stats[type][lvl + 1] : null;
    const up = (a, b, d = 0) => (b != null && b > a + 1e-6 ? ` <span class="up">+${(b - a).toFixed(d)}</span>` : '');
    const cost = game.upgradeCost(selected);
    const rows = [
      ['Damage', st.damage.toFixed(0) + up(st.damage, nx && nx.damage)],
      ['Shots per second', st.rate.toFixed(2) + up(st.rate, nx && nx.rate, 2)],
      ['Range', st.range.toFixed(0) + up(st.range, nx && nx.range)],
    ];
    if (def.splash) rows.push(['Blast radius', st.splash.toFixed(0) + up(st.splash, nx && nx.splash)]);
    if (def.slow) rows.push(['Slow', `${Math.round(def.slow * 100)}% for ${st.slowTime.toFixed(1)}s`]);
    if (def.pierce) rows.push(['Armor', 'Ignored']);
    rows.push(['Kills', T.kills[selected]]);

    el.innerHTML = `
      <h3>${def.name} <span class="muted">level ${lvl + 1}/${MAX_LEVEL + 1}</span></h3>
      <div class="sub">${def.desc}</div>
      <dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <div class="modes">${MODES.map((m, i) => `<button data-mode="${i}" class="${T.mode[selected] === i ? 'on' : ''}">${m}</button>`).join('')}</div>
      <div class="row">
        <button data-act="upgrade" class="primary" ${lvl >= MAX_LEVEL || gold < cost ? 'disabled' : ''}>${lvl >= MAX_LEVEL ? 'Max level' : `Upgrade, ${cost}`}</button>
        <button data-act="sell">Sell, +${game.sellValue(selected)}</button>
      </div>`;
    el.hidden = false;
  }

  // ---------- messages ----------

  banner(title, sub) {
    const b = this.el.banner;
    b.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth; // restart the css animation
    b.classList.add('show');
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }

  showStart(show) { this.el.start.hidden = !show; }

  showEnd(won) {
    const { game } = this.app;
    this.saveBest(game.score);
    this.el.endTitle.textContent = won ? 'The keep holds' : 'The keep has fallen';
    this.el.endText.textContent = won
      ? `All ${TOTAL_WAVES} waves beaten with ${game.lives} lives left. Final score ${game.score.toLocaleString()}.`
      : `You held until wave ${game.wave} and scored ${game.score.toLocaleString()}.`;
    this.el.end.hidden = false;
  }

  hideEnd() { this.el.end.hidden = true; }

  // ---------- perf panel ----------

  updatePerf(dt, drawn) {
    if (this.el.perf.hidden) return;
    const { perf, game } = this.app;
    perf.drawGraph(this.graphCtx, this.el.graph.width, this.el.graph.height);
    this.perfTimer -= dt;
    if (this.perfTimer > 0) return;
    this.perfTimer = 0.25;
    const heap = perf.heapMB();
    this.el.perfStats.innerHTML = `
      <span>FPS</span><span class="big">${perf.fps.toFixed(0)}</span>
      <span>Frame time</span><span>${perf.frameMs.toFixed(1)} ms</span>
      <span>Simulation</span><span>${perf.simMs.toFixed(2)} ms</span>
      <span>Rendering</span><span>${perf.renderMs.toFixed(2)} ms</span>
      <span>Enemies / towers / shots</span><span>${game.E.count} / ${game.T.count} / ${game.P.count}</span>
      <span>Drawn this frame</span><span>${drawn}</span>
      <span>JS heap</span><span>${Number.isFinite(heap) ? heap.toFixed(1) + ' MB' : 'Chrome only'}</span>`;
  }

  togglePerf(force) {
    const p = this.el.perf;
    p.hidden = force === undefined ? !p.hidden : !force;
  }
}
