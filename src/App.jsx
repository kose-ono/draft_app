// src/App.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import rawProspects from "./prospects.json";

// セ・パ別球団定義
const CENTRAL_TEAMS = [
  { id: "tigers", name: "阪神", fullName: "阪神タイガース", league: "central" },
  { id: "carp", name: "広島", fullName: "広島東洋カープ", league: "central" },
  { id: "baystars", name: "DeNA", fullName: "横浜DeNAベイスターズ", league: "central" },
  { id: "giants", name: "巨人", fullName: "読売ジャイアンツ", league: "central" },
  { id: "swallows", name: "ヤクルト", fullName: "東京ヤクルトスワローズ", league: "central" },
  { id: "dragons", name: "中日", fullName: "中日ドラゴンズ", league: "central" },
];

const PACIFIC_TEAMS = [
  { id: "buffaloes", name: "オリックス", fullName: "オリックス・バファローズ", league: "pacific" },
  { id: "marines", name: "ロッテ", fullName: "千葉ロッテマリーンズ", league: "pacific" },
  { id: "hawks", name: "ソフトバンク", fullName: "福岡ソフトバンクホークス", league: "pacific" },
  { id: "eagles", name: "楽天", fullName: "東北楽天ゴールデンイーグルス", league: "pacific" },
  { id: "lions", name: "西武", fullName: "埼玉西武ライオンズ", league: "pacific" },
  { id: "fighters", name: "日本ハム", fullName: "北海道日本ハムファイターズ", league: "pacific" },
];

const ALL_TEAMS_MAP = {};
[...CENTRAL_TEAMS, ...PACIFIC_TEAMS].forEach((t) => {
  ALL_TEAMS_MAP[t.id] = t;
});

const RANK_WEIGHT = { SS: 7, S: 6, A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
const RANK_COLORS = {
  SS: { bg: "#7e22ce", text: "#fff" },
  S:  { bg: "#dc2626", text: "#fff" },
  A:  { bg: "#ea580c", text: "#fff" },
  B:  { bg: "#2563eb", text: "#fff" },
  C:  { bg: "#16a34a", text: "#fff" },
  D:  { bg: "#64748b", text: "#fff" },
  E:  { bg: "#94a3b8", text: "#fff" },
  F:  { bg: "#cbd5e1", text: "#334155" }
};

const getRound1SubLabel = (subRound) => {
  if (subRound <= 1) return "第1巡目入札";
  if (subRound === 2) return "外れ1位指名";
  if (subRound === 3) return "外れ外れ1位指名";
  return `外れ${subRound - 1}次1位指名`;
};

const shuffle = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const calculateWaiverOrder = (centralStandings, pacificStandings) => {
  const order = [];
  for (let rank = 6; rank >= 1; rank--) {
    const cTeam = centralStandings.find((t) => t.rank === rank);
    const pTeam = pacificStandings.find((t) => t.rank === rank);
    if (cTeam) order.push(ALL_TEAMS_MAP[cTeam.id]);
    if (pTeam) order.push(ALL_TEAMS_MAP[pTeam.id]);
  }
  return order;
};

const generateWarValue = (teamRank, posType = "field") => {
  const u1 = Math.max(0.0001, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

  const mean = 0.25 + (7 - teamRank) * 0.12;
  const stdDev = posType === "sp" || posType === "of" ? 0.75 : 0.65;

  let val = mean + z0 * stdDev;
  val = Math.max(-2.5, Math.min(4.5, val));
  return Number(val.toFixed(1));
};

const randAge = (min, max) => Number((Math.random() * (max - min) + min).toFixed(1));

const generateTeamAnalysis = (teamRank) => {
  const war = {
    sp: generateWarValue(teamRank, "sp"),
    rp: generateWarValue(teamRank, "rp"),
    c:  generateWarValue(teamRank, "c"),
    first:  generateWarValue(teamRank, "field"),
    second: generateWarValue(teamRank, "field"),
    third:  generateWarValue(teamRank, "field"),
    short:  generateWarValue(teamRank, "field"),
    of: generateWarValue(teamRank, "of")
  };

  const age = {
    sp: randAge(24.5, 31.0),
    rp: randAge(25.0, 31.5),
    c:  randAge(25.0, 32.5),
    first:  randAge(24.5, 32.5),
    second: randAge(24.0, 31.0),
    third:  randAge(24.0, 31.5),
    short:  randAge(23.5, 30.5),
    of: randAge(24.0, 31.0)
  };

  const needs = [];
  if (war.sp <= 0.2) needs.push({ pos: "投手", subPos: null, label: "先発補強", priority: war.sp < -0.3 ? "最重要" : "急務" });
  if (war.short <= 0.2) needs.push({ pos: "内野手", subPos: "遊", label: "正遊撃手", priority: "急務" });
  if (war.c <= 0.0) needs.push({ pos: "捕手", subPos: null, label: "正捕手", priority: "急務" });
  if (war.second <= 0.2) needs.push({ pos: "内野手", subPos: "二", label: "二塁手", priority: "補強" });
  if (war.third <= 0.2) needs.push({ pos: "内野手", subPos: "三", label: "三塁手", priority: "補強" });
  if (war.first <= 0.2) needs.push({ pos: "内野手", subPos: "一", label: "一塁手", priority: "補強" });
  if (war.of <= 0.5) needs.push({ pos: "外野手", subPos: null, label: "外野強化", priority: "補強" });
  if (war.rp <= 0.2) needs.push({ pos: "投手", subPos: null, label: "救援テコ入れ", priority: "補強" });

  if (age.short >= 29.5 && !needs.some((n) => n.subPos === "遊")) needs.push({ pos: "内野手", subPos: "遊", label: "遊撃若返り", priority: "世代交代" });
  if (age.second >= 29.5 && !needs.some((n) => n.subPos === "二")) needs.push({ pos: "内野手", subPos: "二", label: "二塁若返り", priority: "世代交代" });
  if (age.third >= 30.0 && !needs.some((n) => n.subPos === "三")) needs.push({ pos: "内野手", subPos: "三", label: "三塁若返り", priority: "世代交代" });
  if (age.first >= 30.5 && !needs.some((n) => n.subPos === "一")) needs.push({ pos: "内野手", subPos: "一", label: "一塁後継者", priority: "世代交代" });
  if (age.c >= 29.5 && !needs.some((n) => n.pos === "捕手")) needs.push({ pos: "捕手", subPos: null, label: "捕手若返り", priority: "世代交代" });
  if (age.sp >= 29.0 && !needs.some((n) => n.pos === "投手")) needs.push({ pos: "投手", subPos: null, label: "先発若返り", priority: "世代交代" });

  if (needs.length === 0) needs.push({ pos: "投手", subPos: null, label: "即戦力投手", priority: "充実" });

  return { war, age, needs };
};

const getEmptyState = () => {
  const teamsObj = {};
  [...CENTRAL_TEAMS, ...PACIFIC_TEAMS].forEach((t) => {
    teamsObj[t.id] = {
      ownerId: null,
      ownerName: "CPU",
      isSubmitted: false,
      isConfirmed: false,
      secretBid: null,
      confirmedPlayer: null,
      picks: [],
      developmentPicks: [],
      isFinished: false,
      isDevFinished: false
    };
  });
  return {
    hostPlayerId: null,
    isDraftStarted: false,
    isDevelopmentMode: false,
    standings: null,
    teamProfiles: null,
    waiverOrderIds: null,
    round: 1,
    phase: "BIDDING",
    subRound: 1,
    teams: teamsObj,
    lottery: null,
    announcement: null,
    waiverCurrentIndex: 0
  };
};

const isIndependentLeague = (player) => {
  if (!player) return false;
  if (player.category === "高校" || player.category === "大学") return false;
  if (player.category === "独立" || player.category === "独立リーグ") return true;

  const aff = (player.affiliation || "") + (player.team || "");
  const indyKeywords = [
    "徳島", "愛媛", "高知", "香川", "アイランド", "IL",
    "新潟", "信濃", "群馬", "武蔵", "栃木", "茨城", "神奈川フューチャードリームス", "埼玉武蔵", "BC",
    "富山GRN", "石川ミリオンスターズ", "福井ネクサス", "滋賀GO", "日本海",
    "火の国", "大分B", "北九州下関", "宮崎サンシャイン", "KAL",
    "オイシックス", "くふうハヤテ", "ハヤテ", "独立"
  ];
  return indyKeywords.some((kw) => aff.includes(kw));
};

const isPureCorporatePlayer = (player) => {
  if (!player) return false;
  if (player.category === "高校" || player.category === "大学") return false;
  if (isIndependentLeague(player)) return false;

  if (player.category === "社会人" || player.category === "社会人・独立") {
    return true;
  }
  return false;
};

const isRestrictedForDevelopment = (player) => {
  if (!player) return false;
  if (isPureCorporatePlayer(player)) return true;

  if (player.category === "大学" && player.position !== "投手") {
    const rWeight = RANK_WEIGHT[player.rank] ?? 0;
    if (rWeight >= 3) return true;
  }

  return false;
};

// AI指名選定ロジック（育成モード時のフォールバックおよびエラー回避を強化）
const selectAiProspect = (prospects, confirmedIds, existingPicks = [], teamProfile = null, isRound1 = false, isSubRound = false, isDevMode = false) => {
  let available = prospects.filter((p) => p && !confirmedIds.includes(p.id));

  if (isDevMode) {
    available = available.filter((p) => !isRestrictedForDevelopment(p));
  }

  if (available.length === 0) return null;

  // ① 1巡目本指名
  if (isRound1 && !isSubRound && !isDevMode) {
    const sPlusPlayers = available.filter((p) => p.rank === "SS" || p.rank === "S");
    if (sPlusPlayers.length > 0) {
      const sPitchers = sPlusPlayers.filter((p) => p.position === "投手");
      const sBatters = sPlusPlayers.filter((p) => p.position !== "投手");

      if (sPitchers.length > 0 && (Math.random() < 0.75 || sBatters.length === 0)) {
        return sPitchers[Math.floor(Math.random() * sPitchers.length)];
      }
      if (sBatters.length > 0) {
        return sBatters[Math.floor(Math.random() * sBatters.length)];
      }
    }
  }

  // ② 1巡目外れ指名
  if (isRound1 && isSubRound && !isDevMode) {
    const remainingS = available.filter((p) => p.rank === "SS" || p.rank === "S");
    if (remainingS.length > 0) {
      return remainingS[Math.floor(Math.random() * remainingS.length)];
    }

    const aPlayers = available.filter((p) => p.rank === "A");
    const targetPool = aPlayers.length > 0 ? aPlayers : available.slice(0, 10);
    const aPitchers = targetPool.filter((p) => p.position === "投手");
    const aBatters = targetPool.filter((p) => p.position !== "投手");

    if (aPitchers.length > 0 && Math.random() < 0.82) {
      return aPitchers[Math.floor(Math.random() * aPitchers.length)];
    }
    if (aBatters.length > 0) {
      return aBatters[Math.floor(Math.random() * aBatters.length)];
    }
    if (aPitchers.length > 0) {
      return aPitchers[Math.floor(Math.random() * aPitchers.length)];
    }
  }

  // ③ 2巡目以降ウェーバー & 育成ドラフト
  const topPlayer = available[0];
  const topRankWeight = topPlayer && topPlayer.rank ? (RANK_WEIGHT[topPlayer.rank] ?? 0) : 0;
  
  // 育成時はランク下限の幅を広げて候補枯渇を防止
  const rankMargin = isDevMode ? 3 : 1;
  const candidates = available.filter(
    (p) => (RANK_WEIGHT[p.rank] ?? 0) >= Math.max(0, topRankWeight - rankMargin)
  );

  const posCounts = { 投手: 0, 捕手: 0, 内野手: 0, 外野手: 0 };
  existingPicks.forEach((pick) => {
    const pos = pick?.player?.position;
    if (pos && posCounts[pos] !== undefined) posCounts[pos]++;
  });

  let pool = candidates.length > 0 ? candidates : available;
  if (teamProfile?.needs?.length > 0 && Math.random() < 0.50) {
    const primaryNeed = teamProfile.needs[0];
    const needCandidates = pool.filter((p) => {
      if (primaryNeed.pos === "内野手" && primaryNeed.subPos) {
        return p.position === "内野手" && p.subPosition === primaryNeed.subPos;
      }
      return p.position === primaryNeed.pos;
    });
    if (needCandidates.length > 0) {
      pool = needCandidates;
    }
  }

  // 育成モード時はポジション人数の上限キャップを撤廃して指名停止を防ぐ
  const balancedPool = pool.filter((p) => {
    if (isDevMode) return true;
    if (p.position === "投手" && posCounts["投手"] >= 5) return false;
    if (p.position !== "投手" && posCounts[p.position] >= 3) return false;
    return true;
  });

  if (balancedPool.length > 0) {
    return balancedPool[Math.floor(Math.random() * balancedPool.length)];
  }

  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return available[0] || null;
};

const evaluateRegularFinished = (pickCount) => {
  if (pickCount < 5) return false;
  if (pickCount >= 8) return true;

  if (pickCount === 5) return Math.random() < 0.30;
  if (pickCount === 6) return Math.random() < 0.75;
  if (pickCount === 7) return Math.random() < 0.90;
  return false;
};

const evaluateDevFinished = (teamId, devPickCount) => {
  if (teamId === "hawks") {
    if (devPickCount >= 14) return true;
    if (devPickCount >= 10) return Math.random() < 0.45;
    if (devPickCount >= 8) return Math.random() < 0.20;
    return false;
  }
  if (teamId === "giants" || teamId === "lions") {
    if (devPickCount >= 9) return true;
    if (devPickCount >= 6) return Math.random() < 0.50;
    if (devPickCount >= 4) return Math.random() < 0.25;
    return false;
  }
  if (devPickCount >= 4) return true;
  if (devPickCount >= 3) return Math.random() < 0.70;
  if (devPickCount >= 2) return Math.random() < 0.50;
  if (devPickCount >= 1) return Math.random() < 0.20;
  return false;
};

// 戦力分析コンポーネント
const TeamAnalysisTable = ({ teamId, fullName, standings, profile, isUser, ownerName }) => {
  if (!profile) return null;
  const war = profile.war || {};
  const age = profile.age || {};
  const needs = profile.needs || [];

  let rankLabel = "";
  if (standings) {
    const cFound = standings.central?.find((t) => t.id === teamId);
    const pFound = standings.pacific?.find((t) => t.id === teamId);
    if (cFound) rankLabel = `セ・前年${cFound.rank}位`;
    else if (pFound) rankLabel = `パ・前年${pFound.rank}位`;
  }

  const posColumns = [
    { label: "先発", warVal: war.sp ?? 0.5, ageVal: age.sp ?? 27.2 },
    { label: "救援", warVal: war.rp ?? 0.4, ageVal: age.rp ?? 27.8 },
    { label: "捕手", warVal: war.c ?? 0.2, ageVal: age.c ?? 28.5 },
    { label: "一塁", warVal: war.first ?? 0.6, ageVal: age.first ?? 28.3 },
    { label: "二塁", warVal: war.second ?? 0.4, ageVal: age.second ?? 26.9 },
    { label: "三塁", warVal: war.third ?? 0.5, ageVal: age.third ?? 27.5 },
    { label: "遊撃", warVal: war.short ?? 0.5, ageVal: age.short ?? 26.4 },
    { label: "外野", warVal: war.of ?? 0.8, ageVal: age.of ?? 27.0 }
  ];

  return (
    <div style={{
      backgroundColor: isUser ? "#fffdf5" : "#ffffff",
      border: isUser ? "2px solid #f59e0b" : "1px solid #cbd5e1",
      borderRadius: "8px",
      padding: "12px 14px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
        <div>
          <span style={{ fontWeight: "900", fontSize: "15px", color: "#0f172a" }}>{fullName}</span>
          {rankLabel && (
            <span style={{ marginLeft: "6px", fontSize: "11px", color: "#475569", fontWeight: "bold" }}>
              ({rankLabel})
            </span>
          )}
          <span style={{ marginLeft: "8px", fontSize: "11px", color: isUser ? "#d97706" : "#64748b", fontWeight: "bold" }}>
            [{ownerName || "CPU"}{isUser ? "・あなた" : ""}]
          </span>
        </div>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {needs.map((n, i) => (
            <span key={i} style={{
              fontSize: "10px",
              padding: "1px 6px",
              borderRadius: "3px",
              backgroundColor: n.priority === "最重要" ? "#dc2626" : (n.priority === "急務" ? "#ea580c" : (n.priority === "世代交代" ? "#7c3aed" : "#0284c7")),
              color: "#fff",
              fontWeight: "bold"
            }}>
              {n.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "center", fontSize: "11px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f1f5f9", color: "#000000" }}>
              <th style={{ padding: "4px 2px", border: "1px solid #cbd5e1", width: "42px", color: "#000000" }}>指標</th>
              {posColumns.map((col, idx) => (
                <th key={idx} style={{ padding: "4px 2px", border: "1px solid #cbd5e1", fontWeight: "bold", color: "#000000" }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "5px 2px", border: "1px solid #cbd5e1", fontWeight: "bold", backgroundColor: "#f8fafc", color: "#000000" }}>WAR</td>
              {posColumns.map((col, idx) => {
                const isWeak = col.warVal <= 0.0;
                const isStrong = col.warVal >= 1.8;
                return (
                  <td
                    key={idx}
                    style={{
                      padding: "5px 2px",
                      border: "1px solid #cbd5e1",
                      fontWeight: "900",
                      backgroundColor: isWeak ? "#fee2e2" : (isStrong ? "#dcfce7" : "#ffffff"),
                      color: "#000000"
                    }}
                  >
                    {col.warVal > 0 ? `+${col.warVal}` : col.warVal}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td style={{ padding: "5px 2px", border: "1px solid #cbd5e1", fontWeight: "bold", backgroundColor: "#f8fafc", color: "#000000" }}>年齢</td>
              {posColumns.map((col, idx) => {
                const isOld = col.ageVal >= 30.0;
                return (
                  <td
                    key={idx}
                    style={{
                      padding: "5px 2px",
                      border: "1px solid #cbd5e1",
                      fontWeight: isOld ? "bold" : "normal",
                      backgroundColor: isOld ? "#fef9c3" : "#ffffff",
                      color: "#000000"
                    }}
                  >
                    {col.ageVal}歳
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function App() {
  const myPlayerId = useMemo(() => {
    let id = localStorage.getItem("npb_draft_player_id");
    if (!id) {
      id = "p_" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem("npb_draft_player_id", id);
    }
    return id;
  }, []);

  const [myPlayerName, setMyPlayerName] = useState(() => {
    return localStorage.getItem("npb_draft_player_name") || "プレイヤー";
  });

  const [roomData, setRoomData] = useState(getEmptyState());
  const [selectingTeam, setSelectingTeam] = useState(null);
  const [activeTab, setActiveTab] = useState("BOARD");

  const [filterCategory, setFilterCategory] = useState("ALL");
  const [filterPos, setFilterPos] = useState("ALL");
  const [filterThrow, setFilterThrow] = useState("ALL");
  const [filterRole, setFilterRole] = useState("ALL");
  const [filterSubPos, setFilterSubPos] = useState("ALL");
  const [filterBatterType, setFilterBatterType] = useState("ALL");
  const [filterBatsHand, setFilterBatsHand] = useState("ALL");

  const [isPlayerRevealed, setIsPlayerRevealed] = useState(false);

  const [draftStandings, setDraftStandings] = useState(null);
  const [draftProfiles, setDraftProfiles] = useState(null);

  const currentLotteryStepRef = useRef("");
  const currentWaiverStepRef = useRef("");
  const currentCpuOnlyBiddingSubRoundRef = useRef(0);

  useEffect(() => {
    const roomRef = doc(db, "draft_rooms", "default_room");
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        const safeTeams = {};
        Object.keys(ALL_TEAMS_MAP).forEach((tid) => {
          const t = (d.teams && d.teams[tid]) || {};
          safeTeams[tid] = {
            ownerId: t.ownerId || null,
            ownerName: t.ownerName || "CPU",
            isSubmitted: !!t.isSubmitted,
            isConfirmed: !!t.isConfirmed,
            secretBid: t.secretBid || null,
            confirmedPlayer: t.confirmedPlayer || null,
            picks: Array.isArray(t.picks) ? t.picks : [],
            developmentPicks: Array.isArray(t.developmentPicks) ? t.developmentPicks : [],
            isFinished: !!t.isFinished,
            isDevFinished: !!t.isDevFinished
          };
        });

        const rawProfiles = d.teamProfiles || null;
        let safeProfiles = rawProfiles;
        if (rawProfiles) {
          safeProfiles = {};
          Object.keys(rawProfiles).forEach((tid) => {
            const p = rawProfiles[tid] || {};
            const w = p.war || {};
            const a = p.age || {};
            safeProfiles[tid] = {
              needs: p.needs || [],
              war: {
                sp: w.sp ?? 0.5,
                rp: w.rp ?? 0.4,
                c:  w.c ?? 0.2,
                first:  w.first ?? 0.6,
                second: w.second ?? 0.4,
                third:  w.third ?? 0.5,
                short:  w.short ?? 0.5,
                of: w.of ?? 0.8
              },
              age: {
                sp: a.sp ?? 27.2,
                rp: a.rp ?? 27.8,
                c:  a.c ?? 28.5,
                first:  a.first ?? 28.3,
                second: a.second ?? 26.9,
                third:  a.third ?? 27.5,
                short:  a.short ?? 26.4,
                of: a.of ?? 27.0
              }
            };
          });
        }

        setRoomData({
          hostPlayerId: d.hostPlayerId || null,
          isDraftStarted: !!d.isDraftStarted,
          isDevelopmentMode: !!d.isDevelopmentMode,
          standings: d.standings || null,
          teamProfiles: safeProfiles,
          waiverOrderIds: d.waiverOrderIds || null,
          round: d.round || 1,
          phase: d.phase || (d.isDevelopmentMode ? "WAIVER" : "BIDDING"),
          subRound: d.subRound || 1,
          teams: safeTeams,
          lottery: d.lottery || null,
          announcement: d.announcement || null,
          waiverCurrentIndex: d.waiverCurrentIndex || 0
        });
      } else {
        setDoc(roomRef, getEmptyState());
      }
    });
    return () => unsubscribe();
  }, []);

  const teamsState = roomData.teams || {};
  const isRevealed = roomData.phase === "REVEALED";
  const lottery = roomData.lottery;
  const announcement = roomData.announcement;
  const currentRound = roomData.round || 1;
  const teamProfiles = roomData.teamProfiles || {};
  const isDevMode = !!roomData.isDevelopmentMode;

  const isHost = !roomData.hostPlayerId || roomData.hostPlayerId === myPlayerId;

  const myAssignedTeamIds = useMemo(() => {
    return Object.keys(teamsState).filter((tid) => teamsState[tid]?.ownerId === myPlayerId);
  }, [teamsState, myPlayerId]);

  const baseTeamsList = useMemo(() => {
    if (roomData.waiverOrderIds && roomData.waiverOrderIds.length === 12) {
      return roomData.waiverOrderIds.map((id) => ALL_TEAMS_MAP[id]).filter(Boolean);
    }
    return [...CENTRAL_TEAMS, ...PACIFIC_TEAMS];
  }, [roomData.waiverOrderIds]);

  const waiverOrder = useMemo(() => {
    if (currentRound % 2 === 0) {
      return baseTeamsList;
    } else {
      return [...baseTeamsList].reverse();
    }
  }, [currentRound, baseTeamsList]);

  // 選択終了していない球団リスト
  const activeWaiverOrder = useMemo(() => {
    return waiverOrder.filter((t) => isDevMode ? !teamsState[t.id]?.isDevFinished : !teamsState[t.id]?.isFinished);
  }, [waiverOrder, teamsState, isDevMode]);

  const currentWaiverTeam = useMemo(() => {
    const isWaiverPhase = isDevMode ? true : currentRound >= 2;
    if (!isWaiverPhase || activeWaiverOrder.length === 0) return null;
    const idx = (roomData.waiverCurrentIndex || 0) % activeWaiverOrder.length;
    return activeWaiverOrder[idx] || null;
  }, [currentRound, activeWaiverOrder, roomData.waiverCurrentIndex, isDevMode]);

  const allConfirmedPlayerIds = useMemo(() => {
    const ids = [];
    Object.values(teamsState).forEach((t) => {
      if (t && Array.isArray(t.picks)) {
        t.picks.forEach((p) => {
          if (p?.player?.id) ids.push(p.player.id);
        });
      }
      if (t && Array.isArray(t.developmentPicks)) {
        t.developmentPicks.forEach((p) => {
          if (p?.player?.id) ids.push(p.player.id);
        });
      }
      if (t?.isConfirmed && t.confirmedPlayer?.id) {
        if (!ids.includes(t.confirmedPlayer.id)) ids.push(t.confirmedPlayer.id);
      }
    });
    return ids;
  }, [teamsState]);

  const sortedProspects = useMemo(() => {
    if (!Array.isArray(rawProspects)) return [];
    return [...rawProspects].sort((a, b) => (RANK_WEIGHT[b.rank] || 0) - (RANK_WEIGHT[a.rank] || 0));
  }, []);

  const handleGenerateRandomStandings = async () => {
    const shuffledCentral = shuffle(CENTRAL_TEAMS).map((t, idx) => ({ ...t, rank: idx + 1 }));
    const shuffledPacific = shuffle(PACIFIC_TEAMS).map((t, idx) => ({ ...t, rank: idx + 1 }));

    const generatedProfiles = {};
    shuffledCentral.forEach((t) => {
      generatedProfiles[t.id] = generateTeamAnalysis(t.rank);
    });
    shuffledPacific.forEach((t) => {
      generatedProfiles[t.id] = generateTeamAnalysis(t.rank);
    });

    const calculatedOrder = calculateWaiverOrder(shuffledCentral, shuffledPacific);
    const waiverOrderIds = calculatedOrder.map((t) => t.id);

    setDraftStandings({ central: shuffledCentral, pacific: shuffledPacific });
    setDraftProfiles(generatedProfiles);

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      hostPlayerId: myPlayerId,
      standings: { central: shuffledCentral, pacific: shuffledPacific },
      teamProfiles: generatedProfiles,
      waiverOrderIds
    });
  };

  const handleToggleClaimTeam = async (teamId) => {
    const t = teamsState[teamId];
    if (!t) return;

    const newTeams = { ...teamsState };
    if (t.ownerId === myPlayerId) {
      newTeams[teamId] = { ...t, ownerId: null, ownerName: "CPU" };
    } else if (t.ownerId === null) {
      newTeams[teamId] = { ...t, ownerId: myPlayerId, ownerName: myPlayerName || "プレイヤー" };
    } else {
      alert(`この球団はすでに ${t.ownerName} さんが担当しています`);
      return;
    }

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      teams: newTeams
    });
  };

  const handleStartDraftMeeting = async () => {
    if (!roomData.standings || !roomData.teamProfiles) {
      alert("先に戦力データと順位を生成してください");
      return;
    }
    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true
    });
  };

  // 1巡目CPU入札処理
  useEffect(() => {
    if (!isHost || !roomData.isDraftStarted || isDevMode) return;
    if (currentRound !== 1 || roomData.phase !== "BIDDING") return;

    const unconfirmedCpus = baseTeamsList.filter(
      (t) => !teamsState[t.id]?.ownerId && !teamsState[t.id]?.isConfirmed && !teamsState[t.id]?.isSubmitted
    );

    if (unconfirmedCpus.length === 0) return;

    const currentSubRoundKey = `${roomData.subRound}_${unconfirmedCpus.map((t) => t.id).join(",")}`;
    if (currentCpuOnlyBiddingSubRoundRef.current === currentSubRoundKey) return;
    currentCpuOnlyBiddingSubRoundRef.current = currentSubRoundKey;

    const timer = setTimeout(async () => {
      const newTeams = { ...teamsState };
      unconfirmedCpus.forEach((team) => {
        const isSub = roomData.subRound > 1;
        const aiProspect = selectAiProspect(sortedProspects, allConfirmedPlayerIds, [], teamProfiles[team.id], true, isSub, false);
        if (aiProspect) {
          newTeams[team.id] = {
            ...newTeams[team.id],
            isSubmitted: true,
            isConfirmed: false,
            confirmedPlayer: null,
            secretBid: {
              id: aiProspect.id,
              name: aiProspect.name,
              position: aiProspect.position,
              affiliation: aiProspect.affiliation,
              rank: aiProspect.rank,
              category: aiProspect.category || "",
              description: aiProspect.description || ""
            }
          };
        }
      });

      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        teams: newTeams
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [isHost, roomData.isDraftStarted, currentRound, roomData.phase, roomData.subRound, teamsState, sortedProspects, allConfirmedPlayerIds, baseTeamsList, teamProfiles, isDevMode]);

  // くじ引き自動選択
  useEffect(() => {
    if (!lottery || lottery.isOpened) {
      currentLotteryStepRef.current = "";
      return;
    }

    if (lottery.currentPickerIndex >= lottery.contenderIds.length) return;

    const currentPickerTeamId = lottery.contenderIds[lottery.currentPickerIndex];
    const pickerTeamState = teamsState[currentPickerTeamId];
    const isCpuTeam = !pickerTeamState?.ownerId;

    const stepKey = `${lottery.player?.id}_${lottery.currentPickerIndex}_${currentPickerTeamId}`;
    if (currentLotteryStepRef.current === stepKey) return;

    if (isCpuTeam && isHost) {
      currentLotteryStepRef.current = stepKey;

      const availableEnvelopes = lottery.envelopes.filter((e) => !e.chosenByTeamId);
      if (availableEnvelopes.length > 0) {
        const chosenEnv = availableEnvelopes[Math.floor(Math.random() * availableEnvelopes.length)];
        const timer = setTimeout(async () => {
          await handlePickEnvelope(chosenEnv.index);
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [lottery?.player?.id, lottery?.currentPickerIndex, lottery?.isOpened, teamsState, isHost]);

  // advanceWaiverTurn（ウェーバー巡回関数）
  const advanceWaiverTurn = async (updatedTeams, currentIndex, isPicked = true) => {
    const currentActive = waiverOrder.filter((t) => isDevMode ? !updatedTeams[t.id]?.isDevFinished : !updatedTeams[t.id]?.isFinished);

    if (currentActive.length === 0) {
      if (isDevMode) {
        alert("すべての球団が育成指名を終了しました。ドラフト会議の全日程が終了しました！");
      } else {
        alert("すべての球団が支配下指名を終了しました！「育成ドラフト会議へ進む」ボタンから育成指名を開始できます。");
      }
      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        teams: updatedTeams,
        announcement: null
      });
      return;
    }

    // パス（isPicked === false）の場合は配列が1つ詰まるため、indexをそのまま維持すれば次の球団を指す
    let nextIndex = isPicked ? currentIndex + 1 : currentIndex;

    if (nextIndex >= currentActive.length) {
      const nextRound = currentRound + 1;
      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        round: nextRound,
        waiverCurrentIndex: 0,
        teams: updatedTeams,
        announcement: null
      });
    } else {
      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        waiverCurrentIndex: nextIndex,
        teams: updatedTeams,
        announcement: null
      });
    }
  };

  // CPUウェーバー自動指名（育成ドラフト完全対応）
  useEffect(() => {
    const isWaiverPhase = isDevMode ? true : currentRound >= 2;
    if (!isWaiverPhase || !currentWaiverTeam || announcement || !isHost || !roomData.isDraftStarted) {
      currentWaiverStepRef.current = "";
      return;
    }

    const tState = teamsState[currentWaiverTeam.id] || {};
    const isCpuTeam = !tState.ownerId;
    if (!isCpuTeam) return;

    // 手番球団がすでに終了している場合、即座に次の球団へ進めてスタックを防止
    if ((isDevMode && tState.isDevFinished) || (!isDevMode && tState.isFinished)) {
      advanceWaiverTurn(teamsState, roomData.waiverCurrentIndex || 0, false);
      return;
    }

    const stepKey = `${isDevMode ? "dev" : "reg"}_${currentRound}_${currentWaiverTeam.id}_${roomData.waiverCurrentIndex}`;
    if (currentWaiverStepRef.current === stepKey) return;
    currentWaiverStepRef.current = stepKey;

    const timer = setTimeout(async () => {
      try {
        let shouldFinish = false;
        const devCount = (tState.developmentPicks || []).length;
        const pickCount = (tState.picks || []).length;

        if (isDevMode) {
          shouldFinish = evaluateDevFinished(currentWaiverTeam.id, devCount);
        } else {
          shouldFinish = evaluateRegularFinished(pickCount);
        }

        const existingTeamPicks = isDevMode ? (tState.developmentPicks || []) : (tState.picks || []);
        const chosenProspect = shouldFinish ? null : selectAiProspect(
          sortedProspects,
          allConfirmedPlayerIds,
          existingTeamPicks,
          teamProfiles[currentWaiverTeam.id],
          false,
          false,
          isDevMode
        );

        if (!chosenProspect || shouldFinish) {
          await setDoc(doc(db, "draft_rooms", "default_room"), {
            ...roomData,
            isDraftStarted: true,
            announcement: {
              active: true,
              stepIndex: 0,
              queue: [currentWaiverTeam.id],
              isWaiverSingle: true,
              isFinishingPick: true
            }
          });
        } else {
          const updatedTeams = {
            ...teamsState,
            [currentWaiverTeam.id]: {
              ...tState,
              secretBid: {
                id: chosenProspect.id,
                name: chosenProspect.name,
                position: chosenProspect.position,
                affiliation: chosenProspect.affiliation,
                rank: chosenProspect.rank,
                category: chosenProspect.category || "",
                description: chosenProspect.description || ""
              }
            }
          };
          await setDoc(doc(db, "draft_rooms", "default_room"), {
            ...roomData,
            isDraftStarted: true,
            teams: updatedTeams,
            announcement: {
              active: true,
              stepIndex: 0,
              queue: [currentWaiverTeam.id],
              isWaiverSingle: true,
              isFinishingPick: false
            }
          });
        }
      } catch (err) {
        console.error("CPU Waiver Selection Error:", err);
        // エラー発生時も思考停止しないよう安全に次へ
        advanceWaiverTurn(teamsState, roomData.waiverCurrentIndex || 0, false);
      }
    }, 850);

    return () => clearTimeout(timer);
  }, [
    currentRound,
    currentWaiverTeam?.id,
    roomData.waiverCurrentIndex,
    announcement,
    isHost,
    teamProfiles,
    isDevMode,
    teamsState,
    roomData.isDraftStarted,
    sortedProspects,
    allConfirmedPlayerIds
  ]);

  useEffect(() => {
    if (announcement && announcement.active) {
      setIsPlayerRevealed(false);
      const timer = setTimeout(() => {
        setIsPlayerRevealed(true);
      }, 800);
      return () => clearTimeout(timer);
    } else {
      setIsPlayerRevealed(false);
    }
  }, [announcement?.stepIndex, announcement?.active]);

  const filteredAndSortedProspects = useMemo(() => {
    let pool = sortedProspects;
    if (isDevMode) {
      pool = pool.filter((p) => !isRestrictedForDevelopment(p));
    }

    return pool.filter((p) => {
      if (!p) return false;

      if (filterCategory !== "ALL") {
        if (filterCategory === "独立リーグ") {
          if (!isIndependentLeague(p)) return false;
        } else if (filterCategory === "社会人") {
          if (!isPureCorporatePlayer(p)) return false;
        } else if (filterCategory === "社会人・独立") {
          if (p.category !== "社会人" && p.category !== "社会人・独立") return false;
        } else if (filterCategory === "高校") {
          if (p.category !== "高校") return false;
        } else if (filterCategory === "大学") {
          if (p.category !== "大学") return false;
        } else if (p.category !== filterCategory) {
          return false;
        }
      }

      if (filterPos !== "ALL" && p.position !== filterPos) return false;

      if (filterPos === "投手") {
        if (filterThrow !== "ALL" && p.throwsHand !== filterThrow) return false;
        if (filterRole !== "ALL" && p.pitcherRole !== filterRole) return false;
      }
      if (filterPos === "内野手") {
        if (filterSubPos !== "ALL" && p.subPosition !== filterSubPos) return false;
      }
      if (filterPos === "捕手" || filterPos === "内野手" || filterPos === "外野手") {
        if (filterBatterType !== "ALL" && p.batterType !== filterBatterType) return false;
        if (filterBatsHand !== "ALL" && p.batsHand !== filterBatsHand) return false;
      }
      return true;
    });
  }, [sortedProspects, filterCategory, filterPos, filterThrow, filterRole, filterSubPos, filterBatterType, filterBatsHand, isDevMode]);

  const resetFilters = () => {
    setFilterCategory("ALL");
    setFilterPos("ALL");
    setFilterThrow("ALL");
    setFilterRole("ALL");
    setFilterSubPos("ALL");
    setFilterBatterType("ALL");
    setFilterBatsHand("ALL");
  };

  const handleConfirmBidRound1 = async (userProspect) => {
    if (!selectingTeam) return;

    const newTeams = { ...teamsState };
    newTeams[selectingTeam.id] = {
      ...newTeams[selectingTeam.id],
      isSubmitted: true,
      isConfirmed: false,
      confirmedPlayer: null,
      secretBid: {
        id: userProspect.id,
        name: userProspect.name,
        position: userProspect.position,
        affiliation: userProspect.affiliation,
        rank: userProspect.rank,
        category: userProspect.category || "",
        description: userProspect.description || ""
      }
    };

    if (isHost) {
      const isSub = roomData.subRound > 1;
      baseTeamsList.forEach((team) => {
        if (!newTeams[team.id]?.ownerId && !newTeams[team.id]?.isConfirmed && !newTeams[team.id]?.isSubmitted) {
          const aiProspect = selectAiProspect(sortedProspects, allConfirmedPlayerIds, [], teamProfiles[team.id], true, isSub, false);
          if (aiProspect) {
            newTeams[team.id] = {
              ...newTeams[team.id],
              isSubmitted: true,
              isConfirmed: false,
              confirmedPlayer: null,
              secretBid: {
                id: aiProspect.id,
                name: aiProspect.name,
                position: aiProspect.position,
                affiliation: aiProspect.affiliation,
                rank: aiProspect.rank,
                category: aiProspect.category || "",
                description: aiProspect.description || ""
              }
            };
          }
        }
      });
    }

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      teams: newTeams
    });
    setSelectingTeam(null);
  };

  const handlePickWaiver = async (prospect) => {
    if (!currentWaiverTeam) return;

    const targetTeam = currentWaiverTeam;
    const currentT = teamsState[targetTeam.id] || {};
    const newTeams = {
      ...teamsState,
      [targetTeam.id]: {
        ...currentT,
        secretBid: {
          id: prospect.id,
          name: prospect.name,
          position: prospect.position,
          affiliation: prospect.affiliation,
          rank: prospect.rank,
          category: prospect.category || "",
          description: prospect.description || ""
        }
      }
    };

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      teams: newTeams,
      announcement: {
        active: true,
        stepIndex: 0,
        queue: [targetTeam.id],
        isWaiverSingle: true,
        isFinishingPick: false
      }
    });

    setSelectingTeam(null);
  };

  const handleFinishWaiverPick = async () => {
    if (!currentWaiverTeam) return;

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      announcement: {
        active: true,
        stepIndex: 0,
        queue: [currentWaiverTeam.id],
        isWaiverSingle: true,
        isFinishingPick: true
      }
    });
  };

  const handleStartDevelopmentDraft = async () => {
    try {
      const cleanTeams = {};
      baseTeamsList.forEach((team) => {
        const prevT = teamsState[team.id] || {};
        cleanTeams[team.id] = {
          ...prevT,
          isSubmitted: false,
          isConfirmed: false,
          secretBid: null,
          confirmedPlayer: null,
          picks: Array.isArray(prevT.picks) ? prevT.picks : [],
          developmentPicks: Array.isArray(prevT.developmentPicks) ? prevT.developmentPicks : [],
          isFinished: true,
          isDevFinished: false
        };
      });

      currentWaiverStepRef.current = "";

      const updatedPayload = {
        ...roomData,
        isDraftStarted: true,
        isDevelopmentMode: true,
        round: 1,
        phase: "WAIVER",
        subRound: 1,
        waiverCurrentIndex: 0,
        teams: cleanTeams,
        announcement: null,
        lottery: null
      };

      setRoomData(updatedPayload);
      await setDoc(doc(db, "draft_rooms", "default_room"), updatedPayload);
    } catch (err) {
      console.error("Failed to start development draft:", err);
      alert("育成ドラフトの開始に失敗しました。もう一度お試しください。");
    }
  };

  const handleStartAnnouncement = async () => {
    const queue = baseTeamsList.filter((t) => !teamsState[t.id]?.isConfirmed && teamsState[t.id]?.isSubmitted).map((t) => t.id);

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      announcement: {
        active: true,
        stepIndex: 0,
        queue,
        isWaiverSingle: false,
        isFinishingPick: false
      }
    });
  };

  const handleNextAnnouncementStep = async () => {
    if (!announcement || !announcement.active) return;

    if (announcement.isWaiverSingle) {
      const targetTeamId = announcement.queue[0];
      const targetT = teamsState[targetTeamId] || {};

      if (announcement.isFinishingPick) {
        const updatedTeams = {
          ...teamsState,
          [targetTeamId]: {
            ...targetT,
            isFinished: isDevMode ? targetT.isFinished : true,
            isDevFinished: isDevMode ? true : targetT.isDevFinished
          }
        };
        await advanceWaiverTurn(updatedTeams, roomData.waiverCurrentIndex || 0, false);
      } else {
        const pickedPlayer = targetT.secretBid;

        if (isDevMode) {
          const currentDevPicks = Array.isArray(targetT.developmentPicks) ? targetT.developmentPicks : [];
          const updatedTeams = {
            ...teamsState,
            [targetTeamId]: {
              ...targetT,
              developmentPicks: [...currentDevPicks, { round: currentRound, player: pickedPlayer }],
              secretBid: null
            }
          };
          await advanceWaiverTurn(updatedTeams, roomData.waiverCurrentIndex || 0, true);
        } else {
          const currentPicks = Array.isArray(targetT.picks) ? targetT.picks : [];
          const updatedTeams = {
            ...teamsState,
            [targetTeamId]: {
              ...targetT,
              picks: [...currentPicks, { round: currentRound, player: pickedPlayer }],
              secretBid: null
            }
          };
          await advanceWaiverTurn(updatedTeams, roomData.waiverCurrentIndex || 0, true);
        }
      }
      return;
    }

    const nextIndex = announcement.stepIndex + 1;
    if (nextIndex < announcement.queue.length) {
      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        announcement: {
          ...announcement,
          stepIndex: nextIndex
        }
      });
    } else {
      await finalizeRevealRound1();
    }
  };

  const finalizeRevealRound1 = async () => {
    const bidsByPlayer = {};
    baseTeamsList.forEach((team) => {
      const t = teamsState[team.id];
      if (t && !t.isConfirmed && t.secretBid) {
        const pid = t.secretBid.id;
        if (!bidsByPlayer[pid]) bidsByPlayer[pid] = [];
        bidsByPlayer[pid].push(team.id);
      }
    });

    const newTeams = { ...teamsState };

    for (const pid in bidsByPlayer) {
      const teamIds = bidsByPlayer[pid];
      if (teamIds.length === 1) {
        const tid = teamIds[0];
        const player = newTeams[tid].secretBid;
        const currentPicks = Array.isArray(newTeams[tid].picks) ? newTeams[tid].picks : [];
        newTeams[tid] = {
          ...newTeams[tid],
          isConfirmed: true,
          confirmedPlayer: player,
          picks: [...currentPicks, { round: 1, player }],
          secretBid: null,
          isSubmitted: false
        };
      }
    }

    const hasConflicts = Object.values(bidsByPlayer).some((teamIds) => teamIds.length > 1);
    const remainingUnconfirmed = baseTeamsList.filter((t) => !newTeams[t.id]?.isConfirmed).length;

    if (!hasConflicts && remainingUnconfirmed > 0) {
      baseTeamsList.forEach((team) => {
        if (!newTeams[team.id]?.isConfirmed) {
          newTeams[team.id] = {
            ...newTeams[team.id],
            isSubmitted: false,
            secretBid: null
          };
        }
      });

      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        phase: "BIDDING",
        subRound: (roomData.subRound || 1) + 1,
        teams: newTeams,
        lottery: null,
        announcement: null
      });
      return;
    }

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      phase: "REVEALED",
      teams: newTeams,
      announcement: null
    });
  };

  const handleProceedToRound2 = async () => {
    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      round: 2,
      phase: "WAIVER",
      waiverCurrentIndex: 0,
      announcement: null,
      lottery: null
    });
  };

  const initLottery = async (group) => {
    const count = group.teams.length;
    const winningEnvelopeIndex = Math.floor(Math.random() * count);
    const envelopes = Array.from({ length: count }, (_, i) => ({
      index: i,
      chosenByTeamId: null,
      isWinner: i === winningEnvelopeIndex
    }));

    currentLotteryStepRef.current = "";

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      lottery: {
        player: group.player,
        contenderIds: group.teams.map((t) => t.id),
        envelopes,
        currentPickerIndex: 0,
        isOpened: false
      }
    });
  };

  const handlePickEnvelope = async (envelopeIndex) => {
    const currentLottery = roomData.lottery;
    if (!currentLottery || currentLottery.isOpened) return;

    const currentTeamId = currentLottery.contenderIds[currentLottery.currentPickerIndex];
    const updatedEnvelopes = currentLottery.envelopes.map((env) => {
      if (env.index === envelopeIndex) return { ...env, chosenByTeamId: currentTeamId };
      return env;
    });

    const nextIndex = currentLottery.currentPickerIndex + 1;
    const isCompleted = nextIndex >= currentLottery.contenderIds.length;

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      lottery: {
        ...currentLottery,
        envelopes: updatedEnvelopes,
        currentPickerIndex: nextIndex,
        isOpened: false
      }
    });

    if (isCompleted) {
      setTimeout(async () => {
        await setDoc(doc(db, "draft_rooms", "default_room"), {
          ...roomData,
          isDraftStarted: true,
          lottery: {
            ...currentLottery,
            envelopes: updatedEnvelopes,
            currentPickerIndex: nextIndex,
            isOpened: true
          }
        });
      }, 900);
    }
  };

  const handleApplyLotteryResult = async () => {
    if (!lottery || !lottery.isOpened) return;

    const winningEnvelope = lottery.envelopes.find((e) => e.isWinner);
    const winnerId = winningEnvelope?.chosenByTeamId;
    const newTeams = { ...teamsState };

    if (winnerId && newTeams[winnerId]) {
      const currentPicks = Array.isArray(newTeams[winnerId].picks) ? newTeams[winnerId].picks : [];
      newTeams[winnerId] = {
        ...newTeams[winnerId],
        isConfirmed: true,
        confirmedPlayer: lottery.player,
        picks: [...currentPicks, { round: 1, player: lottery.player }],
        secretBid: null,
        isSubmitted: false
      };
    }

    lottery.contenderIds.forEach((tid) => {
      if (tid !== winnerId && newTeams[tid]) {
        newTeams[tid] = {
          ...newTeams[tid],
          isSubmitted: false,
          secretBid: null
        };
      }
    });

    const remainingBids = {};
    baseTeamsList.forEach((team) => {
      const t = newTeams[team.id];
      if (t && !t.isConfirmed && t.secretBid) {
        const pid = t.secretBid.id;
        if (!remainingBids[pid]) remainingBids[pid] = [];
        remainingBids[pid].push(team.id);
      }
    });
    const stillHasConflicts = Object.values(remainingBids).some((arr) => arr.length > 1);
    const remainingUnconfirmed = baseTeamsList.filter((t) => !newTeams[t.id]?.isConfirmed).length;

    currentLotteryStepRef.current = "";

    if (!stillHasConflicts && remainingUnconfirmed > 0) {
      baseTeamsList.forEach((team) => {
        if (!newTeams[team.id]?.isConfirmed) {
          newTeams[team.id] = {
            ...newTeams[team.id],
            isSubmitted: false,
            secretBid: null
          };
        }
      });

      await setDoc(doc(db, "draft_rooms", "default_room"), {
        ...roomData,
        isDraftStarted: true,
        phase: "BIDDING",
        subRound: (roomData.subRound || 1) + 1,
        teams: newTeams,
        lottery: null
      });
      return;
    }

    await setDoc(doc(db, "draft_rooms", "default_room"), {
      ...roomData,
      isDraftStarted: true,
      phase: "REVEALED",
      teams: newTeams,
      lottery: null
    });
  };

  const handleResetAll = async () => {
    if (!window.confirm("部屋を初期化し全員の選択をリセットしますか？")) return;
    currentLotteryStepRef.current = "";
    currentWaiverStepRef.current = "";
    currentCpuOnlyBiddingSubRoundRef.current = 0;
    setDraftStandings(null);
    setDraftProfiles(null);
    await setDoc(doc(db, "draft_rooms", "default_room"), getEmptyState());
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (announcement && announcement.active && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        handleNextAnnouncementStep();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const unconfirmedTeams = baseTeamsList.filter((t) => !teamsState[t.id]?.isConfirmed);
  const unsubmittedTeams = unconfirmedTeams.filter((t) => !teamsState[t.id]?.isSubmitted);
  const isAllSubmittedRound1 = unconfirmedTeams.length > 0 && unsubmittedTeams.length === 0;
  const isRound1Completed = unconfirmedTeams.length === 0;

  const isAllRegularFinished = useMemo(() => {
    if (baseTeamsList.length === 0) return false;
    return baseTeamsList.every((t) => !!teamsState[t.id]?.isFinished);
  }, [baseTeamsList, teamsState]);

  const currentPickingTeamLottery = lottery && !lottery.isOpened && lottery.currentPickerIndex < lottery.contenderIds.length
    ? baseTeamsList.find((t) => t.id === lottery.contenderIds[lottery.currentPickerIndex])
    : null;

  const currentAnnouncingTeam = announcement && announcement.active && announcement.queue
    ? baseTeamsList.find((t) => t.id === announcement.queue[announcement.stepIndex])
    : null;
  const currentAnnouncingPlayer = currentAnnouncingTeam ? teamsState[currentAnnouncingTeam.id]?.secretBid : null;
  const isAnnouncingFinish = !!announcement?.isFinishingPick;

  const conflictGroups = useMemo(() => {
    if (!isRevealed || currentRound >= 2 || isDevMode) return [];
    const map = {};
    baseTeamsList.forEach((team) => {
      const t = teamsState[team.id];
      if (t && !t.isConfirmed && t.secretBid) {
        const pid = t.secretBid.id;
        if (!map[pid]) map[pid] = { player: t.secretBid, teams: [] };
        map[pid].teams.push(team);
      }
    });
    return Object.values(map).filter((g) => g.teams.length > 1);
  }, [teamsState, isRevealed, currentRound, baseTeamsList, isDevMode]);

  // ==========================================
  // ① 画面：ロビー画面
  // ==========================================
  if (!roomData.isDraftStarted) {
    const previewOrder = roomData.standings
      ? calculateWaiverOrder(roomData.standings.central, roomData.standings.pacific)
      : null;

    return (
      <div style={{ backgroundColor: "#0b1329", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "40px 20px", color: "#ffffff", fontFamily: '"Hiragino Kaku Gothic ProN", "Meiryo", sans-serif' }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <div style={{ fontSize: "14px", fontWeight: "bold", color: "#ef4444", letterSpacing: "2px", marginBottom: "4px" }}>2026 NPB MULTI-PLAYER DRAFT</div>
          <h1 style={{ fontSize: "32px", fontWeight: "900", margin: "0 0 8px", letterSpacing: "1px" }}>オンライン対戦 ロビー ＆ 球団エントリー</h1>
          <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0, maxWidth: "750px", lineHeight: "1.5" }}>
            参加者全員で同じURLを開き、担当したい球団をタップしてエントリーしてください。
            誰も選ばなかった球団は自動的にAI（CPU）が担当します。
          </p>
        </div>

        {/* プレイヤー名設定 */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "#1e293b", padding: "10px 20px", borderRadius: "8px", border: "1px solid #334155", marginBottom: "20px" }}>
          <span style={{ fontSize: "13px", color: "#94a3b8", fontWeight: "bold" }}>あなたの表示名:</span>
          <input
            type="text"
            value={myPlayerName}
            onChange={(e) => {
              setMyPlayerName(e.target.value);
              localStorage.setItem("npb_draft_player_name", e.target.value);
            }}
            style={{ padding: "6px 12px", borderRadius: "4px", border: "1px solid #475569", backgroundColor: "#0f172a", color: "#fff", fontSize: "14px", fontWeight: "bold", outline: "none" }}
          />
          <span style={{ fontSize: "11px", color: "#64748b" }}>(端末ID: {myPlayerId.substring(0, 6)})</span>
        </div>

        {/* ホスト操作領域 */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
          {isHost ? (
            <>
              <button
                onClick={handleGenerateRandomStandings}
                style={{ padding: "12px 28px", backgroundColor: roomData.standings ? "#334155" : "#2563eb", color: "#ffffff", border: "none", borderRadius: "30px", fontSize: "14px", fontWeight: "900", cursor: "pointer" }}
              >
                🎲 {roomData.standings ? "ペナント順位・戦力を再生成" : "ペナント順位と戦力を出力"}
              </button>

              {roomData.standings && (
                <button
                  onClick={handleStartDraftMeeting}
                  style={{ padding: "12px 36px", backgroundColor: "#16a34a", color: "#ffffff", border: "none", borderRadius: "30px", fontSize: "15px", fontWeight: "900", cursor: "pointer", boxShadow: "0 4px 14px rgba(22,163,74,0.4)" }}
                >
                  🚀 ドラフト会議を開始する ▶
                </button>
              )}
            </>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 20px", backgroundColor: "#1e293b", borderRadius: "20px", border: "1px solid #334155" }}>
              👑 ホストがドラフト会議を開始するのを待機しています...
            </div>
          )}
        </div>

        {/* 12球団選択グリッド */}
        {roomData.standings && roomData.teamProfiles && (
          <div style={{ width: "100%", maxWidth: "1200px", marginBottom: "30px" }}>
            <div style={{ backgroundColor: "#1e293b", padding: "12px 18px", borderRadius: "6px", border: "1px solid #475569", marginBottom: "24px", textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", fontWeight: "bold", marginBottom: "6px" }}>
                ウェーバー順 (偶数年セ最下位優先):
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: "6px", flexWrap: "wrap", fontSize: "12px" }}>
                {previewOrder.map((t, idx) => (
                  <span key={t.id} style={{ backgroundColor: "#0f172a", padding: "3px 8px", borderRadius: "4px", border: "1px solid #334155" }}>
                    {idx + 1}. {t.name}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "900", marginBottom: "14px", color: "#f8fafc" }}>
                担当したい球団をタップしてください（複数選択可 / 空き球団はCPU担当）
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "10px" }}>
                {[...roomData.standings.central, ...roomData.standings.pacific].map((team) => {
                  const tState = teamsState[team.id] || {};
                  const isMine = tState.ownerId === myPlayerId;
                  const isClaimedByOther = tState.ownerId && !isMine;

                  return (
                    <button
                      key={team.id}
                      onClick={() => handleToggleClaimTeam(team.id)}
                      style={{
                        backgroundColor: isMine ? "#f59e0b" : (isClaimedByOther ? "#334155" : "#1e293b"),
                        color: isMine ? "#000" : "#ffffff",
                        border: isMine ? "2px solid #fbbf24" : "1px solid #475569",
                        borderRadius: "8px",
                        padding: "12px 6px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "3px",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <span style={{ fontSize: "10px", color: isMine ? "#78350f" : "#94a3b8" }}>
                        {team.league === "central" ? "セ" : "パ"}・{team.rank}位
                      </span>
                      <span style={{ fontSize: "16px", fontWeight: "900" }}>{team.name}</span>
                      <span style={{
                        fontSize: "11px",
                        fontWeight: "bold",
                        backgroundColor: isMine ? "#78350f" : (isClaimedByOther ? "#1e293b" : "#0f172a"),
                        color: isMine ? "#fef3c7" : (isClaimedByOther ? "#cbd5e1" : "#94a3b8"),
                        padding: "2px 8px",
                        borderRadius: "10px",
                        marginTop: "2px"
                      }}>
                        {isMine ? "あなた" : (isClaimedByOther ? tState.ownerName : "CPU")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
              {[...roomData.standings.central, ...roomData.standings.pacific].map((team) => (
                <TeamAnalysisTable
                  key={team.id}
                  teamId={team.id}
                  fullName={team.fullName}
                  standings={roomData.standings}
                  profile={roomData.teamProfiles[team.id]}
                  isUser={teamsState[team.id]?.ownerId === myPlayerId}
                  ownerName={teamsState[team.id]?.ownerName}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // ② 画面：ドラフト会議 本番
  // ==========================================
  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh", padding: "20px 10px", fontFamily: '"Hiragino Kaku Gothic ProN", "Meiryo", sans-serif' }}>
      
      {/* 巡目常時表示バナー */}
      <div style={{
        maxWidth: "840px",
        margin: "0 auto 12px",
        backgroundColor: isDevMode ? "#065f46" : (currentRound === 1 ? "#1e293b" : "#1d4ed8"),
        color: "#ffffff",
        padding: "10px 20px",
        borderRadius: "8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{
            backgroundColor: isDevMode ? "#10b981" : "#ef4444",
            color: "#fff",
            padding: "3px 10px",
            borderRadius: "4px",
            fontSize: "12px",
            fontWeight: "900",
            letterSpacing: "1px"
          }}>
            {isDevMode ? "育成ドラフト" : "支配下"}
          </span>
          <span style={{ fontSize: "20px", fontWeight: "900", letterSpacing: "1px" }}>
            {isDevMode
              ? `育成第${currentRound}巡目 指名進行中`
              : (currentRound === 1
                ? `第1巡目 (${getRound1SubLabel(roomData.subRound)})`
                : `第${currentRound}巡目 指名進行中 (${currentRound % 2 === 0 ? "ウェーバー" : "逆ウェーバー"})`)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: "bold", backgroundColor: "rgba(255,255,255,0.15)", padding: "4px 12px", borderRadius: "20px" }}>
            担当: <span style={{ color: "#fef08a", fontSize: "14px" }}>
              {myAssignedTeamIds.length > 0
                ? myAssignedTeamIds.map((id) => ALL_TEAMS_MAP[id]?.name).join("・")
                : "なし (観戦)"}
            </span>
          </div>

          {currentWaiverTeam && (
            <div style={{ fontSize: "13px", fontWeight: "bold", backgroundColor: "rgba(0,0,0,0.25)", padding: "4px 12px", borderRadius: "20px" }}>
              手番: <span style={{ color: teamsState[currentWaiverTeam.id]?.ownerId === myPlayerId ? "#4ade80" : "#ffffff", fontSize: "14px" }}>
                {currentWaiverTeam.name} ({teamsState[currentWaiverTeam.id]?.ownerName || "CPU"})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 支配下指名終了時の特大告知 ＆ 育成開始バナー */}
      {!isDevMode && isAllRegularFinished && (
        <div style={{ maxWidth: "840px", margin: "0 auto 16px", padding: "16px 20px", backgroundColor: "#ecfdf5", border: "2px solid #10b981", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 4px 14px rgba(16,185,129,0.2)" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: "900", color: "#065f46" }}>
              🎉 全球団が支配下指名を終了（選択終了）しました！
            </div>
            <div style={{ fontSize: "12px", color: "#047857", marginTop: "2px" }}>
              育成ドラフト会議を開始できます（社会人・大卒上位野手不可、独立リーグ・高校生等は指名可能）。
            </div>
          </div>
          {isHost && (
            <button
              onClick={handleStartDevelopmentDraft}
              style={{ padding: "10px 24px", backgroundColor: "#059669", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "900", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.4)" }}
            >
              🌱 育成ドラフト会議へ進む ▶
            </button>
          )}
        </div>
      )}

      {/* 進行制御バー */}
      <div style={{ maxWidth: "840px", margin: "0 auto 16px", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc", padding: "8px 16px", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
        <div style={{ fontSize: "13px", color: "#475569" }}>
          {!isDevMode && currentRound === 1 ? (
            <span>
              未確定: <b style={{ color: "#111" }}>{unconfirmedTeams.length}</b> 球団 / 未提出: <b style={{ color: "#dc2626" }}>{unsubmittedTeams.length}</b> 球団
            </span>
          ) : (
            <span>
              残り指名参加球団: <b style={{ color: isDevMode ? "#059669" : "#2563eb" }}>{activeWaiverOrder.length}</b> / 12球団
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {!isDevMode && currentRound === 1 && !isRevealed && isAllSubmittedRound1 && isHost && (
            <button
              onClick={handleStartAnnouncement}
              style={{ padding: "6px 14px", backgroundColor: "#0284c7", color: "#fff", border: "none", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", cursor: "pointer", boxShadow: "0 2px 6px rgba(2,132,199,0.3)" }}
            >
              🎤 指名発表を開始 (ホスト)
            </button>
          )}

          {!isDevMode && currentRound === 1 && isRound1Completed && isHost && (
            <button
              onClick={handleProceedToRound2}
              style={{ padding: "6px 16px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", cursor: "pointer", boxShadow: "0 2px 6px rgba(22,163,74,0.3)" }}
            >
              第2巡目へ進む ▶
            </button>
          )}

          <button
            onClick={() => setActiveTab("BOARD")}
            style={{ fontSize: "11px", color: activeTab === "BOARD" ? "#fff" : "#334155", background: activeTab === "BOARD" ? "#1e293b" : "#e2e8f0", border: "1px solid #cbd5e1", padding: "5px 10px", cursor: "pointer", borderRadius: "4px", fontWeight: "bold" }}
          >
            🔲 ボード
          </button>
          <button
            onClick={() => setActiveTab("ANALYSIS")}
            style={{ fontSize: "11px", color: activeTab === "ANALYSIS" ? "#fff" : "#334155", background: activeTab === "ANALYSIS" ? "#1e293b" : "#e2e8f0", border: "1px solid #cbd5e1", padding: "5px 10px", cursor: "pointer", borderRadius: "4px", fontWeight: "bold" }}
          >
            📊 戦力分析
          </button>
          <button
            onClick={() => setActiveTab("HISTORY")}
            style={{ fontSize: "11px", color: activeTab === "HISTORY" ? "#fff" : "#334155", background: activeTab === "HISTORY" ? "#1e293b" : "#e2e8f0", border: "1px solid #cbd5e1", padding: "5px 10px", cursor: "pointer", borderRadius: "4px", fontWeight: "bold" }}
          >
            📋 指名一覧
          </button>

          {isHost && (
            <button onClick={handleResetAll} style={{ fontSize: "11px", color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", padding: "5px 8px", cursor: "pointer", borderRadius: "4px", fontWeight: "bold" }}>
              全体リセット
            </button>
          )}
        </div>
      </div>

      {/* 2巡目以降 / 育成 ウェーバー手番バー */}
      {(isDevMode || currentRound >= 2) && currentWaiverTeam && (
        <div style={{ maxWidth: "840px", margin: "0 auto 18px", padding: "12px 16px", backgroundColor: isDevMode ? "#ecfdf5" : "#eff6ff", border: isDevMode ? "1px solid #a7f3d0" : "1px solid #bfdbfe", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: "12px", color: isDevMode ? "#065f46" : "#1e40af", fontWeight: "bold" }}>
              {isDevMode ? `育成第${currentRound}巡目` : `第${currentRound}巡目`} 指名順 ({currentRound % 2 === 0 ? "正ウェーバー" : "逆ウェーバー"}):
            </span>
            <div style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
              {activeWaiverOrder.map((team, idx) => {
                const isCurrent = team.id === currentWaiverTeam.id;
                const isMine = teamsState[team.id]?.ownerId === myPlayerId;
                return (
                  <span
                    key={team.id}
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "3px",
                      backgroundColor: isCurrent ? (isDevMode ? "#059669" : "#2563eb") : (isMine ? "#fef3c7" : "#ffffff"),
                      color: isCurrent ? "#ffffff" : (isMine ? "#92400e" : "#475569"),
                      fontWeight: isCurrent || isMine ? "bold" : "normal",
                      border: isCurrent ? "1px solid #10b981" : "1px solid #cbd5e1"
                    }}
                  >
                    {idx + 1}. {team.name}{isMine ? "(自)" : ""}
                  </span>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            {teamsState[currentWaiverTeam.id]?.ownerId === myPlayerId ? (
              <>
                <button
                  onClick={() => {
                    resetFilters();
                    setSelectingTeam(currentWaiverTeam);
                  }}
                  style={{ backgroundColor: isDevMode ? "#059669" : "#2563eb", color: "#fff", border: "none", padding: "8px 18px", borderRadius: "4px", fontSize: "13px", fontWeight: "bold", cursor: "pointer" }}
                >
                  【あなたの手番】 指名する
                </button>

                <button
                  onClick={handleFinishWaiverPick}
                  style={{ backgroundColor: "#ffffff", color: "#dc2626", border: "1px solid #f87171", padding: "8px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", cursor: "pointer" }}
                >
                  選択終了
                </button>
              </>
            ) : (
              <div style={{ fontSize: "13px", color: "#64748b", fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🤖 {currentWaiverTeam.name} ({teamsState[currentWaiverTeam.id]?.ownerName || "CPU"}) の思案中...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1巡目 競合バナー */}
      {!isDevMode && currentRound === 1 && isRevealed && conflictGroups.length > 0 && !lottery && (
        <div style={{ maxWidth: "840px", margin: "0 auto 20px", padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px" }}>
          <div style={{ fontWeight: "bold", color: "#b91c1c", fontSize: "14px", marginBottom: "8px" }}>
            競合が発生しています！くじ引きを行ってください
          </div>
          {conflictGroups.map((g) => (
            <div key={g.player.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600" }}>
                {g.player.name} ({g.player.position}) ── {g.teams.map((t) => t.name).join("、")} ({g.teams.length}球団)
              </span>
              {isHost && (
                <button
                  onClick={() => initLottery(g)}
                  style={{ backgroundColor: "#dc2626", color: "#fff", border: "none", padding: "5px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", cursor: "pointer" }}
                >
                  くじ引き開始 (ホスト)
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 大会タイトル */}
      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <div style={{ display: "inline-flex", alignItems: "baseline", gap: "10px" }}>
          <span style={{ fontSize: "26px", fontWeight: "700" }}>2026</span>
          <span style={{ fontSize: "28px", fontWeight: "900", letterSpacing: "2px" }}>
            {isDevMode ? "プロ野球 育成ドラフト会議" : "プロ野球ドラフト会議"}
          </span>
          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", marginLeft: "4px" }}>
            <span style={{ fontSize: "8px", fontWeight: "700", color: "#e60012", lineHeight: 1 }}>supported by</span>
            <span style={{ fontSize: "15px", fontWeight: "900", color: "#e60012", fontStyle: "italic", lineHeight: 1.1 }}>リポビタンD</span>
          </div>
        </div>
      </div>

      {/* タブ表示 ①：指名ボード */}
      {activeTab === "BOARD" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 206px)", justifyContent: "center", gap: "18px 18px" }}>
          {baseTeamsList.map((team) => {
            const t = teamsState[team.id] || {};
            const regularPicks = Array.isArray(t.picks) ? t.picks : [];
            const devPicks = Array.isArray(t.developmentPicks) ? t.developmentPicks : [];

            let displayPlayer = null;
            let isConfirmedBadge = false;

            const isAnnouncingNow = !!(announcement && announcement.active);

            if (isAnnouncingNow) {
              if (isDevMode) {
                const roundPick = devPicks.find((p) => p && p.round === currentRound);
                displayPlayer = roundPick ? roundPick.player : null;
                isConfirmedBadge = !!displayPlayer;
              } else if (currentRound === 1) {
                if (t.isConfirmed && t.confirmedPlayer) {
                  displayPlayer = t.confirmedPlayer;
                  isConfirmedBadge = true;
                } else {
                  displayPlayer = null;
                  isConfirmedBadge = false;
                }
              } else {
                const roundPick = regularPicks.find((p) => p && p.round === currentRound);
                displayPlayer = roundPick ? roundPick.player : null;
                isConfirmedBadge = !!displayPlayer;
              }
            } else {
              if (isDevMode) {
                const roundPick = devPicks.find((p) => p && p.round === currentRound);
                displayPlayer = roundPick?.player || null;
                isConfirmedBadge = !!displayPlayer;
              } else if (currentRound === 1) {
                if (t.isConfirmed && t.confirmedPlayer) {
                  displayPlayer = t.confirmedPlayer;
                  isConfirmedBadge = true;
                } else if (isRevealed) {
                  displayPlayer = t.secretBid;
                  isConfirmedBadge = false;
                } else {
                  displayPlayer = null;
                  isConfirmedBadge = false;
                }
              } else {
                const roundPick = regularPicks.find((p) => p && p.round === currentRound);
                displayPlayer = roundPick?.player || null;
                isConfirmedBadge = !!displayPlayer;
              }
            }

            const isFinishedNow = isDevMode ? t.isDevFinished : t.isFinished;
            const isTurn = (isDevMode || currentRound >= 2) && currentWaiverTeam?.id === team.id;
            const isMine = t.ownerId === myPlayerId;

            return (
              <div
                key={team.id}
                style={{
                  width: "206px",
                  height: "232px",
                  boxSizing: "border-box",
                  border: isTurn ? (isDevMode ? "3px solid #059669" : "3px solid #2563eb") : (isMine ? "2px solid #f59e0b" : "1px solid #c9cbcf"),
                  backgroundColor: isFinishedNow ? "#f8fafc" : "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  boxShadow: isTurn ? "0 0 12px rgba(37, 99, 235, 0.4)" : (isMine ? "0 0 8px rgba(245,158,11,0.25)" : "none")
                }}
              >
                <div style={{ height: "28px", backgroundColor: isTurn ? (isDevMode ? "#a7f3d0" : "#bfdbfe") : (isMine ? "#fef3c7" : "#dce4f2"), borderBottom: "1px solid #c9cbcf", display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: "28px", height: "28px", backgroundColor: "#ffffff", borderRight: "1px solid #c9cbcf", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {team.logoUrl && <img src={team.logoUrl} alt={team.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: "bold", color: "#1f2937", marginLeft: "6px" }}>
                      {team.name}
                    </span>
                    <span style={{ fontSize: "10px", color: isMine ? "#d97706" : "#64748b", marginLeft: "4px" }}>
                      ({t.ownerName || "CPU"})
                    </span>
                  </div>
                  {isFinishedNow && (
                    <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "bold" }}>[選択終了]</span>
                  )}
                </div>

                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: "10px" }}>
                  {isFinishedNow && !displayPlayer ? (
                    <div style={{ fontSize: "13px", color: "#94a3b8", fontWeight: "bold" }}>選択終了</div>
                  ) : displayPlayer ? (
                    <>
                      <div style={{ fontSize: "11px", color: isDevMode ? "#059669" : "#2563eb", fontWeight: "bold", marginBottom: "2px" }}>
                        {isDevMode ? `育成第${currentRound}巡目` : `第${currentRound}巡目`}
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: "500", letterSpacing: "0.5px", color: "#000000", marginBottom: "4px" }}>
                        {displayPlayer.name}
                      </div>
                      <div style={{ fontSize: "11px", color: "#111111", letterSpacing: "0.5px" }}>
                        {displayPlayer.position} {displayPlayer.affiliation}
                      </div>
                      {isConfirmedBadge && (
                        <div style={{ marginTop: "6px", fontSize: "10px", color: isDevMode ? "#059669" : "#dc2626", fontWeight: "bold", border: `1px solid ${isDevMode ? "#059669" : "#dc2626"}`, padding: "1px 5px", borderRadius: "2px" }}>
                          交渉権確定
                        </div>
                      )}
                    </>
                  ) : !isDevMode && currentRound === 1 ? (
                    t.isSubmitted && !isRevealed ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "bold", color: "#0284c7" }}>✓ 入札済</div>
                        {isMine && (
                          <button
                            onClick={() => {
                              resetFilters();
                              setSelectingTeam(team);
                            }}
                            style={{ border: "1px solid #cbd5e1", backgroundColor: "#f8fafc", color: "#475569", fontSize: "11px", padding: "3px 10px", cursor: "pointer", borderRadius: "3px" }}
                          >
                            変更
                          </button>
                        )}
                      </div>
                    ) : isMine ? (
                      <button
                        onClick={() => {
                          resetFilters();
                          setSelectingTeam(team);
                        }}
                        style={{ border: "1px solid #2563eb", backgroundColor: "#2563eb", color: "#fff", fontSize: "13px", fontWeight: "bold", padding: "6px 20px", cursor: "pointer", borderRadius: "3px" }}
                      >
                        {getRound1SubLabel(roomData.subRound)}
                      </button>
                    ) : (
                      <div style={{ fontSize: "12px", color: "#94a3b8" }}>入札待機中</div>
                    )
                  ) : (
                    <div style={{ fontSize: "12px", color: isTurn ? (isDevMode ? "#059669" : "#2563eb") : "#94a3b8", fontWeight: "bold" }}>
                      {isTurn ? (isAnnouncingNow ? "発表中..." : (isMine ? "あなたの手番" : `${t.ownerName}の思考中...`)) : "待機中"}
                    </div>
                  )}
                </div>

                <div style={{ height: "36px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#e60012", fontSize: "19px", fontWeight: "900", fontStyle: "italic", letterSpacing: "-0.5px", transform: "scaleY(1.05)" }}>リポビタンD</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* タブ表示 ②：全12球団 WAR＆年齢 表形式一覧 */}
      {activeTab === "ANALYSIS" && (
        <div style={{ maxWidth: "1080px", margin: "0 auto", backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "20px" }}>
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "900", margin: "0 0 4px", color: "#0f172a" }}>
              全12球団 ポジション別WAR ＆ 主力平均年齢・補強ポイント一覧表
            </h2>
            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
              WARは基本 -1.0〜+2.0 付近で推移し、突出した強みや穴が稀に発生します。赤色は弱点・穴、黄色は高齢化を示します。
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
            {baseTeamsList.map((team) => (
              <TeamAnalysisTable
                key={team.id}
                teamId={team.id}
                fullName={team.fullName}
                standings={roomData.standings}
                profile={teamProfiles[team.id]}
                isUser={teamsState[team.id]?.ownerId === myPlayerId}
                ownerName={teamsState[team.id]?.ownerName}
              />
            ))}
          </div>
        </div>
      )}

      {/* タブ表示 ③：指名獲得選手一覧 */}
      {activeTab === "HISTORY" && (
        <div style={{ maxWidth: "900px", margin: "0 auto", backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", overflow: "hidden" }}>
          <div style={{ backgroundColor: "#1e293b", color: "#fff", padding: "12px 16px", fontWeight: "bold", fontSize: "14px" }}>
            球団別 指名獲得選手一覧 ({isDevMode ? `育成第${currentRound}巡目` : `支配下 第${currentRound}巡目`})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", padding: "16px" }}>
            {baseTeamsList.map((team) => {
              const picks = Array.isArray(teamsState[team.id]?.picks) ? teamsState[team.id].picks : [];
              const devPicks = Array.isArray(teamsState[team.id]?.developmentPicks) ? teamsState[team.id].developmentPicks : [];
              const isMine = teamsState[team.id]?.ownerId === myPlayerId;

              return (
                <div key={team.id} style={{ border: isMine ? "2px solid #f59e0b" : "1px solid #e2e8f0", borderRadius: "4px", padding: "10px", backgroundColor: isMine ? "#fffbeb" : "#ffffff" }}>
                  <div style={{ fontWeight: "bold", fontSize: "14px", color: "#0f172a", borderBottom: "2px solid #e2e8f0", paddingBottom: "4px", marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
                    <span>{team.fullName} <span style={{ fontSize: "11px", color: isMine ? "#d97706" : "#64748b" }}>({teamsState[team.id]?.ownerName || "CPU"})</span></span>
                    {isDevMode ? (
                      teamsState[team.id]?.isDevFinished && <span style={{ fontSize: "11px", color: "#059669" }}>[育成終了]</span>
                    ) : (
                      teamsState[team.id]?.isFinished && <span style={{ fontSize: "11px", color: "#ef4444" }}>[支配下終了]</span>
                    )}
                  </div>

                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "#1e3a8a", borderBottom: "1px solid #cbd5e1", paddingBottom: "2px" }}>
                      【支配下登録選手】 ({picks.length}名)
                    </div>
                    {picks.length === 0 ? (
                      <div style={{ fontSize: "11px", color: "#94a3b8", padding: "2px 0" }}>指名なし</div>
                    ) : (
                      picks.map((pick, i) => (
                        <div key={i} style={{ fontSize: "11px", padding: "2px 0", borderBottom: "1px dashed #f1f5f9", display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: "bold", color: "#2563eb", width: "42px" }}>{pick.round}位</span>
                          <span style={{ fontWeight: "bold", color: "#111", flex: 1 }}>{pick.player?.name}</span>
                          <span style={{ color: "#64748b" }}>{pick.player?.position} ({pick.player?.affiliation})</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "#065f46", borderBottom: "1px solid #a7f3d0", paddingBottom: "2px" }}>
                      【育成指名選手】 ({devPicks.length}名)
                    </div>
                    {devPicks.length === 0 ? (
                      <div style={{ fontSize: "11px", color: "#94a3b8", padding: "2px 0" }}>育成指名なし</div>
                    ) : (
                      devPicks.map((pick, i) => (
                        <div key={i} style={{ fontSize: "11px", padding: "2px 0", borderBottom: "1px dashed #f1f5f9", display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: "bold", color: "#059669", width: "52px" }}>育成{pick.round}位</span>
                          <span style={{ fontWeight: "bold", color: "#111", flex: 1 }}>{pick.player?.name}</span>
                          <span style={{ color: "#64748b" }}>{pick.player?.position} ({pick.player?.affiliation})</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 📺 ドラフト中継 ズーム演出 */}
      {announcement && announcement.active && currentAnnouncingTeam && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0, 0, 0, 0.85)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000
        }}>
          <div style={{
            width: "90vw",
            maxWidth: "960px",
            aspectRatio: "16 / 9",
            backgroundColor: "#ffffff",
            borderRadius: "4px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "40px 60px",
            boxSizing: "border-box",
            overflow: "hidden"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px", zIndex: 10 }}>
              <div style={{
                width: "90px",
                height: "56px",
                backgroundColor: "#e2e8f0",
                border: "1px solid #cbd5e1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                {currentAnnouncingTeam.logoUrl ? (
                  <img src={currentAnnouncingTeam.logoUrl} alt={currentAnnouncingTeam.name} style={{ width: "90%", height: "90%", objectFit: "contain" }} />
                ) : (
                  <span style={{ fontSize: "13px", fontWeight: "900", color: "#334155", letterSpacing: "1px" }}>
                    {currentAnnouncingTeam.name}
                  </span>
                )}
              </div>
              <span style={{ fontSize: "28px", fontWeight: "900", color: "#000000", letterSpacing: "1px" }}>
                {currentAnnouncingTeam.fullName || currentAnnouncingTeam.name}
              </span>
            </div>

            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "80%",
              textAlign: "center"
            }}>
              {!isPlayerRevealed ? (
                <div>
                  <div style={{ fontSize: "68px", fontWeight: "900", color: "#111827", letterSpacing: "6px" }}>
                    {currentAnnouncingTeam.fullName || currentAnnouncingTeam.name}
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: "bold", color: "#64748b", marginTop: "12px", letterSpacing: "2px" }}>
                    {isAnnouncingFinish
                      ? (isDevMode ? `育成第${currentRound}巡目` : `第${currentRound}巡目`)
                      : (isDevMode
                        ? `育成第${currentRound}巡目 選択希望選手`
                        : (currentRound === 1 && roomData.subRound > 1 ? `${getRound1SubLabel(roomData.subRound)} 選択希望選手` : `第${currentRound}巡目 選択希望選手`))}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {isAnnouncingFinish ? (
                    <div style={{
                      fontSize: "72px",
                      fontWeight: "900",
                      color: "#dc2626",
                      letterSpacing: "14px",
                      lineHeight: "1.1",
                      fontFamily: '"Hiragino Kaku Gothic ProN", "Meiryo", sans-serif'
                    }}>
                      選択終了
                    </div>
                  ) : currentAnnouncingPlayer ? (
                    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}>
                      <div style={{
                        fontSize: "64px",
                        fontWeight: "900",
                        color: "#000000",
                        letterSpacing: "12px",
                        lineHeight: "1.1",
                        marginBottom: "16px",
                        fontFamily: '"Hiragino Kaku Gothic ProN", "Meiryo", sans-serif'
                      }}>
                        {currentAnnouncingPlayer.name.replace(" ", " ")}
                      </div>
                      <div style={{ fontSize: "24px", fontWeight: "700", color: "#111827", letterSpacing: "2px", marginBottom: "6px" }}>
                        {currentAnnouncingPlayer.position}
                      </div>
                      <div style={{ fontSize: "24px", fontWeight: "700", color: "#111827", letterSpacing: "1px" }}>
                        {currentAnnouncingPlayer.affiliation}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "32px", color: "#94a3b8", fontWeight: "bold" }}>指名なし</div>
                  )}
                </div>
              )}
            </div>

            <div style={{ textAlign: "center", zIndex: 10 }}>
              <span style={{
                color: "#e60012",
                fontSize: "60px",
                fontWeight: "900",
                fontStyle: "italic",
                letterSpacing: "-2px",
                display: "inline-block",
                transform: "scaleY(1.08)"
              }}>
                リポビタンD
              </span>
            </div>
          </div>

          <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
            {isHost && (
              <button
                onClick={handleNextAnnouncementStep}
                style={{
                  padding: "10px 32px",
                  backgroundColor: isPlayerRevealed ? (isDevMode ? "#059669" : "#2563eb") : "#475569",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "24px",
                  fontSize: "14px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.4)"
                }}
              >
                {announcement.isWaiverSingle
                  ? (isAnnouncingFinish ? "選択終了を確定して次へ進む ▶" : `${isDevMode ? `育成第${currentRound}巡目` : `第${currentRound}巡目`} 指名を確定して次へ進む ▶`)
                  : (announcement.stepIndex + 1 < announcement.queue.length
                    ? `次の球団を発表 (${announcement.stepIndex + 1}/${announcement.queue.length}) ▶`
                    : "全指名の発表を完了 ▶")}
              </button>
            )}
            <span style={{ color: "#94a3b8", fontSize: "11px" }}>
              {isHost ? "(ホスト操作: Enterキー / スペースキーでも進められます)" : "ホストの進行を待機しています..."}
            </span>
          </div>
        </div>
      )}

      {/* 封筒選択・くじ引きモーダル */}
      {lottery && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ backgroundColor: "#fdfbf7", width: "90%", maxWidth: "850px", padding: "30px 24px", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ borderBottom: "2px solid #e2e8f0", paddingBottom: "14px", marginBottom: "24px" }}>
              <span style={{ fontSize: "13px", color: "#dc2626", fontWeight: "900" }}>第1巡目 重複抽選</span>
              <h2 style={{ fontSize: "26px", margin: "6px 0 10px", fontWeight: "900", color: "#0f172a" }}>
                {lottery.player?.name} 選手
              </h2>
              <div style={{ fontSize: "14px", color: "#475569" }}>
                競合球団: {lottery.contenderIds.map((tid) => ALL_TEAMS_MAP[tid]?.name).join("、")}
              </div>
            </div>

            <div style={{ marginBottom: "28px" }}>
              {!lottery.isOpened ? (
                currentPickingTeamLottery ? (
                  <div style={{ fontSize: "18px", fontWeight: "bold", color: "#1e3a8a", backgroundColor: "#eff6ff", padding: "10px 20px", borderRadius: "6px", display: "inline-block" }}>
                    【{currentPickingTeamLottery.name}】 {teamsState[currentPickingTeamLottery.id]?.ownerId === myPlayerId ? "好きな封筒をタップして選択してください" : `${teamsState[currentPickingTeamLottery.id]?.ownerName || "CPU"}が封筒を選んでいます...`}
                  </div>
                ) : null
              ) : (
                <div style={{ fontSize: "20px", fontWeight: "900", color: "#dc2626" }}>
                  🎉 交渉権獲得球団が決定しました！
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "24px", flexWrap: "wrap", minHeight: "260px" }}>
              {lottery.envelopes.map((env) => {
                const chosenTeam = env.chosenByTeamId ? ALL_TEAMS_MAP[env.chosenByTeamId] : null;
                const isSelected = !!env.chosenByTeamId;
                const isMyTurn = currentPickingTeamLottery && teamsState[currentPickingTeamLottery.id]?.ownerId === myPlayerId;

                return (
                  <div key={env.index} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    {!lottery.isOpened ? (
                      <div
                        onClick={() => {
                          if (!isSelected && isMyTurn) handlePickEnvelope(env.index);
                        }}
                        style={{
                          width: "110px",
                          height: "170px",
                          backgroundColor: isSelected ? "#e2e8f0" : "#fef3c7",
                          border: isSelected ? "2px solid #94a3b8" : "2px solid #d97706",
                          borderRadius: "4px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: isSelected || !isMyTurn ? "default" : "pointer"
                        }}
                      >
                        <div style={{ fontSize: "32px", marginBottom: "8px" }}>✉️</div>
                        <div style={{ fontSize: "13px", fontWeight: "bold", color: "#78350f" }}>封筒 {env.index + 1}</div>
                      </div>
                    ) : (
                      <div style={{ width: "140px", height: "185px", backgroundColor: "#fbfcf8", border: "1px solid #d1d5db", borderRadius: "3px", display: "flex", padding: "6px", boxSizing: "border-box" }}>
                        <div style={{ flex: 1, borderRight: "1px dashed #cbd5e1", backgroundColor: "#fafafa" }} />
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {env.isWinner && (
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <span style={{ writingMode: "vertical-rl", fontSize: "16px", fontWeight: "900", color: "#dc2626", letterSpacing: "4px" }}>交渉権獲得</span>
                              <div style={{ marginTop: "6px", width: "20px", height: "20px", border: "1.5px solid #dc2626", borderRadius: "50%", color: "#dc2626", fontSize: "9px", fontWeight: "900", display: "flex", alignItems: "center", justifyContent: "center" }}>印</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div style={{ marginTop: "10px", minHeight: "24px" }}>
                      {chosenTeam && (
                        <span style={{ backgroundColor: lottery.isOpened && env.isWinner ? "#dc2626" : "#1e293b", color: "#fff", fontSize: "12px", fontWeight: "bold", padding: "3px 10px", borderRadius: "4px" }}>
                          {chosenTeam.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {lottery.isOpened && isHost && (
              <div style={{ marginTop: "20px" }}>
                <button onClick={handleApplyLotteryResult} style={{ backgroundColor: "#1e293b", color: "#fff", border: "none", padding: "10px 30px", borderRadius: "4px", fontSize: "14px", fontWeight: "bold", cursor: "pointer" }}>
                  結果を確定して次へ (ホスト)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 選手選択モーダル */}
      {selectingTeam && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ backgroundColor: "#fff", width: "760px", maxHeight: "88vh", borderRadius: "6px", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: isDevMode ? "#ecfdf5" : "#f9fafb" }}>
              <div>
                <span style={{ fontSize: "17px", fontWeight: "bold", color: "#0f172a" }}>
                  【{selectingTeam.name}】 {isDevMode ? `育成第${currentRound}巡目 指名` : (currentRound === 1 ? (roomData.subRound > 1 ? `${getRound1SubLabel(roomData.subRound)}` : `第1巡目入札`) : `第${currentRound}巡目 指名`)}選手を選択
                </span>
                {isDevMode && (
                  <span style={{ marginLeft: "10px", fontSize: "11px", color: "#059669", fontWeight: "bold" }}>
                    [※育成規定: 社会人/大卒上位野手不可・独立/高校等は可]
                  </span>
                )}
              </div>
              <button onClick={() => setSelectingTeam(null)} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#666" }}>✕</button>
            </div>

            {/* フィルタ操作パネル */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: "8px", backgroundColor: "#fafafa" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                <span style={{ width: "65px", fontWeight: "bold", color: "#4b5563" }}>所属:</span>
                {(isDevMode ? ["ALL", "高校", "大学", "独立リーグ"] : ["ALL", "高校", "大学", "社会人・独立"]).map((cat) => (
                  <button key={cat} onClick={() => setFilterCategory(cat)} style={{ padding: "3px 8px", fontSize: "11px", borderRadius: "3px", border: "1px solid #ccc", cursor: "pointer", backgroundColor: filterCategory === cat ? "#1f2937" : "#fff", color: filterCategory === cat ? "#fff" : "#333" }}>
                    {cat === "ALL" ? "すべて" : cat}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
                <span style={{ width: "65px", fontWeight: "bold", color: "#4b5563" }}>守備位置:</span>
                {["ALL", "投手", "捕手", "内野手", "外野手"].map((pos) => (
                  <button key={pos} onClick={() => { setFilterPos(pos); setFilterThrow("ALL"); setFilterRole("ALL"); setFilterSubPos("ALL"); setFilterBatterType("ALL"); setFilterBatsHand("ALL"); }} style={{ padding: "3px 8px", fontSize: "11px", borderRadius: "3px", border: "1px solid #ccc", cursor: "pointer", backgroundColor: filterPos === pos ? "#1f2937" : "#fff", color: filterPos === pos ? "#fff" : "#333" }}>
                    {pos === "ALL" ? "すべて" : pos}
                  </button>
                ))}
              </div>

              {filterPos === "投手" && (
                <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "6px 10px", backgroundColor: "#eef2ff", borderRadius: "4px", fontSize: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontWeight: "bold", color: "#3730a3" }}>利き腕:</span>
                    {["ALL", "右", "左"].map((t) => (
                      <button key={t} onClick={() => setFilterThrow(t)} style={{ padding: "2px 6px", fontSize: "11px", borderRadius: "3px", border: "1px solid #a5b4fc", cursor: "pointer", backgroundColor: filterThrow === t ? "#3730a3" : "#fff", color: filterThrow === t ? "#fff" : "#333" }}>
                        {t === "ALL" ? "全" : `${t}投`}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontWeight: "bold", color: "#3730a3" }}>適性:</span>
                    {["ALL", "先発型", "リリーフ型", "万能型"].map((role) => (
                      <button key={role} onClick={() => setFilterRole(role)} style={{ padding: "2px 6px", fontSize: "11px", borderRadius: "3px", border: "1px solid #a5b4fc", cursor: "pointer", backgroundColor: filterRole === role ? "#3730a3" : "#fff", color: filterRole === role ? "#fff" : "#333" }}>
                        {role === "ALL" ? "全" : role}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filterPos === "内野手" && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", backgroundColor: "#fef3c7", borderRadius: "4px", fontSize: "12px" }}>
                  <span style={{ fontWeight: "bold", color: "#92400e" }}>定位置:</span>
                  {["ALL", "一", "二", "三", "遊"].map((sp) => (
                    <button key={sp} onClick={() => setFilterSubPos(sp)} style={{ padding: "2px 6px", fontSize: "11px", borderRadius: "3px", border: "1px solid #fcd34d", cursor: "pointer", backgroundColor: filterSubPos === sp ? "#92400e" : "#fff", color: filterSubPos === sp ? "#fff" : "#333" }}>
                      {sp === "ALL" ? "全" : sp}
                    </button>
                  ))}
                </div>
              )}

              {(filterPos === "捕手" || filterPos === "内野手" || filterPos === "外野手") && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "6px 10px", backgroundColor: "#f0fdf4", borderRadius: "4px", fontSize: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "42px", fontWeight: "bold", color: "#166534" }}>タイプ:</span>
                    {["ALL", "スラッガー", "好打", "走", "守備", "3ツール"].map((bt) => (
                      <button key={bt} onClick={() => setFilterBatterType(bt)} style={{ padding: "2px 6px", fontSize: "11px", borderRadius: "3px", border: "1px solid #86efac", cursor: "pointer", backgroundColor: filterBatterType === bt ? "#166534" : "#fff", color: filterBatterType === bt ? "#fff" : "#333" }}>
                        {bt === "ALL" ? "全" : bt}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "42px", fontWeight: "bold", color: "#166534" }}>打席:</span>
                    {["ALL", "右", "左", "両"].map((hand) => (
                      <button key={hand} onClick={() => setFilterBatsHand(hand)} style={{ padding: "2px 6px", fontSize: "11px", borderRadius: "3px", border: "1px solid #86efac", cursor: "pointer", backgroundColor: filterBatsHand === hand ? "#166534" : "#fff", color: filterBatsHand === hand ? "#fff" : "#333" }}>
                        {hand === "ALL" ? "全打席" : `${hand}打`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 候補選手リスト */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px" }}>
              {filteredAndSortedProspects.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: "#94a3b8", fontSize: "13px" }}>
                  該当する候補選手が見つかりません
                </div>
              ) : (
                filteredAndSortedProspects.map((p) => {
                  const isConfirmed = allConfirmedPlayerIds.includes(p.id);
                  const badge = RANK_COLORS[p.rank] || { bg: "#6b7280", text: "#fff" };

                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "12px 10px", borderBottom: "1px solid #f0f0f0", opacity: isConfirmed ? 0.35 : 1, gap: "16px" }}>
                      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", gap: "12px" }}>
                        <span style={{ backgroundColor: badge.bg, color: badge.text, fontSize: "11px", fontWeight: "900", padding: "2px 6px", borderRadius: "3px", minWidth: "24px", textAlign: "center", marginTop: "2px", flexShrink: 0 }}>
                          {p.rank}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                            <span style={{ fontWeight: "bold", fontSize: "15px", color: "#0f172a" }}>{p.name}</span>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              {p.category} / {p.position}{p.subPosition ? `(${p.subPosition})` : ""} / {p.throwsHand ? `${p.throwsHand}投${p.batsHand}打` : ""}
                              {p.pitcherRole ? ` / ${p.pitcherRole}` : ""}
                              {p.batterType ? ` / ${p.batterType}` : ""}
                              {" "}・ {p.affiliation}
                            </span>
                          </div>

                          {p.description && (
                            <div style={{ marginTop: "4px", fontSize: "12px", color: "#334155", lineHeight: "1.45", backgroundColor: "#f8fafc", padding: "6px 10px", borderRadius: "4px", borderLeft: "3px solid #cbd5e1" }}>
                              {p.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ flexShrink: 0, marginTop: "2px" }}>
                        {isConfirmed ? (
                          <span style={{ fontSize: "12px", color: "#9ca3af", fontWeight: "bold" }}>指名確定済</span>
                        ) : (
                          <button
                            onClick={() => (!isDevMode && currentRound === 1) ? handleConfirmBidRound1(p) : handlePickWaiver(p)}
                            style={{ backgroundColor: isDevMode ? "#059669" : "#0284c7", color: "#fff", border: "none", borderRadius: "3px", padding: "6px 16px", fontSize: "12px", fontWeight: "bold", cursor: "pointer" }}
                          >
                            {isDevMode ? "育成指名" : "指名"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}