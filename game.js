// ====== 基本 ======
const E = {
  FIRE: "fire",
  WATER: "water",
  EARTH: "earth",
  LIGHT: "light",
  DARK: "dark",
};
const EMOJI = { fire:"🔥", water:"💧", earth:"🪨", light:"✨", dark:"🌑" };
const ORB = { fire:"fire", water:"water", earth:"earth", light:"light", dark:"dark" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ceilDiv2 = (x) => Math.ceil(x / 2);

// ====== 呪文（まずは演出が分かりやすい最小セット）======
// ここは後であなたの26枚を丸ごと入れ替えできます。
const SPELLS = [
  { id:"fire", name:"ファイア", baseHit:100, kind:"attack", dmg:5, req:{fire:1} },
  { id:"water", name:"ウォーター", baseHit:100, kind:"attack", dmg:5, req:{water:1} },
  { id:"stone", name:"ストーン", baseHit:100, kind:"attack", dmg:5, req:{earth:1} },
  { id:"heal", name:"ヒール", baseHit:75, kind:"heal", heal:9, req:{light:2} },
];

// ====== 山札（重複が気になる前提で、まずは「山札方式」）======
function makeDeck() {
  // 体験優先：同名が並びすぎる体感を抑えるため、各カードを複数枚ずつ入れる
  const deck = [];
  for (const s of SPELLS) {
    const copies = (s.id === "heal") ? 5 : 7; // ざっくり
    for (let i=0;i<copies;i++) deck.push(structuredClone(s));
  }
  shuffle(deck);
  return deck;
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
}

// ====== ステート ======
const state = {
  turn: 1,
  maxTurn: 5,
  player: {
    hp: 50,
    mp: 3,
    mana: { fire:3, water:3, earth:3, light:3, dark:3 },
    manaField: { fire:0, water:0, earth:0, light:0, dark:0 },
    deck: makeDeck(),
    hand: [],
    slots: [null, null],
    ready: false,
  },
  enemy: {
    hp: 50,
    mp: 3,
    mana: { fire:3, water:3, earth:3, light:3, dark:3 },
    deck: makeDeck(),
    handCount: 0,
    ready: false,
  },
};

// ====== UI refs ======
const $ = (id) => document.getElementById(id);
const logBox = $("log");
const fxLayer = $("fxLayer");

function setLog(text){
  logBox.textContent = text;
}

function updateBars(){
  $("playerHp").textContent = state.player.hp;
  $("enemyHp").textContent = state.enemy.hp;

  // HPバーは「50基準」だと超えた時に伸びるので、見やすさ優先で100を基準にします
  const p = clamp(state.player.hp, 0, 100);
  const e = clamp(state.enemy.hp, 0, 100);
  $("playerHpFill").style.width = `${p}%`;
  $("enemyHpFill").style.width = `${e}%`;

  $("playerInfo").textContent = `HAND ${state.player.hand.length} / MP ${state.player.mp}`;
  $("enemyInfo").textContent = `HAND ${state.enemy.handCount} / MP ${state.enemy.mp}`;

  $("playerReady").textContent = state.player.ready ? "READY" : "NOT READY";
  $("playerReady").classList.toggle("on", state.player.ready);

  $("enemyReady").textContent = state.enemy.ready ? "READY" : "NOT READY";
  $("enemyReady").classList.toggle("on", state.enemy.ready);
}

function renderManaPool(){
  const pool = $("manaPool");
  pool.innerHTML = "";
  for (const k of ["fire","water","earth","light","dark"]) {
    const chip = document.createElement("div");
    chip.className = "mana-chip";
    chip.innerHTML = `
      <div class="mana-name">
        <div class="orb ${ORB[k]}"></div>
        <div>${EMOJI[k]} ${k.toUpperCase()}</div>
      </div>
      <div class="mana-count" id="manaCount_${k}">${state.player.mana[k]}</div>
    `;
    chip.addEventListener("click", () => moveManaToField(k));
    pool.appendChild(chip);
  }
}

function renderManaSelected(){
  const box = $("manaSelected");
  box.innerHTML = "";

  for (const k of ["fire","water","earth","light","dark"]) {
    const n = state.player.manaField[k];
    if (n <= 0) continue;

    for (let i=0;i<n;i++){
      const orb = document.createElement("div");
      orb.className = `mana-chip`;
      orb.style.justifyContent = "center";
      orb.innerHTML = `<div class="mana-name"><div class="orb ${ORB[k]}"></div><div>${EMOJI[k]} ${k.toUpperCase()}</div></div>`;
      orb.addEventListener("click", () => moveManaBack(k));
      box.appendChild(orb);
    }
  }

  // カウント更新
  for (const k of ["fire","water","earth","light","dark"]) {
    const el = document.getElementById(`manaCount_${k}`);
    if (el) el.textContent = state.player.mana[k];
  }
}

function moveManaToField(k){
  if (state.player.mana[k] <= 0) {
    pulseLog("魔素が尽きています。");
    return;
  }
  state.player.mana[k]--;
  state.player.manaField[k]++;
  renderManaSelected();
  updateReady();
}

function moveManaBack(k){
  if (state.player.manaField[k] <= 0) return;
  state.player.manaField[k]--;
  state.player.mana[k]++;
  renderManaSelected();
  updateReady();
}

function renderHand(){
  const handDiv = $("hand");
  handDiv.innerHTML = "";

  state.player.hand.forEach((card, idx) => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="cname">${card.name}</div>
      <div class="cmeta">命中 ${card.baseHit}% / ${card.kind === "attack" ? `ダメ ${card.dmg}` : `回復 ${card.heal}`}</div>
      <div class="cmeta">条件 ${reqText(card.req)}</div>
    `;
    div.addEventListener("click", () => putToSlot(idx));
    handDiv.appendChild(div);
  });
}

function reqText(req){
  const parts = [];
  for (const [k,v] of Object.entries(req)){
    parts.push(`${EMOJI[k]}${v}+`);
  }
  return parts.join(" ");
}

function renderSlots(){
  $("slotCard0").textContent = state.player.slots[0]?.name ?? "";
  $("slotCard1").textContent = state.player.slots[1]?.name ?? "";
}

function putToSlot(handIndex){
  const card = state.player.hand[handIndex];
  const s0 = state.player.slots[0];
  const s1 = state.player.slots[1];

  if (!s0) state.player.slots[0] = card;
  else if (!s1) state.player.slots[1] = card;
  else {
    pulseLog("スロットが埋まっています（2枚まで）。");
    return;
  }

  state.player.hand.splice(handIndex, 1);
  renderHand();
  renderSlots();
  updateReady();
}

function popFromSlot(slotIndex){
  const c = state.player.slots[slotIndex];
  if (!c) return;
  state.player.slots[slotIndex] = null;
  state.player.hand.push(c);
  renderHand();
  renderSlots();
  updateReady();
}

// ====== READY判定 ======
function canPayReq(req, manaField){
  for (const [k,v] of Object.entries(req)){
    if ((manaField[k] ?? 0) < v) return false;
  }
  return true;
}
function updateReady(){
  const hasSpell = !!(state.player.slots[0] || state.player.slots[1]);
  const ok0 = state.player.slots[0] ? canPayReq(state.player.slots[0].req, state.player.manaField) : true;
  const ok1 = state.player.slots[1] ? canPayReq(state.player.slots[1].req, state.player.manaField) : true;
  state.player.ready = hasSpell && ok0 && ok1;
  updateBars();
}

// ====== 演出 ======
function pulseLog(t){
  setLog(t);
  logBox.classList.remove("glow");
  void logBox.offsetWidth;
  logBox.classList.add("glow");
}

function floatFx(text, cls, where){
  const el = document.createElement("div");
  el.className = `fx-float ${cls}`;
  el.textContent = text;

  // 位置：enemyは上寄り、playerは下寄り
  const rect = fxLayer.getBoundingClientRect();
  const x = rect.left + rect.width * 0.5 + (Math.random()*24-12);
  const y = rect.top + (where === "enemy" ? rect.height*0.25 : rect.height*0.75) + (Math.random()*16-8);

  el.style.left = `${x - rect.left}px`;
  el.style.top  = `${y - rect.top}px`;

  fxLayer.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function shakeZone(zoneClass){
  const z = document.querySelector(zoneClass);
  z.classList.remove("shake");
  void z.offsetWidth;
  z.classList.add("shake");
}

// ====== ドロー ======
function draw(p, n){
  for(let i=0;i<n;i++){
    if (p.deck.length === 0) p.deck = makeDeck();
    p.hand.push(p.deck.pop());
  }
}
function enemyDraw(n){
  state.enemy.handCount += n;
}

// ====== 戦闘ロジック（同時発動の「まず殴れる版」） ======
// ルールブック完全版の順序へは、次の段階で寄せます。
// 今は「フィールドに置く」「戻す」「演出が分かる」「対戦できる」を最優先します。
function resolveCast(){
  // プレイヤーがREADY扱いでない場合：拳で殴る（あなたの裁定に寄せた簡易）
  const playerSpells = state.player.ready
    ? [state.player.slots[0], state.player.slots[1]].filter(Boolean)
    : [{ id:"punch", name:"拳", baseHit:100, kind:"attack", dmg:2, req:{} }];

  // 敵AI：手札枚数だけ持っている体で、出せる中で期待値が高いものを選ぶ（最大2）
  const enemyAction = enemyChooseAction();

  // 命中判定→効果生成（同時適用）
  const pResult = execSpells("player", playerSpells, state.player.manaField);
  const eResult = execSpells("enemy", enemyAction.spells, enemyAction.manaField);

  // 同時適用
  const pHpBefore = state.player.hp;
  const eHpBefore = state.enemy.hp;

  state.enemy.hp = state.enemy.hp - pResult.damage + pResult.heal;
  state.player.hp = state.player.hp - eResult.damage + eResult.heal;

  // 演出（結果の見える化）
  if (pResult.damage > 0) { floatFx(`-${pResult.damage}`, "fx-dmg", "enemy"); shakeZone(".enemy-zone"); }
  if (pResult.heal > 0) { floatFx(`+${pResult.heal}`, "fx-heal", "player"); }

  if (eResult.damage > 0) { floatFx(`-${eResult.damage}`, "fx-dmg", "player"); shakeZone(".player-zone"); }
  if (eResult.heal > 0) { floatFx(`+${eResult.heal}`, "fx-heal", "enemy"); }

  // ミス表示
  if (pResult.missCount > 0) floatFx("MISS", "fx-miss", "enemy");
  if (eResult.missCount > 0) floatFx("MISS", "fx-miss", "player");

  // 消費：プレイヤーは「フィールドに置いた魔素」を消費としてフィールドを空にする
  state.player.manaField = { fire:0, water:0, earth:0, light:0, dark:0 };

  // 呪文は使ったら捨て札扱い（今は捨て札表示なしで消える）
  state.player.slots = [null, null];

  // 敵の魔素も消費
  state.enemy.mana = subMana(state.enemy.mana, enemyAction.manaField);

  // ログ
  const pNames = playerSpells.map(s=>s.name).join(" + ");
  const eNames = enemyAction.spells.map(s=>s.name).join(" + ");
  setLog(`TURN ${state.turn}/${state.maxTurn}\nYOU: ${pNames}\nENEMY: ${eNames}`);

  // 次ターン
  endTurn();
}

function subMana(mana, used){
  const out = {...mana};
  for (const k of ["fire","water","earth","light","dark"]){
    out[k] = Math.max(0, out[k] - (used[k]||0));
  }
  return out;
}

function execSpells(side, spells, manaField){
  let damage = 0;
  let heal = 0;
  let missCount = 0;

  for (const s of spells){
    const hit = clamp(s.baseHit, 5, 100);
    const roll = Math.random()*100;
    const ok = roll <= hit;

    if (!ok) { missCount++; continue; }

    if (s.kind === "attack") damage += s.dmg || 0;
    if (s.kind === "heal") heal += s.heal || 0;
  }

  return { damage, heal, missCount };
}

// 敵AI：出せるものから期待値が高い順に2つ
function enemyChooseAction(){
  // 敵の「手札」は枚数だけ。選択は「候補からランダム抽選」より体感良いので期待値優先
  // 魔素制約を守るために、敵にも一時的なmanaFieldを作って支払い可能なものを選びます。
  const manaAvail = {...state.enemy.mana};
  const manaField = { fire:0, water:0, earth:0, light:0, dark:0 };

  // 候補はSPELLS固定（手札枚数は演出として残す）
  const candidates = SPELLS.slice().map(s => ({
    ...s,
    score: expectedValue(s),
  })).sort((a,b)=>b.score-a.score);

  const picked = [];
  for (const c of candidates){
    if (picked.length >= 2) break;

    // 支払いチェック（敵はここでフィールドに積む想定）
    if (canPayReqEnemy(c.req, manaAvail, manaField)){
      payReqEnemy(c.req, manaAvail, manaField);
      picked.push(c);
    }
  }

  if (picked.length === 0){
    picked.push({ id:"punch", name:"拳", baseHit:100, kind:"attack", dmg:2, req:{} });
  }

  // READY表示
  state.enemy.ready = picked.some(x => x.id !== "punch");
  return { spells: picked, manaField };
}

function expectedValue(s){
  const hit = clamp(s.baseHit, 5, 100) / 100;
  if (s.kind === "attack") return hit * (s.dmg||0);
  if (s.kind === "heal") return hit * (s.heal||0) * 0.9; // 回復は少し控えめに評価
  return 0;
}

function canPayReqEnemy(req, manaAvail, manaField){
  for (const [k,v] of Object.entries(req)){
    const have = (manaAvail[k]||0) - (manaField[k]||0);
    if (have < v) return false;
  }
  return true;
}
function payReqEnemy(req, manaAvail, manaField){
  for (const [k,v] of Object.entries(req)){
    manaField[k] += v;
  }
}

// ====== ターン終了処理 ======
function endTurn(){
  updateBars();
  renderSlots();
  renderManaSelected();

  // 勝敗チェック（5ターン制）
  if (state.turn >= state.maxTurn){
    const res =
      state.player.hp > state.enemy.hp ? "勝利" :
      state.player.hp < state.enemy.hp ? "敗北" : "引き分け";
    setTimeout(() => alert(`RESULT: ${res}\nYOU ${state.player.hp} / ENEMY ${state.enemy.hp}`), 50);
    return;
  }

  // 次ターンへ
  state.turn++;
  // 2ターン目以降ドロー
  draw(state.player, 1);
  enemyDraw(1);

  // 表示更新
  renderHand();
  renderManaPool();
  renderManaSelected();
  updateReady();
  updateBars();
}

// ====== 初期化 ======
function init(){
  // 初手7
  draw(state.player, 7);
  enemyDraw(7);

  renderHand();
  renderSlots();
  renderManaPool();
  renderManaSelected();

  // スロットタップで戻す
  $("slot0").addEventListener("click", () => popFromSlot(0));
  $("slot1").addEventListener("click", () => popFromSlot(1));

  // 発動
  $("castBtn").addEventListener("click", () => {
    // 呪文0枚発動は確認（あなたの仕様）
    if (!state.player.slots[0] && !state.player.slots[1]){
      const ok = confirm("呪文0枚です。拳で発動します。よろしいですか。");
      if (!ok) return;
    }
    resolveCast();
  });

  updateReady();
  updateBars();
  setLog("準備してください。\n手札→スロット / 魔素→フィールド\nスロット・魔素はタップで戻せます。");
}

init();
