import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./style.css";

const socket = io("https://ai-prediction-market.onrender.com", {
  autoConnect: true,
});

function App() {
  const [mode, setMode] = useState("home");
  const [state, setState] = useState({});
  const [team, setTeam] = useState(null);
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [pin, setPin] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminQuestions, setAdminQuestions] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [investment, setInvestment] = useState(null);
  const [time, setTime] = useState(60);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onState = (data) => {
      setState(data);
    };

    const onTeamAuth = (data) => {
      if (data.ok) {
        setToken(data.token);
        setTeam(data.team);
        setError("");
        setMode("team");
      } else {
        setError(data.error || "Team login failed");
      }
    };

    const onTeamRegister = (data) => {
      if (data.ok) {
        setError("");
        setTeamId(data.team.name);
        setPin("");
        setMode("login");
      } else {
        setError(data.error || "Team registration failed");
      }
    };

    const onAdminAuth = (data) => {
      if (data.ok) {
        setAdminToken(data.token);
        setError("");
        setMode("admin");
      } else {
        setError(data.error || "Admin login failed");
      }
    };

    const onDecision = (data) => {
      setPrediction(data.prediction);
    };

    const onInvestment = (data) => {
      setInvestment(data.amount);

      setTeam((oldTeam) =>
        oldTeam
          ? {
              ...oldTeam,
              coins: data.coins,
            }
          : oldTeam
      );
    };

    const onViolation = (data) => {
      setWarning(data);
    };

    const onError = (message) => {
      setError(message);
    };

    const onAdminQuestions = (questions) => {
      setAdminQuestions(questions || []);
    };

    socket.on("state", onState);
    socket.on("teamAuth", onTeamAuth);
    socket.on("teamRegisterResult", onTeamRegister);
    socket.on("adminQuestions", onAdminQuestions);
    socket.on("adminAuth", onAdminAuth);
    socket.on("decisionSaved", onDecision);
    socket.on("investmentSaved", onInvestment);
    socket.on("violation", onViolation);
    socket.on("errorMessage", onError);

    return () => {
      socket.off("state", onState);
      socket.off("teamAuth", onTeamAuth);
      socket.off("teamRegisterResult", onTeamRegister);
      socket.off("adminQuestions", onAdminQuestions);
      socket.off("adminAuth", onAdminAuth);
      socket.off("decisionSaved", onDecision);
      socket.off("investmentSaved", onInvestment);
      socket.off("violation", onViolation);
      socket.off("errorMessage", onError);
    };
  }, []);

  /* TIMER */
  useEffect(() => {
    if (!state.endsAt) {
      setTime(60);
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((state.endsAt - Date.now()) / 1000)
      );

      setTime(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [state.endsAt]);

  /* RESET DECISION / INVESTMENT */
  useEffect(() => {
    if (state.phase !== "question") {
      setPrediction(null);
      setInvestment(null);
    }
  }, [state.index, state.round, state.phase]);

  /* FAIR PLAY */
  useEffect(() => {
    if (mode !== "team") return;

    const handleVisibility = () => {
      if (document.hidden && token) {
        socket.emit("violation", {
          token,
          reason: "Game screen left",
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, [mode, token]);

  const teamLogin = () => {
    setError("");

    socket.emit("teamLogin", {
      id: teamId.trim(),
      pin: pin.trim(),
    });
  };

  const adminLogin = () => {
    setError("");

    socket.emit("adminLogin", {
      password: adminPass,
    });
  };

  /* HOME */
  if (mode === "home") {
    return (
      <div className="app-shell">
        <div className="ai-grid"></div>
        <div className="glow glow-one"></div>
        <div className="glow glow-two"></div>

        <main className="landing-page">
          <div className="brand-badge">
            <span>🤖</span>
            AI EVENT SYSTEM
          </div>

          <h1 className="main-title">
            AI <span>Prediction</span> Market
          </h1>

          <p className="main-subtitle">
            Think <b>•</b> Predict <b>•</b> Invest <b>•</b> Learn
          </p>

          <div className="ai-orb">
            <div className="orb-core">🤖</div>
          </div>

          <div className="home-actions">
            <button
              className="primary-button"
              onClick={() => {
                setError("");
                setMode("login");
              }}
            >
              <span>👥</span>
              TEAM LOGIN
            </button>

            <button
              className="secondary-button"
              onClick={() => {
                setError("");
                setMode("register");
              }}
            >
              <span>📝</span>
              TEAM REGISTER
            </button>

            <button
              className="secondary-button"
              onClick={() => {
                setError("");
                setMode("adminLogin");
              }}
            >
              <span>🔐</span>
              HOST / ADMIN
            </button>
          </div>

          <div className="system-status">
            <span className="status-dot"></span>
            SYSTEM READY
            <span className="status-line"></span>
            SECURE EVENT MODE
          </div>
        </main>
      </div>
    );
  }

  /* TEAM LOGIN */
  if (mode === "login") {
    return (
      <LoginPage
        title="Team Login"
        icon="👥"
        subtitle="Enter your private team credentials"
        fields={
          <>
            <div className="input-group">
              <label>TEAM ID</label>

              <div className="input-wrapper">
                <span>🪪</span>

                <input
                  placeholder="Example: TEAM01"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                />
              </div>
            </div>

            <div className="input-group">
              <label>PRIVATE PIN</label>

              <div className="input-wrapper">
                <span>🔑</span>

                <input
                  type="password"
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
            </div>
          </>
        }
        buttonText="ENTER GAME"
        onSubmit={teamLogin}
        error={error}
        onBack={() => {
          setError("");
          setMode("home");
        }}
      />
    );
  }

  /* TEAM REGISTER */
  if (mode === "register") {
    return (
      <LoginPage
        title="Team Registration"
        icon="📝"
        subtitle="Create your team account"
        fields={
          <>
            <div className="input-group">
              <label>TEAM NAME</label>

              <div className="input-wrapper">
                <span>👥</span>

                <input
                  placeholder="Enter your team name"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                />
              </div>
            </div>

            <div className="input-group">
              <label>CREATE PASSWORD</label>

              <div className="input-wrapper">
                <span>🔑</span>

                <input
                  type="password"
                  placeholder="Create your password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
            </div>
          </>
        }
        buttonText="REGISTER TEAM"
        onSubmit={() => {
          setError("");

          if (!socket.connected) {
            setError("Server is not connected");
            return;
          }

          socket.emit("teamRegister", {
            name: teamId.trim(),
            password: pin,
          });
        }}
        error={error}
        onBack={() => {
          setError("");
          setMode("home");
        }}
      />
    );
  }

  /* ADMIN LOGIN */
  if (mode === "adminLogin") {
    return (
      <LoginPage
        title="Host / Admin"
        icon="🔐"
        subtitle="Authorized event control access"
        fields={
          <div className="input-group">
            <label>ADMIN PASSWORD</label>

            <div className="input-wrapper">
              <span>🔒</span>

              <input
                type="password"
                placeholder="Enter admin password"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
              />
            </div>
          </div>
        }
        buttonText="ACCESS CONTROL PANEL"
        onSubmit={adminLogin}
        error={error}
        onBack={() => {
          setError("");
          setMode("home");
        }}
      />
    );
  }

  /* ADMIN */
  if (mode === "admin") {
    return (
      <Admin
        state={state}
        token={adminToken}
        adminQuestions={adminQuestions}
      />
    );
  }

  /* TEAM */
  if (mode === "team") {
    return (
      <Team
        state={state}
        team={team}
        token={token}
        prediction={prediction}
        investment={investment}
        time={time}
        warning={warning}
      />
    );
  }

  return null;
}

/* =========================
   LOGIN PAGE
========================= */

function LoginPage({
  title,
  icon,
  subtitle,
  fields,
  buttonText,
  onSubmit,
  error,
  onBack,
}) {
  return (
    <div className="app-shell">
      <div className="ai-grid"></div>
      <div className="glow glow-one"></div>
      <div className="glow glow-two"></div>

      <div className="login-layout">
        <div className="login-visual">
          <div className="brand-badge">
            <span>🤖</span>
            AI PREDICTION MARKET
          </div>

          <h1>
            Predict the
            <br />
            <span>Future.</span>
          </h1>

          <p>
            Make your prediction.
            <br />
            Trust your reasoning.
            <br />
            Invest with confidence.
          </p>

          <div className="network-visual">
            <div className="network-circle circle-one"></div>
            <div className="network-circle circle-two"></div>
            <div className="network-circle circle-three"></div>

            <div className="network-center">AI</div>

            <div className="network-node node-one">01</div>
            <div className="network-node node-two">AI</div>
            <div className="network-node node-three">?</div>
            <div className="network-node node-four">✓</div>
          </div>
        </div>

        <div className="login-card">
          <div className="login-icon">{icon}</div>

          <div className="login-heading">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          <div className="login-form">
            {fields}

            {error && (
              <div className="login-error">
                <span>⚠️</span>
                {error}
              </div>
            )}

            <button className="login-submit" onClick={onSubmit}>
              {buttonText}
              <span>→</span>
            </button>

            <button className="back-button" onClick={onBack}>
              ← Back to Main Screen
            </button>
          </div>

          <div className="secure-note">
            🔒 Protected Event Environment
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================
   TEAM GAME
========================= */

function Team({
  state,
  team,
  token,
  prediction,
  investment,
  time,
  warning,
}) {
  const question = state.question;

  const expired =
    state.phase !== "question" || time <= 0;

  const danger = time <= 10;

  return (
    <div className="game-shell">
      <header className="game-header">
        <div className="game-brand">
          <div className="mini-logo">🤖</div>

          <div>
            <strong>AI Prediction Market</strong>
            <small>LIVE EVENT</small>
          </div>
        </div>

        <div className="team-wallet">
          <div className="team-name">
            {team?.name || "TEAM"}
          </div>

          <div className="wallet">
            🪙
            <strong>{team?.coins ?? 0}</strong>
          </div>
        </div>
      </header>

      {warning && (
        <div className="security-warning">
          <div className="warning-icon">⚠️</div>

          <div>
            <strong>FAIR-PLAY WARNING</strong>

            <p>
              {warning.reason} • Violation #{warning.count}
            </p>
          </div>
        </div>
      )}

      <main className="game-content">
        <div className="round-label">
          ROUND {state.round || 1}
          <span>•</span>
          {question?.difficulty || "EASY"}
          <span>•</span>
          {question?.category || "AI CHALLENGE"}
        </div>

        <section className="question-card">
          <div className="question-status">
            {state.phase === "question"
              ? "● LIVE QUESTION"
              : state.phase === "reveal"
              ? "● ANSWER REVEALED"
              : "● WAITING"}
          </div>

          <h1>
            {question?.challenge || "Waiting for host..."}
          </h1>

          {question && (
            <>
              <div className="prediction-card">
                <div className="prediction-header">
                  <span>🤖</span>
                  AI PREDICTION
                </div>

                <div className="prediction-value">
                  {question.aiPrediction}
                </div>

                <div className="confidence-meter">
                  <div className="confidence-top">
                    <span>AI CONFIDENCE</span>

                    <strong>
                      {question.aiConfidence || 75}%
                    </strong>
                  </div>

                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${question.aiConfidence || 75}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>

              <div
                className={`game-timer ${
                  danger ? "danger" : ""
                }`}
              >
                <span>⏱️</span>

                <strong>
                  {state.phase === "question" ? time : 0}
                </strong>

                <small>SECONDS</small>
              </div>

              {!prediction &&
                state.phase === "question" &&
                !expired && (
                  <div className="decision-area">
                    <p>
                      Do you trust the AI prediction?
                    </p>

                    <div className="decision-buttons">
                      <button
                        className="right-button"
                        onClick={() =>
                          socket.emit("decision", {
                            token,
                            prediction: "RIGHT",
                          })
                        }
                      >
                        ✓ RIGHT
                      </button>

                      <button
                        className="wrong-button"
                        onClick={() =>
                          socket.emit("decision", {
                            token,
                            prediction: "WRONG",
                          })
                        }
                      >
                        ✕ WRONG
                      </button>
                    </div>
                  </div>
                )}

              {prediction &&
                !investment &&
                state.phase === "question" &&
                !expired && (
                  <div className="investment-panel">
                    <div className="selected-decision">
                      YOUR PREDICTION

                      <strong>{prediction}</strong>
                    </div>

                    <p>
                      How much do you want to invest?
                    </p>

                    <div className="investment-buttons">
                      {[10, 20, 30].map((amount) => (
                        <button
                          key={amount}
                          disabled={
                            (team?.coins ?? 0) < amount
                          }
                          onClick={() =>
                            socket.emit("invest", {
                              token,
                              amount,
                            })
                          }
                        >
                          🪙 {amount}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {investment && (
                <div className="investment-locked">
                  <span>🔒</span>

                  <div>
                    <strong>INVESTMENT LOCKED</strong>

                    <p>
                      {prediction} • 🪙 {investment}
                    </p>
                  </div>
                </div>
              )}

              {state.phase === "locked" && !investment && (
                <div className="time-up">
                  ⏰ TIME UP — Investment closed
                </div>
              )}

              {state.phase === "reveal" && (
                <div className="answer-reveal">
                  <span>🎯</span>
                  ANSWER REVEALED BY HOST
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

/* =========================
   ADMIN DASHBOARD
========================= */

function Admin({ state, token, adminQuestions }) {
  const [showQuestions, setShowQuestions] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState(false);

  useEffect(() => {
    if (token) {
      socket.emit("adminGetQuestions", {
        token,
      });
    }
  }, [token]);

  const openQuestions = () => {
    setShowQuestions(true);
    setShowAddQuestion(false);

    socket.emit("adminGetQuestions", {
      token,
    });
  };

  const closeQuestions = () => {
    setShowQuestions(false);
    setShowAddQuestion(false);
  };

  const question = state.question;

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand">
          <div className="admin-logo">🤖</div>

          <div>
            <h1>AI Prediction Market</h1>
            <p>HOST CONTROL CENTER</p>
          </div>
        </div>

        <div className="admin-status">
          <span className="status-dot"></span>
          SYSTEM ONLINE
        </div>
      </header>

      <div className="admin-layout">
        {/* SIDEBAR */}

        <aside className="admin-sidebar">
          <div className="sidebar-title">
            CONTROL CENTER
          </div>

          <div className="sidebar-item active">
            <span>🎮</span>
            Live Game
          </div>

          <div
            className={`sidebar-item ${
              showQuestions ? "active" : ""
            }`}
            onClick={openQuestions}
          >
            <span>📝</span>
            Questions
          </div>

          <div className="sidebar-item">
            <span>👥</span>
            Teams
          </div>

          <div className="sidebar-item">
            <span>🏆</span>
            Leaderboard
          </div>

          <div className="sidebar-item">
            <span>⚠️</span>
            Security
          </div>

          <div className="sidebar-divider"></div>

          <div className="event-info">
            <small>EVENT STATUS</small>

            <strong>
              {state.phase === "question"
                ? "QUESTION LIVE"
                : state.phase === "reveal"
                ? "RESULT REVEAL"
                : "LOBBY"}
            </strong>

            <span>
              ROUND {state.round || 1}
            </span>
          </div>
        </aside>

        {/* MAIN */}

        <main className="admin-main">
          {/* QUESTIONS MANAGEMENT */}

          {showQuestions && (
            <>
              {/* ADD QUESTION */}

              {showAddQuestion && (
                <section className="data-section">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">
                        QUESTION MANAGEMENT
                      </span>

                      <h3>➕ Add Question</h3>
                    </div>

                    <button
                      className="control-button"
                      onClick={() =>
                        setShowAddQuestion(false)
                      }
                    >
                      ✕ Close
                    </button>
                  </div>

                  <div className="questions-list">
                    <input
                      placeholder="Question ID (example: R1Q6)"
                      id="new-question-id"
                    />

                    <input
                      placeholder="Round (1, 2 or 3)"
                      id="new-question-round"
                    />

                    <input
                      placeholder="Difficulty (Easy, Medium, Hard)"
                      id="new-question-difficulty"
                    />

                    <input
                      placeholder="Category"
                      id="new-question-category"
                    />

                    <textarea
                      placeholder="Challenge / Question"
                      id="new-question-challenge"
                      rows="4"
                    />

                    <select id="new-question-prediction">
                      <option value="RIGHT">
                        RIGHT
                      </option>

                      <option value="WRONG">
                        WRONG
                      </option>
                    </select>

                    <select id="new-question-answer">
                      <option value="RIGHT">
                        RIGHT
                      </option>

                      <option value="WRONG">
                        WRONG
                      </option>
                    </select>

                    <button
                      className="control-button"
                      onClick={() => {
                        const questionData = {
                          id: document
                            .getElementById(
                              "new-question-id"
                            )
                            .value.trim(),

                          round: Number(
                            document.getElementById(
                              "new-question-round"
                            ).value
                          ),

                          difficulty: document
                            .getElementById(
                              "new-question-difficulty"
                            )
                            .value.trim(),

                          category: document
                            .getElementById(
                              "new-question-category"
                            )
                            .value.trim(),

                          challenge: document
                            .getElementById(
                              "new-question-challenge"
                            )
                            .value.trim(),

                          aiPrediction:
                            document.getElementById(
                              "new-question-prediction"
                            ).value,

                          actualAnswer:
                            document.getElementById(
                              "new-question-answer"
                            ).value,
                        };

                        socket.emit(
                          "adminAddQuestion",
                          {
                            token,
                            question: questionData,
                          }
                        );

                        setShowAddQuestion(false);

                        socket.emit(
                          "adminGetQuestions",
                          {
                            token,
                          }
                        );
                      }}
                    >
                      💾 Save Question
                    </button>
                  </div>
                </section>
              )}

              {/* QUESTION LIST */}

              <section className="data-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      QUESTION MANAGEMENT
                    </span>

                    <h3>📝 Questions</h3>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                    }}
                  >
                    <button
                      className="control-button"
                      onClick={closeQuestions}
                    >
                      ✕ Close
                    </button>

                    <button
                      className="control-button"
                      onClick={() =>
                        setShowAddQuestion(true)
                      }
                    >
                      ➕ Add Question
                    </button>
                  </div>
                </div>

                <div className="questions-list">
                  {(adminQuestions || []).length === 0 ? (
                    <p>No questions found.</p>
                  ) : (
                    (adminQuestions || []).map(
                      (q, index) => (
                        <div
                          className="team-admin-card"
                          key={q.id}
                        >
                          <strong>
                            {index + 1}. {q.id}
                          </strong>

                          <p>{q.challenge}</p>

                          <small>
                            Round {q.round} •{" "}
                            {q.difficulty} •{" "}
                            {q.category}
                          </small>

                          <div
                            style={{
                              marginTop: "10px",
                            }}
                          >
                            <b>AI Prediction:</b>{" "}
                            {q.aiPrediction}

                            {" • "}

                            <b>Answer:</b>{" "}
                            {q.actualAnswer}
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
              </section>
            </>
          )}

          {/* ADMIN TITLE */}

          <div className="admin-title-row">
            <div>
              <span className="eyebrow">
                HOST DASHBOARD
              </span>

              <h2>Game Control</h2>

              <p>
                Manage the live prediction market event.
              </p>
            </div>

            <div className="round-badge">
              ROUND {state.round || 1}
              <span>•</span>
              {state.phase || "lobby"}
            </div>
          </div>

          {/* CONTROL PANEL */}

          <section className="control-panel">
            <div className="panel-heading">
              <div>
                <h3>⚡ Live Controls</h3>

                <p>
                  Control the current game round
                </p>
              </div>

              <div className="live-indicator">
                <span></span>
                LIVE
              </div>
            </div>

            <div className="control-grid">
              <button
                className="control-button start"
                onClick={() =>
                  socket.emit("adminStart", {
                    token,
                  })
                }
              >
                <span>▶</span>

                <div>
                  <strong>Start Question</strong>
                  <small>
                    Open investment window
                  </small>
                </div>
              </button>

              <button
                className="control-button reveal"
                onClick={() =>
                  socket.emit("reveal", {
                    token,
                  })
                }
              >
                <span>🎯</span>

                <div>
                  <strong>Reveal Answer</strong>
                  <small>
                    Show final result
                  </small>
                </div>
              </button>

              <button
                className="control-button next"
                onClick={() =>
                  socket.emit("next", {
                    token,
                  })
                }
              >
                <span>🏆</span>

                <div>
                  <strong>Leaderboard</strong>
                  <small>
                    Show current rankings
                  </small>
                </div>
              </button>

              <button
                className="control-button next-question"
                onClick={() =>
                  socket.emit("startNext", {
                    token,
                  })
                }
              >
                <span>⏭</span>

                <div>
                  <strong>Next Question</strong>
                  <small>
                    Continue the event
                  </small>
                </div>
              </button>
            </div>
          </section>

          {/* CURRENT QUESTION */}

          <section className="admin-question-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  CURRENT ROUND
                </span>

                <h3>Question Monitor</h3>
              </div>

              <div className="phase-badge">
                {state.phase || "LOBBY"}
              </div>
            </div>

            {question ? (
              <div className="admin-question-card">
                <div className="question-meta">
                  <span>
                    {question.difficulty}
                  </span>

                  <span>
                    {question.category}
                  </span>
                </div>

                <h2>
                  {question.challenge}
                </h2>

                <div className="admin-prediction">
                  <div>
                    <span>
                      🤖 AI PREDICTION
                    </span>

                    <strong>
                      {question.aiPrediction}
                    </strong>
                  </div>

                  <div className="admin-confidence">
                    <span>CONFIDENCE</span>

                    <strong>
                      {question.aiConfidence || 75}%
                    </strong>
                  </div>
                </div>

                {state.phase === "question" && (
                  <div className="admin-countdown">
                    <span>
                      TIME REMAINING
                    </span>

                    <strong>
                      {Math.max(
                        0,
                        Math.ceil(
                          (state.endsAt -
                            Date.now()) /
                            1000
                        )
                      )}
                      s
                    </strong>
                  </div>
                )}

                {state.phase === "reveal" && (
                  <div className="answer-reveal">
                    <span>🎯</span>

                    <div>
                      <strong>
                        ANSWER REVEALED
                      </strong>

                      <p>
                        Correct Answer:{" "}
                        <b>
                          {question.actualAnswer ||
                            question.correctPrediction ||
                            question.answer}
                        </b>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-question">
                <div>🤖</div>

                <h3>
                  Waiting for the game to begin
                </h3>

                <p>
                  Start a question to begin the
                  next prediction round.
                </p>
              </div>
            )}
          </section>

          {/* STATS */}

          <section className="stats-grid">
            <div className="stat-card">
              <span>👥</span>

              <div>
                <small>ACTIVE TEAMS</small>

                <strong>
                  {(state.teams || []).length}
                </strong>
              </div>
            </div>

            <div className="stat-card">
              <span>🔒</span>

              <div>
                <small>
                  LOCKED INVESTMENTS
                </small>

                <strong>
                  {(state.teams || []).filter(
                    (t) => t.locked
                  ).length}
                </strong>
              </div>
            </div>

            <div className="stat-card">
              <span>⚠️</span>

              <div>
                <small>VIOLATIONS</small>

                <strong>
                  {(state.leaderboard || []).reduce(
                    (sum, t) =>
                      sum +
                      (t.violations || 0),
                    0
                  )}
                </strong>
              </div>
            </div>
          </section>

          {/* LEADERBOARD */}

          <section className="data-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  LIVE RANKINGS
                </span>

                <h3>🏆 Leaderboard</h3>
              </div>
            </div>

            <div className="leaderboard-table">
              <div className="table-header">
                <span>#</span>
                <span>TEAM</span>
                <span>COINS</span>
                <span>CORRECT</span>
                <span>VIOLATIONS</span>
              </div>

              {(state.leaderboard || []).map(
                (team, index) => (
                  <div
                    className="table-row"
                    key={team.name}
                  >
                    <span className="rank">
                      {index + 1}
                    </span>

                    <strong>
                      {team.name}
                    </strong>

                    <span>
                      🪙 {team.coins}
                    </span>

                    <span className="correct">
                      {team.correct}
                    </span>

                    <span className="violations">
                      ⚠️ {team.violations}
                    </span>
                  </div>
                )
              )}
            </div>
          </section>

          {/* TEAMS */}

          <section className="data-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  PARTICIPANTS
                </span>

                <h3>
                  👥 Registered Teams
                </h3>
              </div>
            </div>

            <div className="teams-grid">
              {(state.teams || []).map(
                (team) => (
                  <div
                    className="team-admin-card"
                    key={team.id}
                  >
                    <div className="team-avatar">
                      {team.name?.charAt(0) ||
                        "T"}
                    </div>

                    <div className="team-admin-info">
                      <strong>
                        {team.name}
                      </strong>

                      <small>
                        ID: {team.id}
                      </small>
                    </div>

                    <div className="team-admin-coins">
                      🪙 {team.coins}
                    </div>

                    <div
                      className={
                        team.locked
                          ? "team-status locked"
                          : "team-status waiting"
                      }
                    >
                      {team.locked
                        ? "LOCKED"
                        : "WAITING"}
                    </div>
                  </div>
                )
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);