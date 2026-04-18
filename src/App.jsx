import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, deleteDoc, getDoc, collection, query, getDocs, where, serverTimestamp, onSnapshot, increment, writeBatch } from 'firebase/firestore';

const CRIC_KEYS = ["c3c5ad69-4ca5-44b0-8313-1fc4362ed806", "eb4fcb6b-a26b-4594-9893-28412197c556", "64dcc6e7-c783-414b-9047-6abb463edec0", "d009046b-65c7-4ff3-abad-3e0a7f0574ca"];
const IPL_SERIES_ID = "87c62aac-bc3c-4738-ab93-19da0690488f";
const ADMIN_EMAIL = "dhavalranavasiya@gmail.com";

function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('matches');
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [matchDeck, setMatchDeck] = useState(null);
  const [allPicks, setAllPicks] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [matchHistory, setMatchHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adminPull, setAdminPull] = useState(20);
  const [totalCredits, setTotalCredits] = useState(null);
  const [adminIdentity, setAdminIdentity] = useState({ id: "", name: "" });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) { 
        loadMatchCache(); 
        loadLeaderboard(); 
        loadMatchHistory();
        if (u.email === ADMIN_EMAIL) fetchTotalCredits();
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedMatch) return;
    const q = query(collection(db, "match_picks"), where("matchId", "==", selectedMatch.id));
    return onSnapshot(q, (snap) => setAllPicks(snap.docs.map(d => d.data())));
  }, [selectedMatch]);

  const fetchTotalCredits = async () => {
    let sum = 0;
    for (let key of CRIC_KEYS) {
      try {
        const res = await fetch(`https://api.cricapi.com/v1/metadata?apikey=${key}`);
        const data = await res.json();
        if (data.status === 'success') {
          sum += (data.data.hitsLimit - data.data.hitsUsed);
        }
      } catch (e) { console.error("Ticker fetch fail"); }
    }
    setTotalCredits(sum);
  };

  const formatIST = (gmtStr) => {
    if (!gmtStr) return "TBD";
    const date = new Date(gmtStr.includes('Z') ? gmtStr : gmtStr.replace(' ', 'T') + 'Z'); 
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const loadMatchCache = async () => {
    const snap = await getDoc(doc(db, "system", "match_cache"));
    if (snap.exists()) {
      const allMatches = snap.data().list;
      const now = new Date();
      const todayISTStr = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

      if (auth.currentUser?.email === ADMIN_EMAIL) {
        const futureMatches = [];
        const pastMatches = [];
        allMatches.forEach(m => {
          const mDate = new Date(m.dateTimeGMT.replace(' ', 'T') + 'Z');
          if (mDate >= now) futureMatches.push(m);
          else pastMatches.push(m);
        });
        const sortByDate = (a, b) => new Date(a.dateTimeGMT.replace(' ', 'T') + 'Z') - new Date(b.dateTimeGMT.replace(' ', 'T') + 'Z');
        futureMatches.sort(sortByDate);
        pastMatches.sort(sortByDate);
        setMatches([...futureMatches, ...pastMatches]);
      } else {
        setMatches(allMatches.filter(m => {
          const mDate = new Date(m.dateTimeGMT.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
          return mDate === todayISTStr;
        }));
      }
    }
  };

  const loadLeaderboard = async () => {
    const snap = await getDocs(collection(db, "users"));
    setLeaderboard(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.totalPoints - a.totalPoints));
  };

  const loadMatchHistory = async () => {
    const q = query(collection(db, "active_matches"), where("settled", "==", true));
    const snap = await getDocs(q);
    const historyData = await Promise.all(snap.docs.map(async (d) => {
        const picksQ = query(collection(db, "match_picks"), where("matchId", "==", d.id));
        const picksSnap = await getDocs(picksQ);
        return { id: d.id, ...d.data(), allPicks: picksSnap.docs.map(p => p.data()) };
    }));
    setMatchHistory(historyData.sort((a,b) => b.updatedAt - a.updatedAt));
  };

  const updateSeasonPoint = async (userId, newVal) => {
    await setDoc(doc(db, "users", userId), { totalPoints: parseInt(newVal) || 0 }, { merge: true });
    loadLeaderboard();
  };

  const deletePick = async (pickId) => {
    if (window.confirm("Delete this pick?")) await deleteDoc(doc(db, "match_picks", pickId));
  };

  const resetCurrentMatch = async () => {
    if (!selectedMatch || user.email !== ADMIN_EMAIL) return;
    if (!window.confirm("Clear all picks for this match?")) return;
    const batch = writeBatch(db);
    const q = query(collection(db, "match_picks"), where("matchId", "==", selectedMatch.id));
    const snap = await getDocs(q);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    alert("Match Selections Cleared");
  };

  const toggleArchive = async () => {
    if (!selectedMatch || user.email !== ADMIN_EMAIL) return;
    const newState = !selectedMatch.settled;
    if (newState === false && !window.confirm("Unlock for edits?")) return;
    await setDoc(doc(db, "active_matches", selectedMatch.id), { settled: newState }, { merge: true });
    setSelectedMatch(prev => ({...prev, settled: newState}));
    loadMatchHistory();
  };

  const adminFetchMatches = async () => {
    if (user.email !== ADMIN_EMAIL) return;
    for (let key of CRIC_KEYS) {
      try {
        const res = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${key}&id=${IPL_SERIES_ID}`);
        const data = await res.json();
        if (data.status === 'success') {
          const list = (data.data.matchList || []);
          await setDoc(doc(db, "system", "match_cache"), { list, updatedAt: serverTimestamp() });
          loadMatchCache();
          fetchTotalCredits();
          alert("Fixtures Synced");
          return; 
        }
      } catch (e) { console.error(e); }
    }
  };

  const adminFetchScorecard = async () => {
    if (user.email !== ADMIN_EMAIL || selectedMatch?.settled) return;
    for (let key of CRIC_KEYS) {
      try {
        const res = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${key}&id=${selectedMatch.id}`);
        const data = await res.json();
        if (data.status === 'success' && data.data.scorecard) {
          const sc = data.data.scorecard;
          const parse = (inn) => (inn?.batting || []).slice(0, 9).map((b, i) => ({ 
            pos: i + 1, name: b.batsman?.name || b.name || "Not Played", runs: b.r || 0 
          }));

          // FIX: Preserve team mapping regardless of who bats first
          let scores = { inn1: [], inn2: [], updatedAt: new Date() };
          sc.forEach(obj => {
            if (obj.inning.includes(selectedMatch.t1)) scores.inn1 = parse(obj);
            else if (obj.inning.includes(selectedMatch.t2)) scores.inn2 = parse(obj);
          });
          if (scores.inn1.length === 0) scores.inn1 = parse(sc[0]);
          if (scores.inn2.length === 0) scores.inn2 = parse(sc[1]);

          await setDoc(doc(db, "active_matches", selectedMatch.id), { scores }, { merge: true });
          setSelectedMatch({ ...selectedMatch, scores });
          fetchTotalCredits();
          alert("Score Updated");
          return;
        }
      } catch (e) { console.error(e); }
    }
  };

  const calculateFinalPoints = (matchObj, picksArr) => {
    if (!matchObj?.scores || picksArr.length === 0) return [];
    let results = picksArr.map(p => {
      const s1 = matchObj.scores.inn1.find(s => s.pos === p.inn1Num);
      const s2 = matchObj.scores.inn2.find(s => s.pos === p.inn2Num);
      return { ...p, p1Name: s1?.name || "TBD", p2Name: s2?.name || "TBD", r1: s1?.runs || 0, r2: s2?.runs || 0, total: (s1?.runs || 0) + (s2?.runs || 0) };
    }).sort((a,b) => b.total - a.total);
    const pullUsed = matchObj.finalPull || adminPull;
    const remPot = (picksArr.length * pullUsed) - pullUsed; 
    let rank = 0;
    while (rank < results.length) {
      let tieGroup = results.filter(r => r.total === results[rank].total);
      let count = tieGroup.length;
      let startPos = rank;
      tieGroup.forEach(r => {
        if (startPos === 0) {
          if (count === 1) r.net = Math.round(remPot * 0.6) - pullUsed;
          else if (count === 2) r.net = Math.round(remPot / 2) - pullUsed;
          else r.net = Math.round((remPot + pullUsed) / count) - pullUsed;
        } else if (startPos === 1) {
          if (count === 1) r.net = Math.round(remPot * 0.4) - pullUsed;
          else r.net = Math.round((Math.round(remPot * 0.4) + pullUsed) / count) - pullUsed;
        } else if (startPos === 2) r.net = 0;
        else r.net = -pullUsed;
      });
      rank += count;
    }
    return results;
  };

  const submitToSeason = async () => {
    const res = calculateFinalPoints(selectedMatch, allPicks);
    if (user.email !== ADMIN_EMAIL || !selectedMatch?.scores || selectedMatch?.settled) return;
    if (!window.confirm(`Submit results?`)) return;
    for (let r of res) await setDoc(doc(db, "users", r.userId), { name: r.userName, totalPoints: increment(r.net) }, { merge: true });
    await setDoc(doc(db, "active_matches", selectedMatch.id), { settled: true, finalPull: adminPull, matchName: selectedMatch.name, dateText: formatIST(selectedMatch.dateTimeGMT), updatedAt: new Date() }, { merge: true });
    window.location.reload();
  };

  const nuclearReset = async () => {
    if (user.email !== ADMIN_EMAIL) return;
    if (!window.confirm("☢️ ERASE ALL?")) return;
    const cols = ['match_picks', 'active_matches', 'users'];
    for (const c of cols) {
      const snap = await getDocs(collection(db, c));
      const batch = writeBatch(db);
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    window.location.reload();
  };

  const handleSelectMatch = async (m) => {
    const matchRef = doc(db, "active_matches", m.id);
    let snap = await getDoc(matchRef);
    const data = snap.exists() ? snap.data() : { 
      inn1Deck: [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5), 
      inn2Deck: [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5),
      t1: m.teams?.[0] || "Team 1", t2: m.teams?.[1] || "Team 2"
    };
    if (!snap.exists()) await setDoc(matchRef, data);
    setMatchDeck(data);
    if (data.finalPull) setAdminPull(data.finalPull);
    setSelectedMatch({ ...m, ...data });
    setTab('play');
  };

  const lockCard = async (inn, idx) => {
    if (selectedMatch?.settled) return;
    const effectiveUID = adminIdentity.id || user.uid;
    const effectiveName = adminIdentity.name || user.displayName;
    if (allPicks.find(p => p.userId === effectiveUID)?.[`inn${inn}Card`] !== undefined) return;
    if (allPicks.some(p => p[`inn${inn}Card`] === idx)) return;
    await setDoc(doc(db, "match_picks", `${selectedMatch.id}_${effectiveUID}`), { userId: effectiveUID, userName: effectiveName, matchId: selectedMatch.id, [`inn${inn}Card`]: idx, [`inn${inn}Num`]: matchDeck[`inn${inn}Deck`][idx], timestamp: serverTimestamp() }, { merge: true });
  };

  const effectiveID = adminIdentity.id || user?.uid;
  const userHasFinished = allPicks.find(p => p.userId === effectiveID)?.inn1Card !== undefined && 
                          allPicks.find(p => p.userId === effectiveID)?.inn2Card !== undefined;

  if (loading) return <div style={styles.center}>🏏 ARENA LOADING...</div>;

  return (
    <div style={styles.container}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background: #07080f; color: #eee; }
        .pill { background: rgba(255,255,255,0.05); padding: 4px 12px; border-radius: 100px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: bold; border: 1px solid rgba(255,255,255,0.1); }
        .match-history-card { background: #13141f; border: 1px solid #252638; border-radius: 15px; padding: 20px; margin-bottom: 15px; cursor: pointer; transition: 0.3s; }
        .match-history-card:hover { border-color: #f0c040; box-shadow: 0 0 20px rgba(240,192,64,0.1); }
      `}</style>

      {!user ? (
        <div style={styles.authPage}><h1 style={styles.heroTitle}>ટ્રાફિકવાળાનો સટ્ટો</h1><button onClick={loginWithGoogle} style={styles.btnPrimary}>Login to Enter</button></div>
      ) : (
        <>
          <nav style={styles.tabs}>
            {['matches', 'play', 'results', 'season'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={tab === t ? styles.tabOn : styles.tabOff} disabled={!selectedMatch && (t === 'play' || t === 'results')}>{t.toUpperCase()}</button>
            ))}
            {user.email === ADMIN_EMAIL && <button onClick={() => setTab('data')} style={tab === 'data' ? styles.tabOn : styles.tabOff}>DATA</button>}
          </nav>

          {tab === 'matches' && (
            <section style={{padding: '0 15px'}}>
              {user.email === ADMIN_EMAIL && <button onClick={adminFetchMatches} style={styles.btnAdmin}>ADMIN: SYNC FIXTURES</button>}
              {matches.length === 0 ? <div style={{textAlign:'center', marginTop:'50px', color:'#52536e'}}>No matches scheduled today.</div> : 
                matches.map(m => {
                  const todayStr = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
                  const matchStr = new Date(m.dateTimeGMT.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
                  const isToday = todayStr === matchStr;
                  return (
                    <div key={m.id} onClick={() => handleSelectMatch(m)} style={{...styles.matchCard, border: isToday ? '1px solid #1fd18a' : '1px solid #252638', boxShadow: isToday ? '0 0 15px rgba(31,209,138,0.1)' : 'none'}}>
                      <div style={styles.matchMeta}>{isToday ? '🔥 PLAYING TODAY' : 'UPCOMING / PAST'}</div>
                      <b style={styles.matchTitle}>{m.name}</b>
                      <div style={styles.matchTime}>{formatIST(m.dateTimeGMT)}</div>
                    </div>
                  );
                })}
            </section>
          )}

          {tab === 'play' && selectedMatch && (
            <section style={{padding: '0 15px'}}>
              {user.email === ADMIN_EMAIL && !selectedMatch.settled && (
                <div style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
                  <div style={styles.testPanel}>
                    <span style={{fontSize:'10px', fontWeight:'900', color:'#f0c040'}}>ACT AS:</span>
                    <select style={styles.testSelect} onChange={(e) => { const v = e.target.value; if (!v) setAdminIdentity({id:"", name:""}); else { const [i, n] = v.split('|'); setAdminIdentity({id:i, name:n}); }}}>
                      <option value="">REAL PLAY (Hidden)</option>
                      {leaderboard.map(u => <option key={u.id} value={`${u.id}|${u.name}`}>{u.name}</option>)}
                    </select>
                  </div>
                  <button onClick={resetCurrentMatch} style={styles.btnResetSmall}>RESET MATCH</button>
                </div>
              )}
              <h3 style={styles.arenaTitle}>{selectedMatch.name}</h3>
              {selectedMatch.settled && <div style={styles.lockBadge}>🔒 MATCH ARCHIVED</div>}
              <div style={styles.teamHeaderBox}><span style={styles.teamLabel}>TEAM GREEN</span><h4 style={{...styles.teamNameText, color:'#1fd18a'}}>{selectedMatch.t1}</h4></div>
              <div style={styles.grid}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn1Card === i);
                  const isMe = p?.userId === effectiveID;
                  const showReveal = !p && adminIdentity.id !== "";
                  return <div key={i} onClick={() => !p && lockCard(1, i)} style={{...styles.cardComplex, background: p ? (isMe ? '#1fd18a' : 'rgba(31,209,138,0.1)') : '#13141f', borderColor: p ? '#1fd18a' : '#252638'}}>{p ? <><div style={{...styles.cardNumber, color: isMe ? '#000' : '#1fd18a'}}>#{p.inn1Num}</div><div style={{...styles.cardFriend, color: isMe ? '#000' : '#eee'}}>{p.userName.split(' ')[0]}</div></> : (showReveal ? <span style={{color:'#f0c040', fontSize:'22px', fontFamily:'Bebas Neue'}}>#{matchDeck.inn1Deck[i]}</span> : <div style={{fontSize: '24px'}}>🏏</div>)}</div>
                })}
              </div>
              {userHasFinished && <div style={{display:'flex', justifyContent:'center', margin:'30px 0'}}><button onClick={() => setTab('results')} style={styles.btnNavigate}>VIEW LIVE RESULTS →</button></div>}
              <div style={{...styles.teamHeaderBox, marginTop: userHasFinished ? '0' : '30px'}}><span style={styles.teamLabel}>TEAM RED</span><h4 style={{...styles.teamNameText, color:'#ff3d5a'}}>{selectedMatch.t2}</h4></div>
              <div style={styles.grid}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn2Card === i);
                  const isMe = p?.userId === effectiveID;
                  const showReveal = !p && adminIdentity.id !== "";
                  return <div key={i} onClick={() => !p && lockCard(2, i)} style={{...styles.cardComplex, background: p ? (isMe ? '#ff3d5a' : 'rgba(255,61,90,0.1)') : '#13141f', borderColor: p ? '#ff3d5a' : '#252638'}}>{p ? <><div style={{...styles.cardNumber, color: isMe ? '#000' : '#ff3d5a'}}>#{p.inn2Num}</div><div style={{...styles.cardFriend, color: isMe ? '#000' : '#eee'}}>{p.userName.split(' ')[0]}</div></> : (showReveal ? <span style={{color:'#f0c040', fontSize:'22px', fontFamily:'Bebas Neue'}}>#{matchDeck.inn2Deck[i]}</span> : <div style={{fontSize: '24px'}}>🏏</div>)}</div>
                })}
              </div>
            </section>
          )}

          {tab === 'results' && selectedMatch && (
            <section style={{padding: '0 15px'}}>
              {user.email === ADMIN_EMAIL && (
                <div style={styles.adminPanel}>
                   {selectedMatch.settled ? (
                     <button onClick={toggleArchive} style={{...styles.btnAction, background:'#ff3d5a'}}>⚠️ UNLOCK FOR EDITS</button>
                   ) : (
                     <>
                        <input type="number" value={adminPull} onChange={(e) => setAdminPull(parseInt(e.target.value))} style={styles.adminInput}/>
                        <button onClick={adminFetchScorecard} style={styles.btnAction}>SYNC</button>
                        <div style={styles.ticker}>Credits: {totalCredits ?? '...'}</div>
                        <button onClick={submitToSeason} style={{...styles.btnAction, background:'#1fd18a'}}>FINALIZE</button>
                     </>
                   )}
                </div>
              )}
              <div style={styles.podiumContainer}>
                {calculateFinalPoints(selectedMatch, allPicks).slice(0, 3).map((r, i) => (
                  <div key={i} style={{...styles.pod, order: i === 0 ? 2 : i === 1 ? 1 : 3, height: i === 0 ? '170px' : '140px', borderColor: i === 0 ? '#f0c040' : '#252638'}}>
                    <div style={{fontSize:'32px'}}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div><div style={styles.podName}>{r.userName}</div><div style={styles.podScore}>{r.total}</div><div style={{color: r.net >= 0 ? '#1fd18a' : '#ff3d5a', fontSize: '14px', fontWeight:'bold'}}>{r.net > 0 ? '+' : ''}{r.net}</div>
                  </div>
                ))}
              </div>
              <div style={styles.tableWrap}>
                <div style={styles.tableHeader}><div style={styles.colF}>FRIEND</div><div style={styles.colInn}>PLAYER 1</div><div style={styles.colR}>RUNS</div><div style={styles.colInn}>PLAYER 2</div><div style={styles.colR}>RUNS</div><div style={styles.colTot}>TOTAL</div></div>
                {calculateFinalPoints(selectedMatch, allPicks).map((p, i) => (
                  <div key={i} style={styles.tableRow}><div style={styles.colF}>{p.userName.split(' ')[0]}</div><div style={styles.colInn}><span style={{color:'#1fd18a', fontWeight:'bold'}}>#{p.inn1Num}</span> <span style={styles.playerName}>{p.p1Name}</span></div><div style={styles.colR}>{p.r1}</div><div style={styles.colInn}><span style={{color:'#ff3d5a', fontWeight:'bold'}}>#{p.inn2Num}</span> <span style={styles.playerName}>{p.p2Name}</span></div><div style={styles.colR}>{p.r2}</div><div style={{...styles.colTot, color:'#f0c040'}}>{p.total}</div></div>
                ))}
              </div>
            </section>
          )}

          {tab === 'season' && (
            <section style={{padding: '0 15px'}}>
              <h2 style={styles.sectionHeader}>🏆 SEASON STANDINGS</h2>
              <div style={{...styles.tableWrap, marginBottom:'40px', background:'#0e0f1a'}}>
                 {leaderboard.map((u, i) => (
                   <div key={i} style={styles.tableRow}><div style={{flex:1, color:'#52536e'}}>0{i+1}</div><div style={{flex:3, fontWeight:'bold', color: i === 0 ? '#f0c040' : '#eee'}}>{u.name}</div><div style={{flex:2, textAlign:'right', color: u.totalPoints >= 0 ? '#1fd18a' : '#ff3d5a', fontSize:'22px', fontFamily:'Bebas Neue'}}>{u.totalPoints > 0 ? '+' : ''}{u.totalPoints}</div></div>
                 ))}
              </div>
              <h2 style={styles.sectionHeader}>📋 MATCH HISTORY</h2>
              {matchHistory.map((m, i) => {
                const res = calculateFinalPoints(m, m.allPicks);
                return (<div key={i} className="match-history-card" onClick={() => { setSelectedMatch(m); setTab('results'); }}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'12px', borderBottom:'1px solid #252638', paddingBottom:'8px'}}><span style={{fontWeight:'bold'}}>🏏 {m.matchName}</span><span style={{fontSize:'11px', color:'#7a7b98'}}>{m.dateText} • Pull: {m.finalPull}</span></div><div style={{display:'flex', gap:'8px', marginBottom:'12px'}}><div className="pill" style={{borderColor:'#f0c040'}}>🥇 {res[0]?.userName}</div><div className="pill" style={{borderColor:'#c0c0c0'}}>🥈 {res[1]?.userName}</div><div className="pill" style={{borderColor:'#cd7f32'}}>🥉 {res[2]?.userName}</div></div><div style={{display:'flex', flexWrap:'wrap', gap:'10px', fontSize:'11px', color:'#52536e'}}>{res.map((p, idx) => (<span key={idx}>{p.userName}: <span style={{color: p.net > 0 ? '#1fd18a' : p.net === 0 ? '#eee' : '#ff3d5a'}}>{p.net > 0 ? '+' : ''}{p.net}</span>{idx < res.length - 1 ? ' •' : ''}</span>))}</div></div>);
              })}
            </section>
          )}

          {tab === 'data' && user.email === ADMIN_EMAIL && (
            <section style={{padding: '0 15px'}}>
              <h2 style={styles.sectionHeader}>⚙️ DATA CONTROL</h2>
              <div style={styles.adminDataBox}>
                <h4 style={{color:'#f0c040', marginBottom:'10px'}}>Season Points</h4>
                {leaderboard.map(u => (<div key={u.id} style={styles.adminDataRow}><span>{u.name}</span><input type="number" defaultValue={u.totalPoints} onBlur={(e) => updateSeasonPoint(u.id, e.target.value)} style={styles.dataInput} /></div>))}
              </div>
              <div style={{...styles.adminDataBox, marginTop:'20px'}}>
                <h4 style={{color:'#f0c040', marginBottom:'10px'}}>Active Match Picks</h4>
                {allPicks.map((p, idx) => (<div key={idx} style={styles.adminDataRow}><span>{p.userName}</span><button onClick={() => deletePick(`${selectedMatch.id}_${p.userId}`)} style={{background:'#ff3d5a', color:'#fff', border:'none', borderRadius:'4px', padding:'4px 10px', fontSize:'10px'}}>DELETE</button></div>))}
              </div>
              <button onClick={nuclearReset} style={{...styles.btnAdmin, marginTop:'30px', background:'#ff3d5a'}}>☢️ NUCLEAR RESET SEASON</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  container: { background: '#07080f', minHeight: '100vh', paddingBottom: '60px' },
  center: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#f0c040', fontSize: '32px', fontFamily: 'Bebas Neue' },
  heroTitle: { fontSize: '48px', fontFamily: 'Bebas Neue', color: '#f0c040', marginBottom: '20px' },
  authPage: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
  tabs: { display: 'flex', background: '#0e0f1a', borderBottom: '1px solid #252638', position: 'sticky', top: 0, zIndex: 100 },
  tabOn: { flex: 1, padding: '15px', background: '#ff5f1f', border: 'none', color: '#fff', fontWeight: 'bold', fontSize: '11px', letterSpacing:'1px' },
  tabOff: { flex: 1, padding: '15px', background: 'transparent', border: 'none', color: '#52536e', fontSize: '11px', letterSpacing:'1px' },
  matchCard: { background: '#13141f', padding: '20px', borderRadius: '15px', border: '1px solid #252638', marginBottom:'12px', cursor:'pointer' },
  matchMeta: { color: '#52536e', fontSize: '10px', fontWeight: 'bold', marginBottom: '6px' },
  matchTitle: { fontSize: '18px' },
  matchTime: { color: '#ff5f1f', fontSize: '13px', marginTop: '8px', fontWeight: '700' },
  arenaTitle: { textAlign: 'center', fontSize: '16px', color: '#f0c040', fontFamily: 'Bebas Neue', marginBottom: '20px' },
  teamHeaderBox: { borderBottom: '1px solid #252638', paddingBottom: '8px', marginBottom: '12px' },
  teamLabel: { fontSize: '10px', color: '#52536e', fontWeight: 'bold' },
  teamNameText: { fontSize: '20px', fontFamily: 'Bebas Neue', margin: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' },
  cardComplex: { height: '90px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '14px', cursor: 'pointer', border: '1px solid' },
  cardNumber: { fontSize: '32px', fontFamily: 'Bebas Neue' },
  cardFriend: { fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' },
  adminPanel: { background:'#13141f', padding:'15px', borderRadius:'15px', border:'1px solid #f0c040', marginBottom:'25px', display:'flex', gap:'10px', alignItems:'center' },
  adminInput: { background:'#000', color:'#fff', border:'1px solid #333', width:'70px', padding:'10px', borderRadius:'8px', textAlign:'center' },
  ticker: { flex:1, textAlign:'center', fontSize:'12px', color:'#7a7b98', fontWeight:'bold' },
  btnAction: { flex: 1, background:'#f0c040', color:'#000', padding:'12px', border:'none', borderRadius:'8px', fontWeight:'bold' },
  btnAdmin: { width: '100%', padding: '12px', background: '#f0c040', border: 'none', borderRadius: '8px', fontWeight: 'bold', marginBottom: '15px' },
  btnPrimary: { background: 'linear-gradient(135deg, #ff5f1f, #d44a0f)', color: 'white', padding: '15px 45px', border: 'none', borderRadius: '100px', fontWeight: 'bold', fontSize: '14px' },
  btnNavigate: { background: '#1fd18a', color: '#000', padding: '12px 30px', border: 'none', borderRadius: '8px', fontWeight: '900', fontSize: '13px', letterSpacing:'1px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(31, 209, 138, 0.3)' },
  btnResetSmall: { background:'#ff3d5a', color:'#fff', border:'none', borderRadius:'10px', padding:'0 15px', fontWeight:'bold', fontSize:'11px' },
  podiumContainer: { display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '12px', margin: '35px 0', height: '190px' },
  pod: { flex: 1, background: '#13141f', border: '1px solid #252638', borderRadius: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  podName: { fontWeight: 'bold', fontSize: '14px', marginTop: '12px' },
  podScore: { fontSize: '42px', color: '#f0c040', fontFamily: 'Bebas Neue' },
  tableWrap: { background: '#13141f', borderRadius: '20px', overflow: 'hidden', border: '1px solid #252638' },
  tableHeader: { display: 'flex', background: '#1a1b28', padding: '15px 12px', fontSize: '11px', color: '#7a7b98', fontWeight: 'bold' },
  tableRow: { display: 'flex', padding: '18px 12px', fontSize: '13px', borderBottom: '1px solid #252638', alignItems: 'center' },
  colF: { flex: 1.5, fontWeight: 'bold' },
  colInn: { flex: 3 },
  playerName: { fontSize: '10px', marginLeft: '6px', color: '#52536e' },
  colR: { width: '45px', textAlign: 'center' },
  colTot: { width: '55px', textAlign: 'center', fontSize: '18px', fontFamily: 'Bebas Neue' },
  sectionHeader: { color: '#f0c040', fontFamily: 'Bebas Neue', letterSpacing: '3px', marginBottom: '15px', marginTop:'20px' },
  lockBadge: { background: 'rgba(255,61,90,0.1)', color: '#ff3d5a', fontSize: '11px', textAlign: 'center', padding: '6px', borderRadius: '100px', border: '1px solid #ff3d5a', marginBottom: '15px', fontWeight:'bold' },
  adminDataBox: { background: '#13141f', padding: '20px', borderRadius: '15px', border: '1px solid #252638' },
  adminDataRow: { display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #1a1b28', alignItems:'center' },
  dataInput: { background:'#000', color:'#f0c040', border:'1px solid #333', padding:'6px', borderRadius:'6px', width:'70px', textAlign:'center', fontWeight:'bold' },
  testPanel: { flex:1, background:'rgba(240,192,64,0.05)', padding:'10px', borderRadius:'10px', border:'1px dashed #f0c040', display:'flex', gap:'12px', alignItems:'center' },
  testSelect: { flex:1, background:'#000', color:'#fff', border:'1px solid #333', padding:'10px', borderRadius:'8px', fontSize:'13px', fontWeight:'700' }
};

export default App;
