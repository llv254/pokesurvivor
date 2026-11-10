/* ============ levelup.js — las tres cartas de subida de nivel ============
 * Tipos de carta:
 *   new   aprender un movimiento nuevo (sólo si quedan huecos de los 4; un vínculo libera huecos)
 *   up    mejorar un movimiento que ya tienes
 *   stat  mejora permanente de la run
 */
G.LevelUp = (() => {

  const STATS = [
    { id: 'hp', icon: 'heart', title: 'Vigor',
      desc: level => G.I18n.f('+{x} de vida máxima (y la recupera).', (20 + 5 * level).toLocaleString(G.I18n.locale)),
      apply: (pl, level = 1) => pl.addMaxHp(20 + 5 * level) },
    { id: 'atk', icon: 'fist', title: 'Potencia',
      desc: level => G.I18n.f('+{x}% de daño con todos los movimientos.', 10 + 5 * level),
      apply: (pl, level = 1) => pl.atkMul *= 1.10 + 0.05 * level, max: 40 },
    { id: 'spd', icon: 'boot', title: 'Carrera',
      desc: level => G.I18n.f('+{x}% de velocidad de movimiento.', 7 + 2 * level),
      apply: (pl, level = 1) => pl.spdMul *= 1.07 + 0.02 * level, max: 8 },
    { id: 'cd', icon: 'clock', title: 'Reflejos',
      desc: level => G.I18n.f('-{x}% de recarga en todos los movimientos.', 8 + 2 * level),
      apply: (pl, level = 1) => pl.cdMul *= 0.92 - 0.02 * level, max: 10 },
    { id: 'def', icon: 'shield', title: 'Coraza',
      desc: level => G.I18n.f('+{x}% de reducción de daño recibido.', 6 + 3 * level),
      apply: (pl, level = 1) => pl.dmgReduce = Math.min(0.7, pl.dmgReduce + 0.06 + 0.03 * level), max: 12 },
    { id: 'rgn', icon: 'sprout', title: 'Síntesis',
      desc: level => G.I18n.f('+{x} de vida regenerada por segundo.', (0.9 + 0.3 * level).toLocaleString(G.I18n.locale)),
      apply: (pl, level = 1) => pl.regenFlat += 0.9 + 0.3 * level },
    { id: 'mag', icon: 'magnet', title: 'Imán',
      desc: level => G.I18n.f('+{x}% de radio de recogida de experiencia.', 30 + 5 * level),
      apply: (pl, level = 1) => pl.magnet *= 1.30 + 0.05 * level, max: 6 },
    { id: 'xp', icon: 'book', title: 'Aprendizaje',
      desc: level => G.I18n.f('+{x}% de experiencia ganada.', 12 + 3 * level),
      apply: (pl, level = 1) => pl.xpMul *= 1.12 + 0.03 * level, max: 8 },
    { id: 'heal', icon: 'berry', title: 'Baya Zidra',
      desc: level => G.I18n.f('Recupera el {x}% de tu vida ahora mismo.', 45 + 5 * level),
      apply: (pl, level = 1) => pl.heal(pl.maxHp * (0.45 + 0.05 * level)) }
  ];

  const RARITIES = [
    { label: 'Común', color: '#b0a99f', level: 0, chance: 35 },
    { label: 'Poco común', color: '#5fe08a', level: 1, chance: 30 },
    { label: 'Rara', color: '#4fb4ff', level: 2, chance: 20 },
    { label: 'Épica', color: '#c47bff', level: 3, chance: 10 },
    { label: 'Legendaria', color: '#ffd23f', level: 4, chance: 5 }
  ];

  function rollRarity() {
    let roll = Math.random() * 100;
    for (const rarity of RARITIES) {
      roll -= rarity.chance;
      if (roll < 0) return rarity;
    }
    return RARITIES[0];
  }

  /** n elementos distintos de list, cada uno con probabilidad según weight(x). */
  function pickWeighted(list, n, weight) {
    const rest = list.map(x => [x, weight(x)]), out = [];
    while (out.length < n && rest.length) {
      let r = Math.random() * rest.reduce((a, [, w]) => a + w, 0), i = 0;
      while (i < rest.length - 1 && (r -= rest[i][1]) > 0) i++;
      out.push(rest.splice(i, 1)[0][0]);
    }
    return out;
  }

  function megaCard(pl) {
    const time = G.Game && G.Game.st ? G.Game.st.time : 0;
    const forms = G.MEGA_FORMS && G.MEGA_FORMS[pl.dex];
    if (time < 900 || pl.megaForm || !forms || !forms.length || Math.random() >= 0.5) return null;
    const form = G.U.pick(forms);
    const suffix = form.id.replace(/^mega-?/, '').toUpperCase();
    const mon = G.T(pl.mon.name);
    return {
      w: 40, type: 'mega', key: 'mega:' + form.id,
      icon: 'mega', color: '#ffc400', tag: G.T('UNIQUE'),
      title: form.id === 'primal' ? 'Primal ' + mon : 'Mega ' + mon + (suffix ? ' ' + suffix : ''),
      desc: G.T('Evolve Mega: +20% attack and +20% maximum health.'),
      apply: p => {
        if (!p.megaEvolve(form.id)) return;
        G.FX.megaEvolve(p.x, p.y, p.r, p.bodyH);
        G.Audio.sfx('legend');
        if (G.Coop.active) G.Coop.mega(p, form.id);
      }
    };
  }

  /** Construye el conjunto de cartas candidatas, con pesos. */
  function candidates(pl) {
    const out = [];
    const mega = megaCard(pl);
    if (mega) out.push(mega);

    // --- movimientos nuevos ---
    if (pl.slots.length < pl.maxMoves) {
      // Con 2 potenciadores ya no se ofrecen más: los buff no hacen daño y
      // llenar los 4 huecos con ellos deja la run sin salida.
      const buffs = pl.moves.filter(m => m.kind === 'buff').length;
      // Si es de su lado flojo, cuánto rinde (Machamp con Bola Sombra...).
      const fitNote = (mon, cat) => {
        const f = G.Stats.fit(mon, cat);
        return f < 0.95 ? ` <span class="fit-low">Con ${mon.name} rinde un ${Math.round(f * 100)} %: pega mejor con ataques ${G.Stats.sideOf(mon) === 'special' ? 'especiales' : 'físicos'}.</span>` : '';
      };
      const pool = G.Moves.poolFor(pl.mon).filter(id =>
        !pl.hasMove(id) && !(pl.banned && pl.banned.has(id)) && !(buffs >= 2 && G.Moves.BY_ID[id].kind === 'buff'));
      // Los de su lado bueno (y los empatados y mejoras) salen el doble.
      const weight = id => { const d = G.Moves.BY_ID[id]; return G.Stats.fit(pl.mon, d.cat) >= 0.999 ? 2 : 1; };
      for (const id of pickWeighted(pool, 6, weight)) {
        const d = G.Moves.BY_ID[id];
        out.push({
          w: 10, type: 'new', key: 'new:' + id,
          icon: 'move:' + id, color: G.U.TYPE_COLOR[d.type],
          // (Físico o especial va en su propia etiqueta, con borde: ver run-ui.js. Los
          // potenciadores no tienen categoría, pero Danza Espada y Danza Dragón suben el
          // ataque físico y Maquinación el especial: llevan la del lado que suben.)
          tag: G.U.TYPE_NAME[d.type],
          cat: G.Stats.NAME[d.cat || (d.stat === 'patk' ? 'physical' : d.stat === 'satk' ? 'special' : '')] || '',
          title: G.T(d.name, 'move'), desc: d.desc + fitNote(pl.mon, d.cat),
          apply: p => p.addMove(id)
        });
      }
    }

    // --- evoluciones: movimiento al máximo + su condición cumplida ---
    const waiting = {};                   // stat -> movimiento que la espera para evolucionar
    for (const m of pl.moves) {
      const ev = G.Moves.evoInfo(m, pl.statsTaken);
      if (!ev) continue;
      if (!ev.ready) { waiting[ev.needs] = m; continue; }
      out.push({
        w: 40, type: 'evo', key: 'evo:' + m.id,
        icon: 'move:' + m.id, color: '#ffd23f', tag: 'EVOLUCIÓN',
        title: G.T(m.name, 'move') + ' → ' + G.T(ev.name, 'move'), desc: ev.text,
        apply: p => {
          G.Moves.evolve(m);
          G.FX.ring(p.x, p.y, 8, 120, '#ffd23f', 0.8, 6);
          G.FX.burst(p.x, p.y - p.bodyH * 0.5, '#ffe14d', 40, 240);
          G.Audio.sfx('legend');
          G.Progress.event('evolve', { move: m.id });
        }
      });
    }

    // --- mejoras de movimientos que ya tienes ---
    for (const m of pl.moves) {
      const txt = G.Moves.nextUpText(m);
      if (!txt) continue;
      out.push({
        w: 8, type: 'up', key: 'up:' + m.id,
        icon: 'move:' + m.id, color: G.U.TYPE_COLOR[m.type],
        tag: 'Nv.' + m.lvl + ' > ' + (m.lvl + 1),
        title: G.T(m.name, 'move'), desc: txt,
        apply: () => G.Moves.levelUp(m)
      });
    }

    // --- stats ---
    // Las que desbloquean una evolución salen siempre y con aviso.
    // Cada mejora tiene un tope de veces (`max`): en partidas muy largas se
    // acumulaban sin fin (velocidad, recarga y experiencia por las nubes) y el
    // juego acababa colgándose. Las que piden una evolución salen siempre.
    const room = s => !s.max || (pl.statsTaken[s.id] || 0) < s.max;
    const pickStats = G.U.pickN(STATS.filter(s => !waiting[s.id] && room(s)), 5).concat(STATS.filter(s => waiting[s.id]));
    for (const s of pickStats) {
      const evoFor = waiting[s.id];
      const rarity = rollRarity();
      out.push({
        w: evoFor ? 14 : pl.slots.length < pl.maxMoves ? 4 : 7,
        type: 'stat', key: 'stat:' + s.id,
        icon: s.icon, color: rarity.color,
        tag: G.T(rarity.label) + (evoFor ? ' · ' + G.T('Evoluciona') + ' ' + G.T(evoFor.name, 'move') : ''),
        title: s.title, desc: s.desc(rarity.level),
        apply: p => { s.apply(p, rarity.level); p.statsTaken[s.id] = (p.statsTaken[s.id] || 0) + 1; }
      });
    }

    return out;
  }

  /** Devuelve 3 cartas distintas, elegidas por peso. */
  function offer(pl, n = 3) {
    const pool = candidates(pl);
    const picked = [];
    const used = new Set();
    // Las cartas únicas Mega y las evoluciones listas salen siempre.
    let evo = pool.findIndex(c => c.type === 'mega');
    if (evo < 0) evo = pool.findIndex(c => c.type === 'evo');
    if (evo >= 0) { const c = pool.splice(evo, 1)[0]; used.add(c.key); picked.push(c); }

    while (picked.length < n && pool.length) {
      const total = pool.reduce((a, c) => a + c.w, 0);
      let r = Math.random() * total, idx = 0;
      for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) { idx = i; break; } }
      const c = pool.splice(idx, 1)[0];
      if (used.has(c.key)) continue;
      used.add(c.key);
      picked.push(c);
    }
    return picked;
  }

  return { offer, STATS, RARITIES };
})();
