const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

// ===============================
// LOAD QUESTIONS
// ===============================

const questionsPath = path.join(__dirname, "questions.json");

let questions = [];

try {
  questions = JSON.parse(
    fs.readFileSync(questionsPath, "utf8")
  );

  if (!Array.isArray(questions)) {
    questions = [];
  }
} catch (error) {
  console.error("Error loading questions.json:", error);
  questions = [];
}

console.log("Questions loaded:", questions.length);

// ===============================
// ADMIN
// ===============================

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "admin123";

let adminToken = null;

// ===============================
// TEAMS DATABASE
// ===============================

const teamsPath = path.join(
  __dirname,
  "data",
  "teams.json"
);

let teams = [];

try {
  const dataFolder = path.dirname(teamsPath);

  if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
  }

  if (fs.existsSync(teamsPath)) {
    teams = JSON.parse(
      fs.readFileSync(teamsPath, "utf8")
    );
  }

  if (!Array.isArray(teams)) {
    teams = [];
  }
} catch (error) {
  console.error("Error loading teams.json:", error);
  teams = [];
}

console.log("Teams loaded:", teams.length);

// ===============================
// SAVE TEAMS
// ===============================

function saveTeams() {
  try {
    fs.writeFileSync(
      teamsPath,
      JSON.stringify(teams, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Error saving teams.json:", error);
  }
}

// ===============================
// PASSWORD SECURITY
// ===============================

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

// ===============================
// GAME STATE
// ===============================

let game = {
  round: 1,
  index: 0,
  phase: "lobby",
  question: null,
  endsAt: null,
  revealedAnswer: null,
};

const investments = new Map();
const decisions = new Map();

// ===============================
// ROUND CALCULATION
// ROUND 1 = 5 QUESTIONS
// ROUND 2 = 7 QUESTIONS
// ROUND 3 = 10 QUESTIONS
// ===============================

function getRoundFromIndex(index) {
  if (index < 5) {
    return 1;
  }

  if (index < 12) {
    return 2;
  }

  return 3;
}

// ===============================
// PUBLIC QUESTION
// IMPORTANT:
// DO NOT SEND THE ANSWER BEFORE REVEAL
// ===============================

function getPublicQuestion() {
  if (!game.question) {
    return null;
  }

  const publicQuestion = {
    ...game.question,
  };

  delete publicQuestion.actualAnswer;
  delete publicQuestion.correctPrediction;
  delete publicQuestion.answer;

  if (game.phase === "reveal") {
    const correctAnswer =
      game.question.actualAnswer ??
      game.question.correctPrediction ??
      game.question.answer ??
      null;

    publicQuestion.actualAnswer = correctAnswer;
  }

  return publicQuestion;
}

// ===============================
// LEADERBOARD
// ===============================

function getLeaderboard() {
  return [...teams]
    .sort((a, b) => b.coins - a.coins)
    .map((team) => ({
      name: team.name,
      coins: team.coins,
      correct: team.correct || 0,
      violations: team.violations || 0,
      disqualified: team.disqualified || false,
    }));
}

// ===============================
// PUBLIC GAME STATE
// ===============================

function getPublicState() {
  return {
    round: game.round,
    index: game.index,
    phase: game.phase,
    question: getPublicQuestion(),
    endsAt: game.endsAt,

    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      coins: team.coins,
      locked: team.locked,
      disqualified: team.disqualified || false,
    })),

    leaderboard: getLeaderboard(),
  };
}

// ===============================
// BROADCAST
// ===============================

function broadcastState() {
  io.emit("state", getPublicState());
}

// ===============================
// SOCKET CONNECTION
// ===============================

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("state", getPublicState());

  // =============================
  // TEAM REGISTER
  // =============================

  socket.on(
    "teamRegister",
    ({ name, password }) => {
      name = String(name || "").trim();
      password = String(password || "");

      if (name.length < 3) {
        socket.emit("teamRegisterResult", {
          ok: false,
          error:
            "Team name must be at least 3 characters",
        });
        return;
      }

      if (password.length < 4) {
        socket.emit("teamRegisterResult", {
          ok: false,
          error:
            "Password must be at least 4 characters",
        });
        return;
      }

      const exists = teams.some(
        (team) =>
          String(team.name).toLowerCase() ===
          name.toLowerCase()
      );

      if (exists) {
        socket.emit("teamRegisterResult", {
          ok: false,
          error: "Team name already exists",
        });
        return;
      }

      const newTeam = {
        id: name,
        name: name,
        passwordHash: hashPassword(password),

        coins: 50,
        correct: 0,
        violations: 0,

        locked: false,
        disqualified: false,
      };

      teams.push(newTeam);

      saveTeams();

      console.log(
        "New team registered:",
        name
      );

      socket.emit("teamRegisterResult", {
        ok: true,
        team: {
          id: newTeam.id,
          name: newTeam.name,
          coins: newTeam.coins,
        },
      });

      broadcastState();
    }
  );

  // =============================
  // TEAM LOGIN
  // Supports:
  // NEW: { name, password }
  // OLD: { id, pin }
  // =============================

  socket.on(
    "teamLogin",
    ({ name, password, id, pin }) => {
      const loginName =
        String(name ?? id ?? "").trim();

      const loginPassword =
        String(password ?? pin ?? "");

      const team = teams.find(
        (t) =>
          String(t.name).toLowerCase() ===
          loginName.toLowerCase()
      );

      if (!team) {
        socket.emit("teamAuth", {
          ok: false,
          error: "Invalid Team Name or Password",
        });
        return;
      }

      // Disqualified team cannot login
      if (team.disqualified) {
        socket.emit("teamAuth", {
          ok: false,
          error:
            "This team has been disqualified",
        });
        return;
      }

      let validPassword = false;

      // New registered teams
      if (team.passwordHash) {
        validPassword = verifyPassword(
          loginPassword,
          team.passwordHash
        );
      }

      // Backward compatibility with old teams
      if (
        !validPassword &&
        team.pin !== undefined
      ) {
        validPassword =
          String(team.pin) === loginPassword;
      }

      if (!validPassword) {
        socket.emit("teamAuth", {
          ok: false,
          error: "Invalid Team Name or Password",
        });
        return;
      }

      const token =
        "team_" +
        crypto.randomBytes(16).toString("hex");

      socket.teamToken = token;
      socket.teamId = team.id;

      socket.emit("teamAuth", {
        ok: true,
        token,

        team: {
          id: team.id,
          name: team.name,
          coins: team.coins,
        },
      });

      console.log(
        "Team logged in:",
        team.name
      );
    }
  );

  // =============================
  // ADMIN LOGIN
  // =============================

  socket.on(
    "adminLogin",
    ({ password }) => {
      if (password !== ADMIN_PASSWORD) {
        socket.emit("adminAuth", {
          ok: false,
          error:
            "Incorrect admin password",
        });
        return;
      }

      adminToken =
        "admin_" +
        crypto.randomBytes(16).toString("hex");

      socket.adminToken = adminToken;

      socket.emit("adminAuth", {
        ok: true,
        token: adminToken,
      });

      console.log(
        "Admin logged in:",
        socket.id
      );
    }
  );

  // =============================
  // TEAM DECISION
  // =============================

  socket.on(
    "decision",
    ({ token, prediction }) => {
      if (
        !socket.teamToken ||
        socket.teamToken !== token
      ) {
        socket.emit(
          "errorMessage",
          "Invalid team session"
        );
        return;
      }

      const team = teams.find(
        (t) => t.id === socket.teamId
      );

      if (!team) {
        socket.emit(
          "errorMessage",
          "Team not found"
        );
        return;
      }

      if (team.disqualified) {
        socket.emit(
          "errorMessage",
          "Team is disqualified"
        );
        return;
      }

      if (game.phase !== "question") {
        socket.emit(
          "errorMessage",
          "Question is not active"
        );
        return;
      }

      if (
        prediction !== "RIGHT" &&
        prediction !== "WRONG"
      ) {
        socket.emit(
          "errorMessage",
          "Invalid prediction"
        );
        return;
      }

      decisions.set(
        team.id,
        prediction
      );

      socket.emit("decisionSaved", {
        prediction,
      });
    }
  );

  // =============================
  // INVEST
  // =============================

  socket.on(
    "invest",
    ({ token, amount }) => {
      if (
        !socket.teamToken ||
        socket.teamToken !== token
      ) {
        socket.emit(
          "errorMessage",
          "Invalid team session"
        );
        return;
      }

      if (game.phase !== "question") {
        socket.emit(
          "errorMessage",
          "Investment closed"
        );
        return;
      }

      const team = teams.find(
        (t) => t.id === socket.teamId
      );

      if (!team) {
        socket.emit(
          "errorMessage",
          "Team not found"
        );
        return;
      }

      if (team.disqualified) {
        socket.emit(
          "errorMessage",
          "Team is disqualified"
        );
        return;
      }

      if (!decisions.has(team.id)) {
        socket.emit(
          "errorMessage",
          "Choose RIGHT or WRONG first"
        );
        return;
      }

      amount = Number(amount);

      if (![10, 20, 30].includes(amount)) {
        socket.emit(
          "errorMessage",
          "Invalid investment amount"
        );
        return;
      }

      if (team.coins < amount) {
        socket.emit(
          "errorMessage",
          "Not enough coins"
        );
        return;
      }

      if (investments.has(team.id)) {
        socket.emit(
          "errorMessage",
          "Investment already locked"
        );
        return;
      }

      team.coins -= amount;
      team.locked = true;

      investments.set(team.id, {
        amount,
        prediction: decisions.get(team.id),
        questionIndex: game.index,
      });

      saveTeams();

      socket.emit("investmentSaved", {
        amount,
        coins: team.coins,
      });

      broadcastState();
    }
  );

  // =============================
  // VIOLATION
  // 1 = WARNING
  // 2 = WARNING
  // 3 = WARNING
  // 4 = DISQUALIFIED
  // =============================

  socket.on(
    "violation",
    ({ token, reason }) => {
      if (
        !socket.teamToken ||
        socket.teamToken !== token
      ) {
        return;
      }

      const team = teams.find(
        (t) => t.id === socket.teamId
      );

      if (!team) {
        return;
      }

      if (team.disqualified) {
        return;
      }

      team.violations =
        (team.violations || 0) + 1;

      if (team.violations >= 4) {
        team.disqualified = true;
        team.locked = true;

        saveTeams();

        socket.emit("violation", {
          reason:
            "Team disqualified after 4 violations",
          count: team.violations,
          disqualified: true,
        });

        socket.emit(
          "errorMessage",
          "TEAM DISQUALIFIED"
        );

        console.log(
          "Team disqualified:",
          team.name
        );
      } else {
        saveTeams();

        socket.emit("violation", {
          reason,
          count: team.violations,
          disqualified: false,
        });
      }

      broadcastState();
    }
  );
    // =============================
  // ADMIN QUESTION MANAGEMENT
  // =============================

  // GET ALL QUESTIONS
  socket.on("adminGetQuestions", ({ token }) => {
    if (!socket.adminToken || socket.adminToken !== token) {
      socket.emit("errorMessage", "Unauthorized admin");
      return;
    }

    socket.emit("adminQuestions", questions);
  });

  // ADD QUESTION
  socket.on("adminAddQuestion", ({ token, question }) => {
    if (!socket.adminToken || socket.adminToken !== token) {
      socket.emit("errorMessage", "Unauthorized admin");
      return;
    }

    if (!question || !question.challenge) {
      socket.emit("errorMessage", "Question text is required");
      return;
    }

    const newQuestion = {
      id: question.id || `Q${Date.now()}`,
      round: Number(question.round) || 1,
      difficulty: question.difficulty || "Easy",
      category: question.category || "Logic",
      challenge: question.challenge,
      aiPrediction: question.aiPrediction || "RIGHT",
      actualAnswer: question.actualAnswer || "RIGHT"
    };

    questions.push(newQuestion);

    fs.writeFileSync(
      questionsPath,
      JSON.stringify(questions, null, 2),
      "utf8"
    );

    socket.emit("adminQuestions", questions);

    console.log("Question added:", newQuestion.id);
  });

  // UPDATE QUESTION
  socket.on("adminUpdateQuestion", ({ token, id, question }) => {
    if (!socket.adminToken || socket.adminToken !== token) {
      socket.emit("errorMessage", "Unauthorized admin");
      return;
    }

    const index = questions.findIndex(
      (q) => q.id === id
    );

    if (index === -1) {
      socket.emit("errorMessage", "Question not found");
      return;
    }

    questions[index] = {
      ...questions[index],
      ...question,
      id
    };

    fs.writeFileSync(
      questionsPath,
      JSON.stringify(questions, null, 2),
      "utf8"
    );

    socket.emit("adminQuestions", questions);

    console.log("Question updated:", id);
  });

  // DELETE QUESTION
  socket.on("adminDeleteQuestion", ({ token, id }) => {
    if (!socket.adminToken || socket.adminToken !== token) {
      socket.emit("errorMessage", "Unauthorized admin");
      return;
    }

    const index = questions.findIndex(
      (q) => q.id === id
    );

    if (index === -1) {
      socket.emit("errorMessage", "Question not found");
      return;
    }

    questions.splice(index, 1);

    fs.writeFileSync(
      questionsPath,
      JSON.stringify(questions, null, 2),
      "utf8"
    );

    socket.emit("adminQuestions", questions);

    console.log("Question deleted:", id);
  });

  // =============================
  // ADMIN START QUESTION
  // =============================

  socket.on(
    "adminStart",
    ({ token }) => {
      if (
        !socket.adminToken ||
        socket.adminToken !== token
      ) {
        socket.emit(
          "errorMessage",
          "Unauthorized admin"
        );
        return;
      }

      if (!questions.length) {
        socket.emit(
          "errorMessage",
          "No questions available"
        );
        return;
      }

      if (
        game.index >= questions.length
      ) {
        socket.emit(
          "errorMessage",
          "No more questions"
        );
        return;
      }

      const q = questions[game.index];

      game.round =
        getRoundFromIndex(game.index);

      game.question = q;
      game.phase = "question";

      // 45 SECOND TIMER
      game.endsAt =
        Date.now() + 60 * 1000;

      game.revealedAnswer = null;

      investments.clear();
      decisions.clear();

      teams.forEach((team) => {
        if (!team.disqualified) {
          team.locked = false;
        }
      });

      broadcastState();

      console.log(
        "Question started:",
        game.index + 1,
        "Round:",
        game.round
      );
    }
  );

  // =============================
  // REVEAL ANSWER
  // =============================

  socket.on(
    "reveal",
    ({ token }) => {
      if (
        !socket.adminToken ||
        socket.adminToken !== token
      ) {
        socket.emit(
          "errorMessage",
          "Unauthorized admin"
        );
        return;
      }

      if (game.phase !== "question") {
        socket.emit(
          "errorMessage",
          "Question is not active"
        );
        return;
      }

      if (!game.question) {
        socket.emit(
          "errorMessage",
          "No question available"
        );
        return;
      }

      const correctAnswer =
        game.question.actualAnswer ??
        game.question.correctPrediction ??
        game.question.answer ??
        null;

      if (correctAnswer === null) {
        socket.emit(
          "errorMessage",
          "Question has no answer field"
        );
        return;
      }

      game.phase = "reveal";

      game.revealedAnswer =
        correctAnswer;

      // ===========================
      // CALCULATE RESULTS
      // ===========================

      for (const team of teams) {
        if (team.disqualified) {
          continue;
        }

        const investment =
          investments.get(team.id);

        if (!investment) {
          continue;
        }

        const correct =
          investment.prediction ===
          correctAnswer;

        if (correct) {
          team.correct =
            (team.correct || 0) + 1;

          // 2X TOTAL RETURN
          team.coins +=
            investment.amount * 2;
        }
      }

      saveTeams();

      broadcastState();

      console.log(
        "Answer revealed:",
        correctAnswer
      );
    }
  );

  // =============================
  // LEADERBOARD
  // =============================

  socket.on(
    "next",
    ({ token }) => {
      if (
        !socket.adminToken ||
        socket.adminToken !== token
      ) {
        socket.emit(
          "errorMessage",
          "Unauthorized admin"
        );
        return;
      }

      game.phase = "leaderboard";

      broadcastState();
    }
  );

  // =============================
  // NEXT QUESTION
  // =============================

  socket.on(
    "startNext",
    ({ token }) => {
      if (
        !socket.adminToken ||
        socket.adminToken !== token
      ) {
        socket.emit(
          "errorMessage",
          "Unauthorized admin"
        );
        return;
      }

      game.index += 1;

      if (
        game.index >= questions.length
      ) {
        game.phase = "finished";
        game.question = null;
        game.endsAt = null;
        game.revealedAnswer = null;

        broadcastState();

        console.log(
          "Game finished"
        );

        return;
      }

      game.round =
        getRoundFromIndex(game.index);

      game.question =
        questions[game.index];

      game.phase = "lobby";
      game.endsAt = null;
      game.revealedAnswer = null;

      investments.clear();
      decisions.clear();

      teams.forEach((team) => {
        if (!team.disqualified) {
          team.locked = false;
        }
      });

      broadcastState();

      console.log(
        "Next question:",
        game.index + 1,
        "Round:",
        game.round
      );
    }
  );

  // =============================
  // DISCONNECT
  // =============================

  socket.on("disconnect", () => {
    console.log(
      "Client disconnected:",
      socket.id
    );
  });
});

// ===============================
// BASIC API
// ===============================

app.get("/", (req, res) => {
  res.json({
    message:
      "AI Prediction Market Backend Running",
  });
});

app.get(
  "/api/questions",
  (req, res) => {
    res.json(questions);
  }
);

// ===============================
// SERVER START
// ===============================

const PORT = 4000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🚀 Backend running at http://localhost:${PORT}`
    );
  }
);