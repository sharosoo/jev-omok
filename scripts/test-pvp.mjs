const baseUrl = process.env.PVP_BASE_URL ?? "http://localhost:8787";
const wsBase = baseUrl.replace(/^http/, "ws");
let failures = 0;

function check(condition, label, detail = "") {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
}

class TestClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.messages = [];
    this.waiters = [];
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const index = this.waiters.findIndex(({ predicate }) => predicate(message));
      if (index >= 0) {
        const waiter = this.waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), 5_000);
      this.socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("WebSocket failed to open"));
        },
        { once: true },
      );
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  next(predicate, timeoutMs = 5_000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        const pending = this.waiters.indexOf(waiter);
        if (pending >= 0) this.waiters.splice(pending, 1);
        reject(new Error(`Protocol message timed out; buffered=${JSON.stringify(this.messages)}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close(1000, "Test complete");
  }
}

async function testQueue() {
  const queueUrl = `${wsBase}/api/queue/ws`;
  const first = new TestClient(queueUrl);
  await first.open();
  first.send({ t: "hello", v: 1, guestName: "Queue Black" });
  const waiting = await first.next((message) => message.t === "waiting");
  check(waiting.position === 1, "first quick-match player waits at position 1", waiting.position);

  const second = new TestClient(queueUrl);
  await second.open();
  const firstMatchedPromise = first.next((message) => message.t === "matched");
  const secondMatchedPromise = second.next((message) => message.t === "matched");
  second.send({ t: "hello", v: 1, guestName: "Queue White" });
  const [firstMatched, secondMatched] = await Promise.all([
    firstMatchedPromise,
    secondMatchedPromise,
  ]);
  check(
    firstMatched.seat === "black" &&
      secondMatched.seat === "white" &&
      firstMatched.code === secondMatched.code,
    "quick match preserves FIFO seats",
    JSON.stringify({ firstMatched, secondMatched }),
  );
  check(
    typeof firstMatched.ticket === "string" && typeof secondMatched.ticket === "string",
    "quick match issues seat tickets",
  );

  const roomUrl = `${wsBase}/api/rooms/${firstMatched.code}/ws`;
  const reservedBlack = new TestClient(roomUrl);
  await reservedBlack.open();
  reservedBlack.send({
    t: "hello",
    v: 1,
    guestName: "Changed Name",
    resumeKey: firstMatched.ticket,
  });
  const blackWelcome = await reservedBlack.next((message) => message.t === "welcome");

  const reservedWhite = new TestClient(roomUrl);
  await reservedWhite.open();
  reservedWhite.send({
    t: "hello",
    v: 1,
    guestName: "Changed Name",
    resumeKey: secondMatched.ticket,
  });
  const whiteWelcome = await reservedWhite.next((message) => message.t === "welcome");
  check(
    blackWelcome.role === "black" &&
      whiteWelcome.role === "white" &&
      blackWelcome.you.name === "Queue Black" &&
      whiteWelcome.you.name === "Queue White",
    "room consumes tickets and restores reserved guest identities",
    JSON.stringify({ blackWelcome, whiteWelcome }),
  );
  reservedBlack.close();
  reservedWhite.close();
}


async function run() {
  await testQueue();
  const createResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rule: "freestyle" }),
  });
  const created = await createResponse.json();
  check(createResponse.ok && typeof created.code === "string", "private room created");
  if (!createResponse.ok || typeof created.code !== "string") return;

  const wsUrl = `${wsBase}/api/rooms/${created.code}/ws`;
  const black = new TestClient(wsUrl);
  await black.open();
  black.send({ t: "hello", v: 1, guestName: "Black" });
  const blackWelcome = await black.next((message) => message.t === "welcome");
  check(blackWelcome.role === "black", "first client receives black seat", blackWelcome.role);

  const white = new TestClient(wsUrl);
  await white.open();
  white.send({ t: "hello", v: 1, guestName: "White" });
  const whiteWelcome = await white.next((message) => message.t === "welcome");
  check(whiteWelcome.role === "white", "second client receives white seat", whiteWelcome.role);

  white.send({ t: "move", coord: { x: 1, y: 0 }, expectedPly: 0 });
  const outOfTurn = await white.next((message) => message.t === "error");
  check(outOfTurn.code === "not_your_turn", "out-of-turn move is rejected", outOfTurn.code);

  const blackMovePromise = black.next((message) => message.t === "move");
  const whiteMovePromise = white.next((message) => message.t === "move");
  black.send({ t: "move", coord: { x: 0, y: 0 }, expectedPly: 0 });
  const [blackMove, whiteMove] = await Promise.all([blackMovePromise, whiteMovePromise]);
  check(
    blackMove.ply === 1 && blackMove.coord.x === 0 && blackMove.coord.y === 0,
    "black receives authoritative move echo",
    JSON.stringify(blackMove),
  );
  check(
    whiteMove.ply === 1 && whiteMove.by === "black" && whiteMove.coord.x === 0,
    "white receives black move with ply 1",
    JSON.stringify(whiteMove),
  );

  white.send({ t: "move", coord: { x: 2, y: 0 }, expectedPly: 0 });
  const stale = await white.next((message) => message.t === "error");
  check(stale.code === "stale_ply", "stale expectedPly is rejected", stale.code);

  white.send({ t: "move", coord: { x: 0, y: 0 }, expectedPly: 1 });
  const occupied = await white.next((message) => message.t === "error");
  check(occupied.code === "illegal_move", "occupied point is rejected", occupied.code);

  const blackOverPromise = black.next((message) => message.t === "over");
  const whiteOverPromise = white.next((message) => message.t === "over");
  white.send({ t: "resign" });
  const [blackOver, whiteOver] = await Promise.all([blackOverPromise, whiteOverPromise]);
  check(
    blackOver.reason === "resign" && blackOver.winner === "black",
    "resign ends match for black",
    JSON.stringify(blackOver),
  );
  check(
    whiteOver.reason === "resign" && whiteOver.winner === "black",
    "resign ends match for white",
    JSON.stringify(whiteOver),
  );

  const resumeKey = blackWelcome.resumeKey;
  black.close();
  const resumed = new TestClient(wsUrl);
  await resumed.open();
  resumed.send({ t: "hello", v: 1, guestName: "Ignored", resumeKey });
  const resumedWelcome = await resumed.next((message) => message.t === "welcome");
  check(
    resumedWelcome.role === "black" && resumedWelcome.you.id === blackWelcome.you.id,
    "resumeKey restores the original black identity",
    JSON.stringify(resumedWelcome.you),
  );
  check(
    resumedWelcome.snapshot.moves.length === 1 &&
      resumedWelcome.snapshot.winner === "black" &&
      resumedWelcome.snapshot.endReason === "resign",
    "reconnect receives full finished snapshot with match winner",
    JSON.stringify(resumedWelcome.snapshot),
  );

  white.close();
  resumed.close();
}

try {
  await run();
} catch (error) {
  failures += 1;
  console.error(`FAIL unexpected test error: ${error instanceof Error ? error.stack : String(error)}`);
}

if (failures > 0) {
  console.error(`FAILED ${failures} assertion(s)`);
  process.exitCode = 1;
} else {
  console.log("PASS all PvP protocol assertions");
}
