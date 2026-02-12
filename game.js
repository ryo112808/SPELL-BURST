// ================================
// SPELL BURST v1.2 修正版（必須条件 + 次ターン効果の整合）
// - 魔素UI（所持→フィールド→戻す）
// - READY判定（呪文+魔素条件+ロック）
// - 魔素消費（発動後に減少）
// - 敵AIも同ルール（呪文+魔素）
// - 次ターン効果（ミスト/ブラインド/フリーズ/各種ロック）が「次ターン」に乗る
// - レゾナンス/インフェルノコアが攻撃として処理される
// ================================

const MAX_TURN = 5;

const MANA_KEYS = ["fire", "water", "earth", "light", "dark"];
const MANA_JA = { fire:"火", water:"水", earth:"土", light:"光", dark:"闇" };
const MANA_DOT = {
  fire:  "#ff6b6b",
  water: "#4dabf7",
  earth: "#69db7c",
  light: "#f5d58a",
  dark:  "#b08cff",
};

// 26呪文（仕様書確定）
const SPELLS = [
  { id:"fire", name:"ファイア", type:"atk", hit:100, damage:5, req:{ fire:1 } },
  { id:"water", name:"ウォーター", type:"atk", hit:100, damage:5, req:{ water:1 } },
  { id:"stone", name:"ストーン", type:"atk", hit:100, damage:5, req:{ earth:1 } },

  { id:"heal", name:"ヒール", type:"heal", hit:75, heal:9, req:{ light:2 } },
  { id:"barrier", name:"バリア", type:"buff", hit:100, flag:"barrier_next", req:{ earth:2 } },
  { id:"earth_shield", name:"アースシールド", type:"buff", hit:100, flag:"shield_next", value:3, req:{ earth:1 } },

  { id:"drain", name:"ドレイン", type:"atk_heal", hit:50, damage:5, heal:5, req:{ dark:2 } },
  { id:"siphon", name:"サイフォン", type:"after", hit:100, flag:"siphon_after", req:{ dark:1 } },
  { id:"reflect", name:"リフレクト", type:"buff", hit:100, flag:"reflect_next", req:{ light:1, dark:1, earth:1 } },
  { id:"shadow_step", name:"シャドウステップ", type:"buff", hit:100, flag:"evade_next", value:40, req:{ dark:1 } },

  { id:"enchant", name:"エンチャント", type:"buff", hit:100, flag:"next_dmg_plus", value:4, req:{ fire:2 } },
  { id:"overflow", name:"オーバーフロー", type:"atk_self", hit:100, damage:10, self:5, req:{ fire:2 } },
  { id:"bloodpay", name:"ブラッドペイ", type:"buff_selfpay", hit:100, flag:"next_dmg_plus", value:8, payHpPct:10, req:{ fire:2 } },
  { id:"inferno_core", name:"インフェルノコア", type:"atk_scaling", hit:50, perFire:4, req:{ fire:1 } },

  { id:"mist", name:"ミスト", type:"debuff", hit:100, flag:"enemy_hit_mod_next", value:-50, req:{ water:2 } },
  { id:"freeze", name:"フリーズ", type:"debuff", hit:75, flag:"lock_used_mana_next", req:{ water:2 } },
  { id:"tidal_edge", name:"タイダルエッジ", type:"atk_debuff", hit:75, damage:9, flag:"lock_mana_next", lockKey:"water", req:{ water:2 } },

  { id:"iron_will", name:"アイアンウィル", type:"buff", hit:100, flag:"self_hit_floor", value:100, req:{ earth:2 } },
  { id:"terra_break", name:"テラブレイク", type:"atk", hit:100, damage:8, pierce:["barrier","shield"], req:{ earth:2 } },

  { id:"critical", name:"クリティカル", type:"buff", hit:100, flag:"next_hit_plus", value:25, req:{ light:2 } },
  { id:"prism_ray", name:"プリズムレイ", type:"atk_buff", hit:75, damage:6, flag:"next_hit_plus", value:15, req:{ light:2 } },
  { id:"resonance", name:"レゾナンス", type:"atk_resonance", hit:100, base:0, req:{ light:2 } },

  { id:"blind", name:"ブラインド", type:"debuff_cond", hit:100, flag:"blind_next", value:-70, req:{ dark:2 } },

  { id:"catastrophe", name:"カタストロフ", type:"atk", hit:25, damage:15, req:{ fire:1, water:1, earth:1 } },
  { id:"steam_blast", name:"スチームブラスト", type:"atk", hit:60, damage:11, req:{ fire:1, water:1 } },
  { id:"gravity_well", name:"グラビティウェル", type:"atk_debuff", hit:60, damage:8, flag:"lock_two_next", lockA:"light", lockB:"dark", req:{ earth:1, water:1 } },
];

const SPELL_BY_ID = Object.fromEntries(SPELLS.map(s => [s.id, s]));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ceilDiv2 = (x) => Math.floor((x + 1) / 2);
const rand01 = () => Math.random();

function reqToText(req){
  const parts = [];
  for (const k of MANA_KEYS){
    if (req?.[k]) parts.push(`${MANA_JA[k]}${req[k]}`);
  }
  return parts.join(" ");
}
function deepClone(obj){ return JSON.parse(JSON.stringify(obj)); }

function sumReq(spells){
  const r = { fire:0, water:0, earth:0, light:0, dark:0 };
  for (const sp of spells){
    for (const k of MANA_KEYS){
      r[k] += (sp.req?.[k] || 0);
    }
  }
  return r;
}
function canPayReq(owned, req){
  for (const k of MANA_KEYS){
    if ((owned[k] || 0) < (req[k] || 0)) return false;
  }
  return true;
}
function countTypesUsed(req){
  let c = 0;
  for (const k of MANA_KEYS) if ((req[k] || 0) > 0) c += 1;
  return c;
}

// UI
const el = (id) => document.getElementById(id);
const ui = {
  eHP: el("eHP"), eMP: el("eMP"), eHand: el("eHand"), eReady: el("eReady"),
  pHP: el("pHP"), pMP: el("pMP"), pReady: el("pReady"), turn: el("turn"),
  hand: el("hand"), pSlot1: el("pSlot1"), pSlot2: el("pSlot2"),
  manaRack: el("manaRack"), manaField: el("manaField"),
  castBtn: el("castBtn"), log: el("log"),
};

function logRow(text, cls=""){
  const div = document.createElement("div");
  div.className = "row " + cls;
  div.textContent = text;
  ui.log.appendChild(div);
  ui.log.scrollTop = ui.log.scrollHeight;
}

// 効果は「今ターン適用(cur)」と「次ターン適用(next)」を分離する
function emptyEffects(){
  return {
    barrier: false,     // 今ターン被ダメ0（=前ターンのバリア予約が cur に乗る）
    shield: 0,          // 次に受けるダメ-3（curに乗る）
    reflect: false,     // 今ターン反射（curに乗る）※本格反射は次段でもOK
    evade: 0,           // 攻撃命中率-40（curに乗る）
    hitMod: 0,          // 命中修正（curに乗る）
    blind: { active:false, value:-70, voidIfDarkUsed:true }, // curに乗る
    locks: { fire:false, water:false, earth:false, light:false, dark:false }, // curに乗る
    lockUsedTypes: null, // フリーズ用：次ターン開始で locks に変換
    siphon: false,      // 結果依存（当ターンに処理）
    nextHitPlus: 0,     // 次の攻撃 命中+（=curに保持され、攻撃で消費）
    nextDmgPlus: 0,     // 次の攻撃 ダメ+（=curに保持され、攻撃で消費）
    selfHitFloor: null, // アイアンウィル（cur）
  };
}

function newPlayer(){
  return {
    hp: 50,
    mp: 3,
    manaOwned: { fire:3, water:3, earth:3, light:3, dark:3 },
    manaField: { fire:0, water:0, earth:0, light:0, dark:0 },
    deck: [], hand: [], discard: [],
    slots: [null, null],
    effectsCur: emptyEffects(),
    effectsNext: emptyEffects(),
  };
}

const state = {
  turn: 1,
  phase: "PREPARE",
  you: newPlayer(),
  enemy: newPlayer(),
};

// デッキ（各呪文1枚）シャッフル
function buildDeck(){
  const ids = SPELLS.map(s => s.id);
  for (let i = ids.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
function draw(player, n){
  for (let i = 0; i < n; i++){
    if (player.deck.length === 0){
      player.deck = buildDeck();
      player.discard = [];
    }
    player.hand.push(player.deck.shift());
  }
}

function resetMatch(){
  state.turn = 1;
  state.phase = "PREPARE";
  state.you = newPlayer();
  state.enemy = newPlayer();
  state.you.deck = buildDeck();
  state.enemy.deck = buildDeck();
  draw(state.you, 7);
  draw(state.enemy, 7);

  ui.log.innerHTML = "";
  logRow("SPELL BURST 開始", "dim");
  render();
}

// -------------------------------
// 手札/スロット
// -------------------------------
function placeToSlot(handIndex){
  const you = state.you;
  const id = you.hand[handIndex];
  const emptyIdx = you.slots.findIndex(x => x === null);
  if (emptyIdx === -1) return;

  you.hand.splice(handIndex, 1);
  you.slots[emptyIdx] = id;

  logRow(`スロットへ：${SPELL_BY_ID[id].name}`, "dim");
  updateReady();
  render();
}
function removeFromSlot(slotIdx){
  const you = state.you;
  const id = you.slots[slotIdx];
  if (!id) return;

  you.slots[slotIdx] = null;
  you.hand.push(id);

  logRow(`手札へ戻した：${SPELL_BY_ID[id].name}`, "dim");
  updateReady();
  render();
}

// -------------------------------
// 魔素UI（ロック中の属性は置けない）
// -------------------------------
function addManaToField(key){
  const you = state.you;

  // 今ターン使用不可（ロック）なら置かせない
  if (you.effectsCur.locks[key]) return;

  const owned = you.manaOwned[key];
  const used = you.manaField[key];
  if (used >= owned) return;

  you.manaField[key] += 1;
  updateReady();
  render();
}
function removeManaFromField(key){
  const you = state.you;
  if (you.manaField[key] <= 0) return;
  you.manaField[key] -= 1;
  updateReady();
  render();
}

// -------------------------------
// READY判定
// - 呪文1枚以上
// - 要求魔素をmanaFieldが満たす
// - ロック属性をフィールドに置いていない（そもそも置けないが保険）
// -------------------------------
function updateReady(){
  const you = state.you;

  const slotSpells = you.slots.filter(Boolean).map(id => SPELL_BY_ID[id]);
  const hasSpell = slotSpells.length >= 1;

  const req = sumReq(slotSpells);
  const field = you.manaField;

  let reqOk = true;
  for (const k of MANA_KEYS){
    if ((field[k] || 0) < (req[k] || 0)) reqOk = false;
  }

  let lockOk = true;
  for (const k of MANA_KEYS){
    if (you.effectsCur.locks[k] && (field[k] || 0) > 0) lockOk = false;
  }

  const ready = hasSpell && reqOk && lockOk;

  ui.pReady.textContent = ready ? "READY" : "NOT READY";
  ui.pReady.className = ready ? "pill" : "pill pill-dim";
  ui.castBtn.disabled = !ready;
}

// -------------------------------
// 敵AI（2枚まで＋必要魔素を自動セット）
// ※ロック中の属性要求は避ける
// -------------------------------
function aiPrepare(){
  const ai = state.enemy;

  ai.slots = [null, null];
  ai.manaField = { fire:0, water:0, earth:0, light:0, dark:0 };

  const handIds = ai.hand.slice();
  const combos = [];

  for (let i = 0; i < handIds.length; i++) combos.push([handIds[i]]);
  for (let i = 0; i < handIds.length; i++){
    for (let j = i + 1; j < handIds.length; j++){
      combos.push([handIds[i], handIds[j]]);
    }
  }

  function score(ids){
    const spells = ids.map(id => SPELL_BY_ID[id]);
    const req = sumReq(spells);

    if (!canPayReq(ai.manaOwned, req)) return -1e9;

    // ロック中の属性を要求するなら即除外
    for (const k of MANA_KEYS){
      if (ai.effectsCur.locks[k] && (req[k] || 0) > 0) return -1e9;
    }

    // 期待値（ざっくり）
    let expected = 0;
    for (const sp of spells){
      const p = sp.hit / 100;

      // ダメージ系（レゾナンス/インフェルノは概算で評価）
      if (sp.type === "atk_resonance") expected += p * 6.0;
      else if (sp.type === "atk_scaling") expected += p * 6.0;
      else if (sp.damage) expected += p * sp.damage;

      if (sp.heal) expected += p * (sp.heal * 0.55);

      if (sp.type === "atk_self" && sp.self) expected -= sp.self * 0.4;
      if (sp.type === "buff_selfpay") expected -= 2.0;

      if (sp.id === "mist") expected += 1.2;
      if (sp.id === "freeze") expected += 1.4;
      if (sp.id === "blind") expected += 1.0;
      if (sp.id === "barrier") expected += 1.6;
      if (sp.id === "reflect") expected += 1.4;
      if (sp.id === "terra_break") expected += 0.8;
      if (sp.id === "gravity_well") expected += 1.1;
    }
    return expected;
  }

  let best = [];
  let bestScore = -1e9;
  for (const ids of combos){
    const sc = score(ids);
    if (sc > bestScore){
      bestScore = sc;
      best = ids.slice();
    }
  }
  if (best.length === 0 && handIds.length > 0) best = [handIds[0]];

  const spells = best.map(id => SPELL_BY_ID[id]);
  const req = sumReq(spells);

  ai.slots[0] = best[0] || null;
  ai.slots[1] = best[1] || null;

  for (const k of MANA_KEYS){
    ai.manaField[k] = req[k] || 0;
  }

  // 手札から除去
  for (const id of best){
    const idx = ai.hand.indexOf(id);
    if (idx >= 0) ai.hand.splice(idx, 1);
  }
}

// -------------------------------
// 命中率計算（今ターン適用 = defender.effectsCur）
// -------------------------------
function calcHit(attacker, defender, spell, context){
  let hit = spell.hit;

  // ブラインド：全体-70、闇使用側は無効
  if (defender.effectsCur.blind.active){
    const voided = defender.effectsCur.blind.voidIfDarkUsed && (context.attackerUsedDark === true);
    if (!voided) hit += defender.effectsCur.blind.value;
  }

  // ミスト等（今ターンの命中修正）
  hit += defender.effectsCur.hitMod;

  // シャドウステップ（次に受ける攻撃 命中-40）
  hit -= (defender.effectsCur.evade || 0);

  // アイアンウィル（このターン攻撃命中率100）
  if (attacker.effectsCur.selfHitFloor === 100 && spell.type !== "heal"){
    hit = 100;
  }

  // 次の攻撃 命中+
  hit += (attacker.effectsCur.nextHitPlus || 0);

  return clamp(hit, 5, 100);
}

// -------------------------------
// 防御（今ターン適用 = defender.effectsCur）
// -------------------------------
function applyDefense(defender, dmg, pierceFlags){
  let final = dmg;

  // バリア（被ダメ0）
  if (defender.effectsCur.barrier && !pierceFlags.includes("barrier")){
    final = 0;
  }

  // アースシールド（次に受けるダメ-3）
  if (defender.effectsCur.shield > 0 && !pierceFlags.includes("shield")){
    final = Math.max(0, final - defender.effectsCur.shield);
    defender.effectsCur.shield = 0; // 1回で消費
  }

  return final;
}

// -------------------------------
// ターン解決
// - 効果生成：次ターンに乗るものは effectsNext に積む
// - HP反映：同時
// -------------------------------
function resolveTurn(){
  const you = state.you;
  const enemy = state.enemy;

  const youUsedDark = (you.manaField.dark || 0) > 0;
  const enemyUsedDark = (enemy.manaField.dark || 0) > 0;

  const youSpells = you.slots.filter(Boolean).map(id => SPELL_BY_ID[id]);
  const enemySpells = enemy.slots.filter(Boolean).map(id => SPELL_BY_ID[id]);

  const youOut = { dmg:0, heal:0, siphon:false };
  const enemyOut = { dmg:0, heal:0, siphon:false };

  function runCaster(attacker, defender, spells, out, ctx){
    for (const sp of spells){
      const hit = calcHit(attacker, defender, sp, ctx);
      const ok = (rand01() * 100) < hit;

      logRow(`${attacker === you ? "YOU" : "ENEMY"}：${sp.name}（命中 ${hit}%）`, "dim");

      if (!ok){
        logRow(`→ 不発`, "dim");
        continue;
      }

      // -------- 攻撃系：ここが修正の核心（レゾナンス/インフェルノ含む） --------
      const isAttackType =
        sp.type === "atk" ||
        sp.type === "atk_debuff" ||
        sp.type === "atk_buff" ||
        sp.type === "atk_resonance" ||
        sp.type === "atk_scaling";

      if (isAttackType){
        let dmg = sp.damage || 0;

        // レゾナンス：使用魔素タイプ数×2
        if (sp.type === "atk_resonance"){
          dmg += countTypesUsed(attacker.manaField) * 2;
        }

        // インフェルノコア：火魔素1つにつき4
        if (sp.type === "atk_scaling"){
          dmg += (attacker.manaField.fire || 0) * sp.perFire;
        }

        // 次の攻撃 ダメ+（エンチャント/ブラッドペイ）
        if (attacker.effectsCur.nextDmgPlus > 0){
          dmg += attacker.effectsCur.nextDmgPlus;
          attacker.effectsCur.nextDmgPlus = 0; // 消費
        }

        // 次の攻撃 命中+（クリティカル/プリズム）も「攻撃が行われた時点で消費」扱い
        if (attacker.effectsCur.nextHitPlus > 0){
          attacker.effectsCur.nextHitPlus = 0;
        }

        const pierce = sp.pierce ? sp.pierce : [];
        const dealt = applyDefense(defender, dmg, pierce);
        out.dmg += dealt;

        logRow(`→ ${defender === you ? "YOU" : "ENEMY"}へ ${dealt} ダメ`, "bad");

        // 次ターン予約（ロック）
        if (sp.flag === "lock_mana_next"){
          defender.effectsNext.locks[sp.lockKey] = true;
          logRow(`→ 次ターン：${defender === you ? "YOU" : "ENEMY"}は${MANA_JA[sp.lockKey]}使用不可`, "dim");
        }
        if (sp.flag === "lock_two_next"){
          defender.effectsNext.locks[sp.lockA] = true;
          defender.effectsNext.locks[sp.lockB] = true;
          logRow(`→ 次ターン：${defender === you ? "YOU" : "ENEMY"}は${MANA_JA[sp.lockA]}・${MANA_JA[sp.lockB]}使用不可`, "dim");
        }
      }

      // 回復
      if (sp.type === "heal"){
        out.heal += sp.heal || 0;
        logRow(`→ ${attacker === you ? "YOU" : "ENEMY"}が ${sp.heal} 回復`, "good");
      }

      // ドレイン
      if (sp.type === "atk_heal"){
        const dealt = applyDefense(defender, sp.damage || 0, []);
        out.dmg += dealt;
        out.heal += sp.heal || 0;
        logRow(`→ ${defender === you ? "YOU" : "ENEMY"}へ ${dealt} ダメ`, "bad");
        logRow(`→ ${attacker === you ? "YOU" : "ENEMY"}が ${sp.heal} 回復`, "good");
      }

      // オーバーフロー
      if (sp.type === "atk_self"){
        const dealt = applyDefense(defender, sp.damage || 0, []);
        out.dmg += dealt;
        attacker.hp -= sp.self || 0;
        logRow(`→ ${defender === you ? "YOU" : "ENEMY"}へ ${dealt} ダメ`, "bad");
        logRow(`→ 反動：${attacker === you ? "YOU" : "ENEMY"}が ${sp.self} 自傷`, "bad");
      }

      // バフ（次ターンへ積む）
      if (sp.type === "buff"){
        if (sp.flag === "barrier_next"){
          attacker.effectsNext.barrier = true;
          logRow(`→ 次ターン：被ダメ0（バリア）`, "good");
        }
        if (sp.flag === "shield_next"){
          attacker.effectsNext.shield = sp.value || 3;
          logRow(`→ 次ターン：次に受けるダメ-${attacker.effectsNext.shield}（アースシールド）`, "good");
        }
        if (sp.flag === "reflect_next"){
          attacker.effectsNext.reflect = true;
          logRow(`→ 次ターン：反射（リフレクト）`, "good");
        }
        if (sp.flag === "evade_next"){
          attacker.effectsNext.evade = sp.value || 40;
          logRow(`→ 次ターン：次に受ける攻撃 命中-${attacker.effectsNext.evade}（ステップ）`, "good");
        }
        if (sp.flag === "self_hit_floor"){
          attacker.effectsCur.selfHitFloor = sp.value;
          logRow(`→ このターン：攻撃命中率100（アイアンウィル）`, "good");
        }
        if (sp.flag === "next_hit_plus"){
          attacker.effectsCur.nextHitPlus += sp.value || 0;
          logRow(`→ 次の攻撃 命中+${sp.value}`, "good");
        }
        if (sp.flag === "next_dmg_plus"){
          attacker.effectsCur.nextDmgPlus += sp.value || 0;
          logRow(`→ 次の攻撃 ダメ+${sp.value}`, "good");
        }
      }

      // ブラッドペイ
      if (sp.type === "buff_selfpay"){
        const pay = Math.ceil(attacker.hp * (sp.payHpPct / 100));
        attacker.hp -= pay;
        attacker.effectsCur.nextDmgPlus += sp.value || 0;
        logRow(`→ 代償：${attacker === you ? "YOU" : "ENEMY"}が ${pay} 自傷`, "bad");
        logRow(`→ 次の攻撃 ダメ+${sp.value}`, "good");
      }

      // ミスト（次ターン命中-50）
      if (sp.type === "debuff" && sp.flag === "enemy_hit_mod_next"){
        defender.effectsNext.hitMod += sp.value || 0;
        logRow(`→ 次ターン：${defender === you ? "YOU" : "ENEMY"}命中${sp.value}`, "dim");
      }

      // ブラインド（次ターン全体命中-70）
      if (sp.type === "debuff_cond"){
        defender.effectsNext.blind.active = true;
        defender.effectsNext.blind.value = sp.value || -70;
        logRow(`→ 次ターン：全体 命中${sp.value}（闇使用側は無効）`, "dim");
      }

      // フリーズ（次ターン：相手はこのターン使ったタイプを使用不可）
      if (sp.id === "freeze"){
        defender.effectsNext.lockUsedTypes = deepClone(attacker.manaField);
        logRow(`→ 次ターン：相手は「このターン使用タイプ」を使用不可`, "dim");
      }

      // サイフォン（結果依存）
      if (sp.flag === "siphon_after"){
        out.siphon = true;
        logRow(`→ 結果：与えたダメの半分回復（サイフォン）`, "good");
      }
    }
  }

  runCaster(you, enemy, youSpells, youOut, { attackerUsedDark: youUsedDark });
  runCaster(enemy, you, enemySpells, enemyOut, { attackerUsedDark: enemyUsedDark });

  // 同時HP反映
  const youBefore = you.hp;
  const enemyBefore = enemy.hp;

  you.hp   = you.hp   - enemyOut.dmg + youOut.heal;
  enemy.hp = enemy.hp - youOut.dmg   + enemyOut.heal;

  // サイフォン（与えたダメの半分回復）
  if (youOut.siphon){
    const heal = ceilDiv2(youOut.dmg);
    you.hp += heal;
    logRow(`YOU：サイフォン回復 +${heal}`, "good");
  }
  if (enemyOut.siphon){
    const heal = ceilDiv2(enemyOut.dmg);
    enemy.hp += heal;
    logRow(`ENEMY：サイフォン回復 +${heal}`, "good");
  }

  logRow(`HP更新：YOU ${youBefore} → ${you.hp} / ENEMY ${enemyBefore} → ${enemy.hp}`, "dim");

  // 魔素消費（フィールド分だけ所持から減）
  function consumeMana(p){
    for (const k of MANA_KEYS){
      p.manaOwned[k] = Math.max(0, (p.manaOwned[k] || 0) - (p.manaField[k] || 0));
      p.manaField[k] = 0;
    }
  }
  consumeMana(you);
  consumeMana(enemy);

  // 呪文を捨て札へ（場→捨て）
  function discardUsed(p){
    for (let i = 0; i < 2; i++){
      if (p.slots[i]){
        p.discard.push(p.slots[i]);
        p.slots[i] = null;
      }
    }
  }
  discardUsed(you);
  discardUsed(enemy);
}

// -------------------------------
// 次ターン開始：effectsNext → effectsCur に昇格
// - フリーズ（lockUsedTypes）を locks に変換
// - このターン用に effectsNext を空に戻す
// -------------------------------
function promoteNextEffects(p){
  p.effectsCur = p.effectsNext;
  p.effectsNext = emptyEffects();

  // フリーズの「使用タイプ禁止」を locks に変換
  const used = p.effectsCur.lockUsedTypes;
  if (used){
    for (const k of MANA_KEYS){
      if ((used[k] || 0) > 0) p.effectsCur.locks[k] = true;
    }
    p.effectsCur.lockUsedTypes = null;
  }

  // アイアンウィルは「そのターンのみ」なので毎ターン開始で消す
  p.effectsCur.selfHitFloor = null;

  // nextHitPlus/nextDmgPlus は「消費されるまで保持」なので cur に残す（ここでは触らない）
}

// -------------------------------
// ターン開始
// -------------------------------
function turnStart(){
  ui.turn.textContent = `TURN ${state.turn}/${MAX_TURN}`;

  // 前ターンに積まれた効果を今ターンに反映
  promoteNextEffects(state.you);
  promoteNextEffects(state.enemy);

  // ドロー
  if (state.turn !== 1){
    draw(state.you, 1);
    draw(state.enemy, 1);
  }

  // 敵準備
  aiPrepare();

  updateReady();
  render();
}

// -------------------------------
// 発動
// -------------------------------
function cast(){
  if (state.phase !== "PREPARE") return;

  updateReady();
  if (ui.castBtn.disabled) return;

  state.phase = "RESOLVE";
  logRow(`── ターン${state.turn} 解決 ──`, "dim");

  resolveTurn();

  if (state.turn >= MAX_TURN){
    finishMatch();
    return;
  }

  state.turn += 1;
  state.phase = "PREPARE";
  turnStart();
}

function finishMatch(){
  const you = state.you;
  const enemy = state.enemy;

  logRow(`── 試合終了 ──`, "dim");

  if (you.hp > enemy.hp){
    logRow(`勝利：YOU（HP ${you.hp} vs ${enemy.hp}）`, "good");
  } else if (enemy.hp > you.hp){
    logRow(`敗北：ENEMY（HP ${you.hp} vs ${enemy.hp}）`, "bad");
  } else {
    logRow(`引き分け（HP ${you.hp}）`, "dim");
  }

  ui.castBtn.disabled = true;
  render();
}

// -------------------------------
// 描画
// -------------------------------
function render(){
  const you = state.you;
  const enemy = state.enemy;

  ui.pHP.textContent = `HP ${you.hp}`;
  ui.pMP.textContent = `MP ${you.mp}`;
  ui.eHP.textContent = `HP ${enemy.hp}`;
  ui.eMP.textContent = `MP ${enemy.mp}`;
  ui.eHand.textContent = `HAND ${enemy.hand.length}`;

  const enemyReady = enemy.slots.some(Boolean);
  ui.eReady.textContent = enemyReady ? "READY" : "NOT READY";
  ui.eReady.className = enemyReady ? "pill" : "pill pill-dim";

  // 手札
  ui.hand.innerHTML = "";
  you.hand.forEach((id, idx) => {
    const sp = SPELL_BY_ID[id];
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = sp.name;
    div.title =
      `${sp.name}\n命中:${sp.hit}%\n条件:${reqToText(sp.req)}\n` +
      `${sp.damage ? "ダメ:"+sp.damage : ""}${sp.heal ? " 回復:"+sp.heal : ""}`;
    div.onclick = () => placeToSlot(idx);
    ui.hand.appendChild(div);
  });

  // スロット
  function setSlot(elm, id, idx){
    if (!id){
      elm.textContent = "（空）";
      elm.className = "slotCard empty";
      elm.onclick = () => {};
      return;
    }
    const sp = SPELL_BY_ID[id];
    elm.textContent = sp.name;
    elm.className = "slotCard filled";
    elm.title = `${sp.name}\n命中:${sp.hit}%\n条件:${reqToText(sp.req)}`;
    elm.onclick = () => removeFromSlot(idx);
  }
  setSlot(ui.pSlot1, you.slots[0], 0);
  setSlot(ui.pSlot2, you.slots[1], 1);

  // 魔素ラック（残り = 所持 - フィールド）
  ui.manaRack.innerHTML = "";
  for (const k of MANA_KEYS){
    const btn = document.createElement("div");
    btn.className = "manaBtn";
    btn.onclick = () => addManaToField(k);

    // ロック中は視覚的に弱く
    if (you.effectsCur.locks[k]){
      btn.style.opacity = "0.45";
      btn.style.filter = "saturate(0.6)";
    }

    const left = document.createElement("div");
    left.style.display = "inline-flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";

    const dot = document.createElement("span");
    dot.className = "manaDot";
    dot.style.background = MANA_DOT[k];

    const txt = document.createElement("span");
    txt.textContent = MANA_JA[k];

    left.appendChild(dot);
    left.appendChild(txt);

    const count = document.createElement("span");
    const remain = (you.manaOwned[k] || 0) - (you.manaField[k] || 0);
    count.className = "manaCount";
    count.textContent = String(remain);

    btn.appendChild(left);
    btn.appendChild(count);
    ui.manaRack.appendChild(btn);
  }

  // フィールド魔素（タップで戻す）
  ui.manaField.innerHTML = "";
  for (const k of MANA_KEYS){
    const n = you.manaField[k] || 0;
    for (let i = 0; i < n; i++){
      const token = document.createElement("div");
      token.className = "manaToken";
      token.onclick = () => removeManaFromField(k);

      const dot = document.createElement("span");
      dot.className = "manaDot";
      dot.style.background = MANA_DOT[k];

      const txt = document.createElement("span");
      txt.textContent = MANA_JA[k];

      token.appendChild(dot);
      token.appendChild(txt);
      ui.manaField.appendChild(token);
    }
  }

  updateReady();
}

// 起動
ui.castBtn.addEventListener("click", cast);
resetMatch();
turnStart();
