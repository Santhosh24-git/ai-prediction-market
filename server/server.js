const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 4000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/* =========================================================
   SECURITY
   ========================================================= */

if (
  !ADMIN_PASSWORD ||
  ADMIN_PASSWORD === "CHANGE_THIS_TO_A_STRONG_PASSWORD"
) {
  console.error(
    "SECURITY: Set ADMIN_PASSWORD in the environment before starting the server."
  );
  process.exit(1);
}

/* =========================================================
   EXPRESS + SOCKET.IO
   ========================================================= */

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "200kb",
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

/* =========================================================
   FILE PATHS
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
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    console.error(
      `Could not read ${file}:`,
      error.message
    );

    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error(
      `Could not write ${file}:`,
      error.message
    );
  }
}

/* =========================================================
   DATABASE
   ========================================================= */

const db = readJson(
  dataFile,
  {
    teams: [],
  }
);

let questions = readJson(
  questionsFile,
  []
);

if (!Array.isArray(db.teams)) {
  db.teams = [];
}

if (!Array.isArray(questions)) {
  questions = [];
}

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

/*
PHASES:

lobby
question
locked
reveal
leaderboard
roundLeaderboard
ready
final
*/

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
      .scryptSync(
        String(pin),
        salt,
        64
      )
      .toString("hex"),
  };
}

function verifyPin(pin, record) {
  try {
    if (
      !record ||
      !record.pinSalt ||
      !record.pinHash
    ) {
      return false;
    }

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

/* =========================================================
   TEAM HELPERS
   ========================================================= */

function teamRecord(id) {
  return db.teams.find(
    (team) =>
      String(team.id).toUpperCase() ===
      String(id).toUpperCase()
  );
}

function ensureScoreFields(team) {
  if (!team.roundScores) {
    team.roundScores = {
      "1": 0,
      "2": 0,
      "3": 0,
    };
  }

  if (
    typeof team.roundScores["1"] !==
    "number"
  ) {
    team.roundScores["1"] = 0;
  }

  if (
    typeof team.roundScores["2"] !==
    "number"
  ) {
    team.roundScores["2"] = 0;
  }

  if (
    typeof team.roundScores["3"] !==
    "number"
  ) {
    team.roundScores["3"] = 0;
  }

  if (
    typeof team.totalScore !==
    "number"
  ) {
    team.totalScore = 0;
  }

  if (
    typeof team.correct !==
    "number"
  ) {
    team.correct = 0;
  }

  if (
    typeof team.violations !==
    "number"
  ) {
    team.violations = 0;
  }

  if (
    typeof team.coins !==
    "number"
  ) {
    team.coins = 50;
  }

  if (!("prediction" in team)) {
    team.prediction = null;
  }

  if (!("investment" in team)) {
    team.investment = null;
  }

  if (!("locked" in team)) {
    team.locked = false;
  }

  if (!("lastResult" in team)) {
    team.lastResult = null;
  }
}

/* =========================================================
   FIX EXISTING DATA
   ========================================================= */

for (const team of db.teams) {
  ensureScoreFields(team);
}

writeJson(dataFile, db);

/* =========================================================
   PUBLIC TEAM
   ========================================================= */

function publicTeam(team) {
  if (!team) {
    return null;
  }

  ensureScoreFields(team);

  return {
    id: team.id,
    name: team.name,
    coins: team.coins,

    correct: team.correct,
    violations: team.violations,
    totalScore: team.totalScore,

    roundScores: {
      "1": team.roundScores["1"],
      "2": team.roundScores["2"],
      "3": team.roundScores["3"],
    },

    prediction: team.prediction || null,
    investment: team.investment || null,
    locked: !!team.locked,

    lastResult:
      team.lastResult || null,
  };
}

/* =========================================================
   QUESTIONS
   ========================================================= */

function getRoundQuestions(round) {
  return questions.filter(
    (question) =>
      Number(question.round) ===
      Number(round)
  );
}

function currentQuestion() {
  const roundQuestions =
    getRoundQuestions(state.round);

  return (
    roundQuestions[state.index] ||
    null
  );
}

/* =========================================================
   PUBLIC QUESTION
   ========================================================= */

function publicQuestion(question) {
  if (!question) {
    return null;
  }

  return {
    id: question.id,

    round: question.round,

    difficulty:
      question.difficulty,

    category:
      question.category,

    challenge:
      question.challenge,

    aiPrediction:
      question.aiPrediction,
  };
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

        round1:
          team.roundScores["1"],

        round2:
          team.roundScores["2"],

        round3:
          team.roundScores["3"],

        currentRound:
          team.roundScores[
            String(state.round)
          ],

        totalScore:
          team.totalScore,

        correct:
          team.correct,

        violations:
          team.violations,

        coins:
          team.coins,
      };
    })
    .sort((a, b) => {
      if (
        b.totalScore !==
        a.totalScore
      ) {
        return (
          b.totalScore -
          a.totalScore
        );
      }

      return (
        b.coins -
        a.coins
      );
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
          team.roundScores[
            String(round)
          ] || 0,

        totalScore:
          team.totalScore || 0,

        correct:
          team.correct || 0,

        violations:
          team.violations || 0,

        coins:
          team.coins || 0,
      };
    })
    .sort((a, b) => {
      if (
        b.totalScore !==
        a.totalScore
      ) {
        return (
          b.totalScore -
          a.totalScore
        );
      }

      return (
        b.coins -
        a.coins
      );
    })
    .map((team, index) => ({
      rank: index + 1,
      ...team,
    }));
}

/* =========================================================
   ADMIN TEAM STATE
   ========================================================= */

function teamStates() {
  return db.teams.map((team) => {
    ensureScoreFields(team);

    return {
      id: team.id,
      name: team.name,
      coins: team.coins,

      locked:
        !!team.locked,

      prediction:
        team.prediction || null,

      investment:
        team.investment || null,

      correct:
        team.correct,

      violations:
        team.violations,

      totalScore:
        team.totalScore,
    };
  });
}

/* =========================================================
   TEAM PRIVATE STATE
   ========================================================= */

function teamVisibleState(team) {
  if (!team) {
    return null;
  }

  ensureScoreFields(team);

  return {
    id: team.id,
    name: team.name,
    coins: team.coins,

    correct:
      team.correct,

    violations:
      team.violations,

    totalScore:
      team.totalScore,

    roundScores: {
      "1":
        team.roundScores["1"],

      "2":
        team.roundScores["2"],

      "3":
        team.roundScores["3"],
    },

    prediction:
      team.prediction || null,

    investment:
      team.investment || null,

    locked:
      !!team.locked,

    lastResult:
      team.lastResult || null,
  };
}

/* =========================================================
   GAME STATE
   ========================================================= */

function buildGameState() {
  const question =
    currentQuestion();

  return {
    round:
      state.round,

    index:
      state.index,

    questionNumber:
      state.index + 1,

    totalQuestions:
      getRoundQuestions(
        state.round
      ).length,

    phase:
      state.phase,

    endsAt:
      state.endsAt,

    question:
      state.phase === "final"
        ? null
        : publicQuestion(
            question
          ),

    leaderboard:
      leaderboard(),

    roundLeaderboard:
      roundLeaderboard(
        state.round
      ),

    leadingTeam:
      leaderboard()[0] ||
      null,
  };
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */

/*
IMPORTANT FIX:

The session is stored both:

1. In sessions Map
2. In socket.data.session

This means the server can authenticate
admin/team controls even when the frontend
does not send the token correctly.
*/

function auth(
  socket,
  role,
  suppliedToken
) {
  let session = null;

  if (suppliedToken) {
    session =
      sessions.get(
        suppliedToken
      );
  }

  if (!session) {
    session =
      socket.data.session;
  }

  if (!session) {
    const socketToken =
      socket.handshake.auth?.token;

    if (socketToken) {
      session =
        sessions.get(
          socketToken
        );
    }
  }

  if (
    !session ||
    session.role !== role
  ) {
    return null;
  }

  return session;
}

/* =========================================================
   SEND ADMIN STATE
   ========================================================= */

function emitAdminState(socket) {
  socket.emit(
    "state",
    {
      ...buildGameState(),

      teams:
        teamStates(),
    }
  );
}

/* =========================================================
   SEND TEAM STATE
   ========================================================= */

function emitTeamState(
  socket,
  team
) {
  socket.emit(
    "state",
    {
      ...buildGameState(),

      team:
        teamVisibleState(
          team
        ),
    }
  );
}

/* =========================================================
   BROADCAST STATE
   ========================================================= */

function emitState() {
  const gameState =
    buildGameState();

  for (
    const socket of
    io.sockets.sockets.values()
  ) {
    const session =
      socket.data.session;

    if (!session) {
      continue;
    }

    if (
      session.role ===
      "admin"
    ) {
      socket.emit(
        "state",
        {
          ...gameState,

          teams:
            teamStates(),
        }
      );

      continue;
    }

    if (
      session.role ===
      "team"
    ) {
      const team =
        teamRecord(
          session.teamId
        );

      if (team) {
        socket.emit(
          "state",
          {
            ...gameState,

            team:
              teamVisibleState(
                team
              ),
          }
        );
      }
    }
  }
}

/* =========================================================
   RESET QUESTION DATA
   ========================================================= */

function resetQuestionData() {
  for (
    const team of
    db.teams
  ) {
    team.prediction = null;
    team.investment = null;
    team.locked = false;
    team.lastResult = null;
  }

  writeJson(
    dataFile,
    db
  );
}

/* =========================================================
   START QUESTION
   ========================================================= */

function startQuestion() {
  const question =
    currentQuestion();

  if (!question) {
    console.error(
      `No question found for Round ${state.round}, Question ${state.index + 1}`
    );

    return false;
  }

  resetQuestionData();

  state.phase =
    "question";

  state.endsAt =
    Date.now() + 60000;

  console.log(
    `GAME STARTED -> Round ${state.round}, Question ${state.index + 1}`
  );

  emitState();

  setTimeout(() => {
    if (
      state.phase !==
      "question"
    ) {
      return;
    }

    state.phase =
      "locked";

    state.endsAt =
      null;

    console.log(
      `TIME UP -> Round ${state.round}, Question ${state.index + 1}`
    );

    emitState();
  }, 60000);

  return true;
}

/* =========================================================
   LOGIN RATE LIMIT
   ========================================================= */

function rateLimited(ip) {
  const now =
    Date.now();

  const attempts =
    (
      loginAttempts.get(ip) ||
      []
    ).filter(
      (time) =>
        now - time <
        15 * 60 * 1000
    );

  if (
    attempts.length >=
    8
  ) {
    loginAttempts.set(
      ip,
      attempts
    );

    return true;
  }

  attempts.push(now);

  loginAttempts.set(
    ip,
    attempts
  );

  return false;
}

/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      secureAuth: true,

      gamePhase:
        state.phase,

      round:
        state.round,

      question:
        state.index + 1,

      totalQuestions:
        getRoundQuestions(
          state.round
        ).length,
    });
  }
);

/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

io.on(
  "connection",
  (socket) => {
    console.log(
      "Client connected:",
      socket.id
    );

    /* =====================================================
       ADMIN LOGIN
       ===================================================== */

    socket.on(
      "adminLogin",
      ({ password } = {}) => {
        const ip =
          socket.handshake.address;

        if (
          rateLimited(ip)
        ) {
          socket.emit(
            "adminAuth",
            {
              ok: false,
              error:
                "Too many login attempts. Try again later.",
            }
          );

          return;
        }

        if (
          typeof password !==
          "string"
        ) {
          socket.emit(
            "adminAuth",
            {
              ok: false,
              error:
                "Invalid password",
            }
          );

          return;
        }

        const supplied =
          crypto
            .createHash(
              "sha256"
            )
            .update(password)
            .digest();

        const expected =
          crypto
            .createHash(
              "sha256"
            )
            .update(
              ADMIN_PASSWORD
            )
            .digest();

        if (
          !crypto.timingSafeEqual(
            supplied,
            expected
          )
        ) {
          socket.emit(
            "adminAuth",
            {
              ok: false,
              error:
                "Invalid password",
            }
          );

          return;
        }

        const token =
          createToken();

        const session = {
          role: "admin",
        };

        sessions.set(
          token,
          session
        );

        /*
          IMPORTANT:
          Store session directly on socket.
        */

        socket.data.session =
          session;

        socket.data.token =
          token;

        socket.emit(
          "adminAuth",
          {
            ok: true,
            token,
          }
        );

        console.log(
          "ADMIN LOGGED IN:",
          socket.id
        );

        emitAdminState(
          socket
        );
      }
    );

    /* =====================================================
       TEAM LOGIN
       ===================================================== */

    socket.on(
      "teamLogin",
      ({ id, pin } = {}) => {
        const ip =
          socket.handshake.address;

        if (
          rateLimited(ip)
        ) {
          socket.emit(
            "teamAuth",
            {
              ok: false,
              error:
                "Too many login attempts. Try again later.",
            }
          );

          return;
        }

        const teamId =
          String(id || "")
            .trim()
            .toUpperCase();

        const team =
          teamRecord(teamId);

        if (
          !team ||
          !verifyPin(
            String(pin || ""),
            team
          )
        ) {
          socket.emit(
            "teamAuth",
            {
              ok: false,
              error:
                "Invalid Team ID or PIN",
            }
          );

          return;
        }

        const token =
          createToken();

        const session = {
          role: "team",
          teamId: team.id,
        };

        sessions.set(
          token,
          session
        );

        socket.data.session =
          session;

        socket.data.token =
          token;

        socket.emit(
          "teamAuth",
          {
            ok: true,
            token,

            team:
              publicTeam(
                team
              ),
          }
        );

        console.log(
          `TEAM LOGGED IN: ${team.name}`
        );

        /*
          IMPORTANT:
          Immediately send the current
          game state to the student.

          So if the game is already running,
          the student sees it immediately.
        */

        emitTeamState(
          socket,
          team
        );
      }
    );

    /* =====================================================
       ADMIN CREATE TEAM
       ===================================================== */

    socket.on(
      "adminCreateTeam",
      ({
        token,
        id,
        name,
        pin,
      } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        id =
          String(id || "")
            .trim()
            .toUpperCase();

        name =
          String(
            name || id
          ).trim();

        pin =
          String(pin || "");

        if (
          !/^[A-Z0-9_-]{3,24}$/.test(
            id
          ) ||
          name.length < 1 ||
          pin.length < 4 ||
          pin.length > 12
        ) {
          socket.emit(
            "errorMessage",
            "Use a valid Team ID and a 4–12 character PIN."
          );

          return;
        }

        if (
          teamRecord(id)
        ) {
          socket.emit(
            "errorMessage",
            "Team ID already exists."
          );

          return;
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

          pinHash:
            p.hash,

          pinSalt:
            p.salt,

          prediction: null,
          investment: null,
          locked: false,
          lastResult: null,
        };

        db.teams.push(
          newTeam
        );

        writeJson(
          dataFile,
          db
        );

        console.log(
          `TEAM CREATED: ${id}`
        );

        socket.emit(
          "teamsUpdated"
        );

        emitState();
      }
    );

    /* =====================================================
       ADMIN DELETE TEAM
       ===================================================== */

    socket.on(
      "adminDeleteTeam",
      ({
        token,
        id,
      } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
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

    /* =====================================================
       START QUESTION
       ===================================================== */

    socket.on(
      "adminStart",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          console.log(
            "Unauthorized adminStart"
          );

          return;
        }

        if (
          state.phase !==
            "lobby" &&
          state.phase !==
            "ready"
        ) {
          return;
        }

        startQuestion();
      }
    );

    /*
      Compatibility:
      Some versions of your frontend
      may use "startNext".
    */

    socket.on(
      "startNext",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        /*
          If already ready,
          simply start.
        */

        if (
          state.phase ===
          "ready"
        ) {
          startQuestion();
          return;
        }

        /*
          If leaderboard is being shown,
          move to next question and start.
        */

        if (
          state.phase ===
          "leaderboard"
        ) {
          state.index++;

          state.phase =
            "ready";

          state.endsAt =
            null;

          emitState();

          setTimeout(() => {
            startQuestion();
          }, 300);

          return;
        }

        /*
          If round leaderboard is shown,
          move to next round.
        */

        if (
          state.phase ===
          "roundLeaderboard"
        ) {
          state.round++;

          state.index = 0;

          state.phase =
            "ready";

          state.endsAt =
            null;

          emitState();

          setTimeout(() => {
            startQuestion();
          }, 300);

          return;
        }
      }
    );

    /* =====================================================
       TEAM DECISION
       ===================================================== */

    socket.on(
      "decision",
      ({
        token,
        prediction,
      } = {}) => {
        const session =
          auth(
            socket,
            "team",
            token
          );

        if (!session) {
          return;
        }

        if (
          state.phase !==
          "question"
        ) {
          return;
        }

        if (
          ![
            "RIGHT",
            "WRONG",
          ].includes(
            prediction
          )
        ) {
          return;
        }

        const team =
          teamRecord(
            session.teamId
          );

        if (!team) {
          return;
        }

        if (
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

        emitState();
      }
    );

    /* =====================================================
       INVEST
       ===================================================== */

    socket.on(
      "invest",
      ({
        token,
        amount,
      } = {}) => {
        const session =
          auth(
            socket,
            "team",
            token
          );

        if (!session) {
          return;
        }

        if (
          state.phase !==
          "question"
        ) {
          return;
        }

        const team =
          teamRecord(
            session.teamId
          );

        if (!team) {
          return;
        }

        const investment =
          Number(amount);

        if (
          !team.prediction
        ) {
          return;
        }

        if (
          team.locked
        ) {
          return;
        }

        if (
          ![
            10,
            20,
            30,
          ].includes(
            investment
          )
        ) {
          return;
        }

        if (
          investment >
          team.coins
        ) {
          socket.emit(
            "errorMessage",
            "Not enough coins."
          );

          return;
        }

        team.investment =
          investment;

        team.coins -=
          investment;

        team.locked =
          true;

        writeJson(
          dataFile,
          db
        );

        socket.emit(
          "investmentSaved",
          {
            amount:
              investment,

            coins:
              team.coins,
          }
        );

        console.log(
          `${team.name} invested ${investment} coins`
        );

        emitState();
      }
    );

    /* =====================================================
       REVEAL ANSWER
       ===================================================== */

    socket.on(
      "reveal",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        const question =
          currentQuestion();

        if (!question) {
          return;
        }

        if (
          ![
            "question",
            "locked",
          ].includes(
            state.phase
          )
        ) {
          return;
        }

        /*
          Compare AI prediction with
          actual answer on SERVER.
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

        console.log(
          `REVEAL -> AI: ${question.aiPrediction} | ACTUAL: ${question.actualAnswer}`
        );

        for (
          const team of
          db.teams
        ) {
          ensureScoreFields(
            team
          );

          if (
            !team.locked ||
            !team.investment ||
            !team.prediction
          ) {
            continue;
          }

          const decisionCorrect =
            (
              team.prediction ===
              "RIGHT"
            ) === aiRight;

          const investment =
            Number(
              team.investment
            );

          let scoreChange =
            0;

          if (
            decisionCorrect
          ) {
            /*
              Example:

              Invest 20
              Receive 40
              Net profit = +20
            */

            team.coins +=
              investment * 2;

            scoreChange =
              investment;

            team.correct =
              (team.correct || 0) +
              1;
          } else {
            /*
              Investment already removed.
              No coins returned.
            */

            scoreChange =
              -investment;
          }

          team.roundScores[
            String(
              state.round
            )
          ] += scoreChange;

          team.totalScore +=
            scoreChange;

          team.lastResult = {
            aiRight,

            decisionCorrect,

            invested:
              investment,

            scoreChange,

            prediction:
              team.prediction,

            actualAnswer:
              question.actualAnswer,
          };
        }

        state.phase =
          "reveal";

        state.endsAt =
          null;

        writeJson(
          dataFile,
          db
        );

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

    /* =====================================================
       LEADERBOARD BUTTON
       ===================================================== */

    socket.on(
      "leaderboard",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        if (
          state.phase !==
            "reveal" &&
          state.phase !==
            "locked"
        ) {
          return;
        }

        const roundQuestions =
          getRoundQuestions(
            state.round
          );

        /*
          If last question of round:
          show round leaderboard.
        */

        if (
          state.index >=
          roundQuestions.length - 1
        ) {
          state.phase =
            state.round < 3
              ? "roundLeaderboard"
              : "final";
        } else {
          state.phase =
            "leaderboard";
        }

        state.endsAt =
          null;

        emitState();
      }
    );

    /*
      Compatibility:
      Your current frontend may send "next"
      when Leaderboard is clicked.
    */

    socket.on(
      "next",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        if (
          state.phase !==
          "reveal"
        ) {
          return;
        }

        const roundQuestions =
          getRoundQuestions(
            state.round
          );

        if (
          state.index <
          roundQuestions.length - 1
        ) {
          state.phase =
            "leaderboard";
        } else if (
          state.round < 3
        ) {
          state.phase =
            "roundLeaderboard";
        } else {
          state.phase =
            "final";
        }

        state.endsAt =
          null;

        emitState();
      }
    );

    /* =====================================================
       NEXT QUESTION
       ===================================================== */

    socket.on(
      "nextQuestion",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        /*
          From normal leaderboard
        */

        if (
          state.phase ===
          "leaderboard"
        ) {
          state.index++;

          state.phase =
            "ready";

          state.endsAt =
            null;

          emitState();

          setTimeout(() => {
            startQuestion();
          }, 300);

          return;
        }

        /*
          From round leaderboard
        */

        if (
          state.phase ===
          "roundLeaderboard"
        ) {
          if (
            state.round >= 3
          ) {
            state.phase =
              "final";

            emitState();

            return;
          }

          state.round++;

          state.index = 0;

          state.phase =
            "ready";

          state.endsAt =
            null;

          emitState();

          setTimeout(() => {
            startQuestion();
          }, 300);

          return;
        }
      }
    );

    /*
      Compatibility with frontend
      that uses "continueGame".
    */

    socket.on(
      "continueGame",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (!admin) {
          return;
        }

        if (
          state.phase ===
          "leaderboard"
        ) {
          state.index++;

          state.phase =
            "ready";

          state.endsAt =
            null;

          emitState();

          setTimeout(() => {
            startQuestion();
          }, 300);

          return;
        }

        if (
          state.phase ===
          "roundLeaderboard"
        ) {
          state.round++;

          state.index = 0;

          state.phase =
            "ready";

          state.endsAt =
            null;

          emitState();

          setTimeout(() => {
            startQuestion();
          }, 300);

          return;
        }
      }
    );

    /* =====================================================
       VIOLATION
       ===================================================== */

    socket.on(
      "violation",
      ({
        token,
        reason,
      } = {}) => {
        const session =
          auth(
            socket,
            "team",
            token
          );

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
          (team.violations || 0) +
          1;

        writeJson(
          dataFile,
          db
        );

        io.emit(
          "violation",
          {
            teamId:
              team.id,

            name:
              team.name,

            count:
              team.violations,

            reason:
              String(
                reason ||
                  "Game screen left"
              ).slice(
                0,
                120
              ),
          }
        );

        emitState();
      }
    );

    /* =====================================================
       REQUEST STATE
       ===================================================== */

    socket.on(
      "requestState",
      ({ token } = {}) => {
        const admin =
          auth(
            socket,
            "admin",
            token
          );

        if (admin) {
          emitAdminState(
            socket
          );

          return;
        }

        const teamSession =
          auth(
            socket,
            "team",
            token
          );

        if (
          teamSession
        ) {
          const team =
            teamRecord(
              teamSession.teamId
            );

          if (team) {
            emitTeamState(
              socket,
              team
            );
          }
        }
      }
    );

    /* =====================================================
       DISCONNECT
       ===================================================== */

    socket.on(
      "disconnect",
      () => {
        console.log(
          "Client disconnected:",
          socket.id
        );
      }
    );
  }
);

/* =========================================================
   SERVER START
   ========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "   AI PREDICTION MARKET - SERVER"
    );
    console.log(
      "=========================================="
    );
    console.log("");

    console.log(
      `Server: http://localhost:${PORT}`
    );

    console.log(
      `Network: http://0.0.0.0:${PORT}`
    );

    console.log(
      `Teams loaded: ${db.teams.length}`
    );

    console.log(
      `Questions loaded: ${questions.length}`
    );

    console.log(
      `Round 1 questions: ${getRoundQuestions(1).length}`
    );

    console.log(
      `Round 2 questions: ${getRoundQuestions(2).length}`
    );

    console.log(
      `Round 3 questions: ${getRoundQuestions(3).length}`
    );

    console.log(
      `Game phase: ${state.phase}`
    );

    console.log(
      `Current round: ${state.round}`
    );

    console.log("");

    console.log(
      "Waiting for Admin / Team login..."
    );

    console.log("");
  }
);