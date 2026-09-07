const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 4000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (
  !ADMIN_PASSWORD ||
  ADMIN_PASSWORD === "CHANGE_THIS_TO_A_STRONG_PASSWORD"
) {
  console.error(
    "SECURITY: Set ADMIN_PASSWORD in the environment before starting the server."
  );
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "200kb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

/* =========================================================
   FILES
   ========================================================= */

const dataFile = path.join(
  __dirname,
  "..",
  "data",
  "teams.json"
);

const questionsFile = path.join(
  __dirname,
  "..",
  "questions.json"
);

/* =========================================================
   JSON HELPERS
   ========================================================= */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2)
  );
}

/* =========================================================
   DATABASE
   ========================================================= */

const db = readJson(dataFile, {
  teams: [],
});

let questions = readJson(
  questionsFile,
  []
);

/* =========================================================
   SESSIONS
   ========================================================= */

const sessions = new Map();
const loginAttempts = new Map();

/* =========================================================
   GAME STATE
   ========================================================= */

const state = {
  round: 1,
  index: 0,
  phase: "lobby",
  endsAt: null,
};

/* =========================================================
   SECURITY HELPERS
   ========================================================= */

function hashPin(
  pin,
  salt = crypto.randomBytes(16).toString("hex")
) {
  return {
    salt,
    hash: crypto
      .scryptSync(String(pin), salt, 64)
      .toString("hex"),
  };
}

function verifyPin(pin, record) {
  try {
    const hash = crypto
      .scryptSync(
        String(pin),
        record.pinSalt,
        64
      )
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(record.pinHash, "hex")
    );
  } catch {
    return false;
  }
}

function createToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function teamRecord(id) {
  return db.teams.find(
    (team) => team.id === id
  );
}

function publicTeam(team) {
  if (!team) return null;

  return {
    id: team.id,
    name: team.name,
    coins: team.coins,
    violations: team.violations || 0,
    correct: team.correct || 0,
    totalScore: team.totalScore || 0,
  };
}

/* =========================================================
   ROUND HELPERS
   ========================================================= */

function getRoundQuestions(round) {
  return questions.filter(
    (question) => Number(question.round) === Number(round)
  );
}

function currentQuestion() {
  return getRoundQuestions(state.round)[state.index] || null;
}

/* =========================================================
   QUESTION SECURITY
   ========================================================= */

function publicQuestion(question) {
  if (!question) return null;

  return {
    id: question.id,
    round: question.round,
    difficulty: question.difficulty,
    category: question.category,
    challenge: question.challenge,

    // Only prediction is shown.
    // Actual answer is NEVER sent here.
    aiPrediction: question.aiPrediction,
  };
}

/* =========================================================
   SCORE HELPERS
   ========================================================= */

function ensureScoreFields(team) {
  if (!team.roundScores) {
    team.roundScores = {
      "1": 0,
      "2": 0,
      "3": 0,
    };
  }

  if (typeof team.roundScores["1"] !== "number") {
    team.roundScores["1"] = 0;
  }

  if (typeof team.roundScores["2"] !== "number") {
    team.roundScores["2"] = 0;
  }

  if (typeof team.roundScores["3"] !== "number") {
    team.roundScores["3"] = 0;
  }

  if (typeof team.totalScore !== "number") {
    team.totalScore = 0;
  }

  if (typeof team.correct !== "number") {
    team.correct = 0;
  }

  if (typeof team.violations !== "number") {
    team.violations = 0;
  }
}

for (const team of db.teams) {
  ensureScoreFields(team);
}

/* =========================================================
   LEADERBOARD
   ========================================================= */

function leaderboard() {
  return db.teams
    .map((team) => {
      ensureScoreFields(team);

      return {
        id: team.id,
        name: team.name,

        coins: team.coins,

        round1: team.roundScores["1"],
        round2: team.roundScores["2"],
        round3: team.roundScores["3"],

        currentRound:
          team.roundScores[String(state.round)],

        totalScore: team.totalScore,

        correct: team.correct,
        violations: team.violations,
      };
    })
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }

      return b.coins - a.coins;
    })
    .map((team, index) => ({
      rank: index + 1,
      ...team,
    }));
}

/* =========================================================
   ROUND LEADERBOARD
   ========================================================= */

function roundLeaderboard(round) {
  return db.teams
    .map((team) => {
      ensureScoreFields(team);

      return {
        id: team.id,
        name: team.name,

        roundScore:
          team.roundScores[String(round)] || 0,

        totalScore:
          team.totalScore || 0,

        coins:
          team.coins || 0,

        correct:
          team.correct || 0,

        violations:
          team.violations || 0,
      };
    })
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }

      return b.coins - a.coins;
    })
    .map((team, index) => ({
      rank: index + 1,
      ...team,
    }));
}

/* =========================================================
   TEAM STATE
   ========================================================= */

function teamStates() {
  return db.teams.map((team) => ({
    id: team.id,
    name: team.name,
    coins: team.coins,
    locked: !!team.locked,
    correct: team.correct || 0,
    violations: team.violations || 0,
    totalScore: team.totalScore || 0,
  }));
}

/* =========================================================
   SEND GAME STATE
   ========================================================= */

function emitState() {
  const current = currentQuestion();

  io.emit("state", {
    round: state.round,
    index: state.index,

    questionNumber: state.index + 1,

    totalQuestions:
      getRoundQuestions(state.round).length,

    phase: state.phase,

    endsAt: state.endsAt,

    question:
      state.phase === "final"
        ? null
        : publicQuestion(current),

    teams: teamStates(),

    leaderboard: leaderboard(),

    roundLeaderboard:
      roundLeaderboard(state.round),

    leadingTeam:
      leaderboard()[0] || null,
  });
}

/* =========================================================
   RESET QUESTION DATA
   ========================================================= */

function resetQuestionData() {
  for (const team of db.teams) {
    team.prediction = null;
    team.investment = null;
    team.locked = false;
    team.lastResult = null;
  }

  writeJson(dataFile, db);
}

/* =========================================================
   START QUESTION
   ========================================================= */

function startQuestion() {
  const question = currentQuestion();

  if (!question) {
    return;
  }

  resetQuestionData();

  state.phase = "question";

  // EXACTLY 60 SECONDS
  state.endsAt = Date.now() + 60000;

  emitState();

  setTimeout(() => {
    if (state.phase !== "question") {
      return;
    }

    state.phase = "locked";
    state.endsAt = null;

    emitState();
  }, 60000);
}

/* =========================================================
   RATE LIMIT
   ========================================================= */

function rateLimited(ip) {
  const now = Date.now();

  const attempts = (
    loginAttempts.get(ip) || []
  ).filter(
    (time) =>
      now - time < 15 * 60 * 1000
  );

  if (attempts.length >= 8) {
    loginAttempts.set(ip, attempts);
    return true;
  }

  attempts.push(now);

  loginAttempts.set(ip, attempts);

  return false;
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */

function auth(socket, role) {
  const session = sessions.get(
    socket.handshake.auth?.token
  );

  if (
    session &&
    session.role === role
  ) {
    return session;
  }

  return null;
}

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      secureAuth: true,
      gamePhase: state.phase,
      round: state.round,
    });
  }
);

/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

io.on("connection", (socket) => {

  /* =======================================================
     ADMIN LOGIN
     ======================================================= */

  socket.on(
    "adminLogin",
    ({ password }) => {

      if (
        rateLimited(
          socket.handshake.address
        )
      ) {
        return socket.emit(
          "adminAuth",
          {
            ok: false,
            error:
              "Too many login attempts. Try again later.",
          }
        );
      }

      if (
        typeof password !== "string"
      ) {
        return socket.emit(
          "adminAuth",
          {
            ok: false,
            error:
              "Invalid password",
          }
        );
      }

      const supplied =
        crypto
          .createHash("sha256")
          .update(password)
          .digest();

      const expected =
        crypto
          .createHash("sha256")
          .update(ADMIN_PASSWORD)
          .digest();

      if (
        !crypto.timingSafeEqual(
          supplied,
          expected
        )
      ) {
        return socket.emit(
          "adminAuth",
          {
            ok: false,
            error:
              "Invalid password",
          }
        );
      }

      const tok =
        createToken();

      sessions.set(tok, {
        role: "admin",
      });

      socket.emit(
        "adminAuth",
        {
          ok: true,
          token: tok,
        }
      );

      emitState();
    }
  );

  /* =======================================================
     TEAM LOGIN
     ======================================================= */

  socket.on(
    "teamLogin",
    ({ id, pin }) => {

      if (
        rateLimited(
          socket.handshake.address
        )
      ) {
        return socket.emit(
          "teamAuth",
          {
            ok: false,
            error:
              "Too many login attempts. Try again later.",
          }
        );
      }

      const team =
        teamRecord(
          String(id || "")
            .trim()
            .toUpperCase()
        );

      if (
        !team ||
        !verifyPin(
          String(pin || ""),
          team
        )
      ) {
        return socket.emit(
          "teamAuth",
          {
            ok: false,
            error:
              "Invalid Team ID or PIN",
          }
        );
      }

      const tok =
        createToken();

      sessions.set(tok, {
        role: "team",
        teamId: team.id,
      });

      socket.emit(
        "teamAuth",
        {
          ok: true,
          token: tok,
          team: publicTeam(team),
        }
      );

      emitState();
    }
  );

  /* =======================================================
     ADMIN CREATE TEAM
     ======================================================= */

  socket.on(
    "adminCreateTeam",
    ({ token: tok, id, name, pin }) => {

      if (
        !auth(socket, "admin") ||
        !tok
      ) {
        return;
      }

      id = String(id || "")
        .trim()
        .toUpperCase();

      name = String(
        name || id
      ).trim();

      pin = String(pin || "");

      if (
        !/^[A-Z0-9_-]{3,24}$/.test(id) ||
        name.length < 1 ||
        pin.length < 4 ||
        pin.length > 12
      ) {
        return socket.emit(
          "errorMessage",
          "Use a valid Team ID and a 4–12 character PIN."
        );
      }

      if (teamRecord(id)) {
        return socket.emit(
          "errorMessage",
          "Team ID already exists."
        );
      }

      const p =
        hashPin(pin);

      const newTeam = {
        id,
        name,

        coins: 50,

        correct: 0,
        violations: 0,

        roundScores: {
          "1": 0,
          "2": 0,
          "3": 0,
        },

        totalScore: 0,

        pinHash: p.hash,
        pinSalt: p.salt,

        prediction: null,
        investment: null,
        locked: false,

        lastResult: null,
      };

      db.teams.push(newTeam);

      writeJson(
        dataFile,
        db
      );

      emitState();

      socket.emit(
        "teamsUpdated"
      );
    }
  );

  /* =======================================================
     ADMIN DELETE TEAM
     ======================================================= */

  socket.on(
    "adminDeleteTeam",
    ({ token: tok, id }) => {

      if (
        !auth(socket, "admin")
      ) {
        return;
      }

      const index =
        db.teams.findIndex(
          (team) =>
            team.id === id
        );

      if (index < 0) {
        return;
      }

      db.teams.splice(
        index,
        1
      );

      writeJson(
        dataFile,
        db
      );

      emitState();
    }
  );

  /* =======================================================
     ADMIN START QUESTION
     ======================================================= */

  socket.on(
    "adminStart",
    ({ token: tok }) => {

      if (
        !auth(socket, "admin")
      ) {
        return;
      }

      if (
        state.phase === "question"
      ) {
        return;
      }

      startQuestion();
    }
  );

  /* =======================================================
     START NEXT QUESTION
     ======================================================= */

  socket.on(
    "startNext",
    ({ token: tok }) => {

      if (
        !auth(socket, "admin")
      ) {
        return;
      }

      if (
        state.phase !== "ready"
      ) {
        return;
      }

      startQuestion();
    }
  );

  /* =======================================================
     TEAM DECISION
     ======================================================= */

  socket.on(
    "decision",
    ({ token: tok, prediction }) => {

      const session =
        auth(socket, "team");

      if (
        !session ||
        state.phase !== "question"
      ) {
        return;
      }

      if (
        !["RIGHT", "WRONG"].includes(
          prediction
        )
      ) {
        return;
      }

      const team =
        teamRecord(
          session.teamId
        );

      if (
        !team ||
        team.locked ||
        team.prediction
      ) {
        return;
      }

      team.prediction =
        prediction;

      writeJson(
        dataFile,
        db
      );

      socket.emit(
        "decisionSaved",
        {
          prediction,
        }
      );
    }
  );

  /* =======================================================
     INVEST
     ======================================================= */

  socket.on(
    "invest",
    ({ token: tok, amount }) => {

      const session =
        auth(socket, "team");

      if (
        !session ||
        state.phase !== "question"
      ) {
        return;
      }

      const team =
        teamRecord(
          session.teamId
        );

      amount = Number(amount);

      if (
        !team ||
        !team.prediction ||
        team.locked ||
        ![10, 20, 30].includes(amount) ||
        amount > team.coins
      ) {
        return;
      }

      team.investment =
        amount;

      team.coins -= amount;

      team.locked = true;

      writeJson(
        dataFile,
        db
      );

      socket.emit(
        "investmentSaved",
        {
          amount,
          coins: team.coins,
        }
      );

      emitState();
    }
  );

  /* =======================================================
     REVEAL ANSWER
     ======================================================= */

  socket.on(
    "reveal",
    ({ token: tok }) => {

      if (
        !auth(socket, "admin")
      ) {
        return;
      }

      const question =
        currentQuestion();

      if (
        !question ||
        !["question", "locked"].includes(
          state.phase
        )
      ) {
        return;
      }

      /*
       IMPORTANT:
       The AI prediction percentage is compared
       with the actual answer on the SERVER.
      */

      const aiRight =
        String(
          question.aiPrediction
        )
          .trim()
          .toLowerCase() ===
        String(
          question.actualAnswer
        )
          .trim()
          .toLowerCase();

      for (
        const team of db.teams
      ) {

        ensureScoreFields(team);

        if (
          !team.locked ||
          !team.investment ||
          !team.prediction
        ) {
          continue;
        }

        const decisionCorrect =
          (
            team.prediction === "RIGHT"
          ) === aiRight;

        const investment =
          Number(team.investment);

        let scoreChange = 0;

        /*
         Correct:
         Investment is returned
         + same amount as profit.

         Example:
         Invest 20
         → receive 40
         → profit = 20
        */

        if (decisionCorrect) {

          team.coins +=
            investment * 2;

          scoreChange =
            investment;

          team.correct =
            (team.correct || 0) + 1;

        } else {

          /*
           Wrong:
           Investment was already removed.
           No additional coins.
          */

          scoreChange =
            -investment;
        }

        team.roundScores[
          String(state.round)
        ] += scoreChange;

        team.totalScore +=
          scoreChange;

        team.lastResult = {
          aiRight,
          decisionCorrect,
          invested: investment,
          scoreChange,
          actualAnswer:
            question.actualAnswer,
        };
      }

      state.phase =
        "reveal";

      state.endsAt = null;

      writeJson(
        dataFile,
        db
      );

      /*
       Actual answer is now sent only
       after reveal.
      */

      io.emit(
        "answerRevealed",
        {
          answer:
            question.actualAnswer,
        }
      );

      emitState();
    }
  );

  /* =======================================================
     NEXT / LEADERBOARD
     ======================================================= */

  socket.on(
    "next",
    ({ token: tok }) => {

      if (
        !auth(socket, "admin")
      ) {
        return;
      }

      if (
        state.phase !== "reveal"
      ) {
        return;
      }

      const currentRoundQuestions =
        getRoundQuestions(
          state.round
        );

      /*
       If there are more questions
       in this round:
      */

      if (
        state.index <
        currentRoundQuestions.length - 1
      ) {

        state.phase =
          "leaderboard";

        state.endsAt = null;

        emitState();

        return;
      }

      /*
       Current round completed.
      */

      if (
        state.round < 3
      ) {

        state.phase =
          "roundLeaderboard";

        state.endsAt = null;

        emitState();

        return;
      }

      /*
       All 3 rounds completed.
      */

      state.phase =
        "final";

      state.endsAt = null;

      emitState();
    }
  );

  /* =======================================================
     CONTINUE AFTER LEADERBOARD
     ======================================================= */

  socket.on(
    "continueGame",
    ({ token: tok }) => {

      if (
        !auth(socket, "admin")
      ) {
        return;
      }

      /*
       Normal question leaderboard
      */

      if (
        state.phase === "leaderboard"
      ) {

        state.index++;

        state.phase =
          "ready";

        emitState();

        return;
      }

      /*
       Round completed.
      Move to next round.
      */

      if (
        state.phase ===
        "roundLeaderboard"
      ) {

        state.round++;

        state.index = 0;

        state.phase =
          "ready";

        emitState();

        return;
      }
    }
  );

  /* =======================================================
     VIOLATION
     ======================================================= */

  socket.on(
    "violation",
    ({ token: tok, reason }) => {

      const session =
        auth(socket, "team");

      if (!session) {
        return;
      }

      const team =
        teamRecord(
          session.teamId
        );

      if (!team) {
        return;
      }

      team.violations =
        (team.violations || 0) + 1;

      writeJson(
        dataFile,
        db
      );

      io.emit(
        "violation",
        {
          teamId: team.id,
          name: team.name,
          count: team.violations,

          reason: String(
            reason ||
              "Game screen left"
          ).slice(0, 120),
        }
      );

      emitState();
    }
  );

  /* =======================================================
     DISCONNECT
     ======================================================= */

  socket.on(
    "disconnect",
    () => {
      // Session remains valid until server restart.
      // This prevents accidental refresh from
      // destroying the team's login.
    }
  );
});

/* =========================================================
   START SERVER
   ========================================================= */

server.listen(
  PORT,
  () => {
    console.log(
      `Secure server running on http://localhost:${PORT}`
    );

    console.log(
      `Teams loaded: ${db.teams.length}`
    );

    console.log(
      `Questions loaded: ${questions.length}`
    );
  }
);