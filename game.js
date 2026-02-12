// ===== 基本状態 =====

const state = {
  turn: 1,
  maxTurn: 5,
  player: {
    hp: 50,
    mana: { fire: 3, water: 3, earth: 3, light: 3, dark: 3 },
    hand: [],
    field: []
  },
  enemy: {
    hp: 50,
    mana: { fire: 3, water: 3, earth: 3, light: 3, dark: 3 }
  }
};

// ===== 呪文定義（最小版） =====

const spells = [
  { name: "ファイア", hit: 100, damage: 5, req: { fire: 1 } },
  { name: "ウォーター", hit: 100, damage: 5, req: { water: 1 } },
  { name: "ストーン", hit: 100, damage: 5, req: { earth: 1 } },
  { name: "ヒール", hit: 75, heal: 9, req: { light: 2 } }
];

// ===== 初期手札 =====

function drawInitial() {
  for (let i = 0; i < 7; i++) {
    const card = spells[Math.floor(Math.random() * spells.length)];
    state.player.hand.push(card);
  }
}

// ===== UI更新 =====

function render() {
  document.getElementById("playerHP").textContent = state.player.hp;
  document.getElementById("enemyHP").textContent = state.enemy.hp;

  const handDiv = document.getElementById("hand");
  handDiv.innerHTML = "";

  state.player.hand.forEach((card, index) => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = card.name;
    div.onclick = () => playCard(index);
    handDiv.appendChild(div);
  });

  const slots = document.getElementById("spellSlots");
  slots.innerHTML = "";
  state.player.field.forEach(card => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = card.name;
    slots.appendChild(div);
  });
}

// ===== カード使用 =====

function playCard(index) {
  if (state.player.field.length >= 2) return;
  const card = state.player.hand.splice(index, 1)[0];
  state.player.field.push(card);
  render();
}

// ===== 発動 =====

function cast() {
  resolveTurn();
  nextTurn();
  render();
}

document.getElementById("castBtn").onclick = cast;

// ===== 解決 =====

function resolveTurn() {
  let totalDamage = 0;
  let totalHeal = 0;

  state.player.field.forEach(card => {
    if (Math.random() * 100 <= card.hit) {
      if (card.damage) totalDamage += card.damage;
      if (card.heal) totalHeal += card.heal;
    }
  });

  state.enemy.hp -= totalDamage;
  state.player.hp += totalHeal;

  // 簡易AI（ランダム攻撃）
  if (Math.random() < 0.8) {
    state.player.hp -= 5;
  }

  state.player.field = [];
}

// ===== 次ターン =====

function nextTurn() {
  state.turn++;
  if (state.turn > state.maxTurn) {
    endGame();
    return;
  }

  const card = spells[Math.floor(Math.random() * spells.length)];
  state.player.hand.push(card);
}

// ===== 終了 =====

function endGame() {
  if (state.player.hp > state.enemy.hp) {
    alert("勝ち！");
  } else {
    alert("負け！");
  }
  location.reload();
}

// ===== 初期化 =====

drawInitial();
render();
