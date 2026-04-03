import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, getDocs, where, serverTimestamp, onSnapshot, increment, writeBatch } from 'firebase/firestore';

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
  const [loading, setLoading] = useState(true);
  const [adminPull, setAdminPull] = useState(20);
  const [testName, setTestName] = useState(""); 

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) { loadMatchCache(); loadLeaderboard(); }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedMatch) return;
    const q = query(collection(db, "match_picks"), where("matchId", "==", selectedMatch.id));
    return onSnapshot(q, (snap) => setAllPicks(snap.docs.map(d => d.data())));
  }, [selectedMatch]);

  // FIXED: STRICT GMT TO IST CONVERSION
  const formatIST = (gmtStr) => {
    if (!gmtStr) return "TBD";
    const date = new Date(gmtStr + "Z"); // Append Z to force UTC interpretation
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const loadMatchCache = async () => {
    const snap = await getDoc(doc(db, "system", "match_cache"));
    if (snap.exists()) setMatches(snap.data().list);
  };

  const loadLeaderboard = async () => {
    const snap = await getDocs(collection(db, "users"));
    setLeaderboard(snap.docs.map(d => d.data()).sort((a,b) => b.totalPoints - a.totalPoints));
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
          setMatches(list);
          alert("Matches Updated");
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
          const t1Name = sc[0]?.inning || "Team 1";
          const t2Name = sc[1]?.inning || "Team 2";
          const parse = (inn, team) => (inn?.batting || []).slice(0, 9).map((b, i) => ({ 
            pos: i + 1, team, name: b.batsman?.name || b.name || "Not Played", runs: b.r || 0 
          }));
          const scores = { inn1: parse(sc[0], t1Name), inn2: parse(sc[1], t2Name), updatedAt: new Date() };
          await setDoc(doc(db, "active_matches", selectedMatch.id), { scores }, { merge: true });
          setSelectedMatch({ ...selectedMatch, scores });
          alert("Scorecard Fetched");
          return;
        }
      } catch (e) { console.error(e); }
    }
  };

  const calculateFinalPoints = () => {
    if (!selectedMatch?.scores || allPicks.length === 0) return [];
    let results = allPicks.map(p => {
      const s1 = selectedMatch.scores.inn1.find(s => s.pos === p.inn1Num);
      const s2 = selectedMatch.scores.inn2.find(s => s.pos === p.inn2Num);
      return { 
        ...p, p1Name: s1?.name || "TBD", p2Name: s2?.name || "TBD",
        r1: s1?.runs || 0, r2: s2?.runs || 0, total: (s1?.runs || 0) + (s2?.runs || 0) 
      };
    }).sort((a,b) => b.total - a.total);

    const totalPlayers = allPicks.length;
    const pot = totalPlayers * adminPull;
    const remPot = pot - adminPull; 
    const p1Amt = Math.round(remPot * 0.6);
    const p2Amt = Math.round(remPot * 0.4);

    let rank = 0;
    while (rank < results.length) {
      let tieGroup = results.filter(r => r.total === results[rank].total);
      let count = tieGroup.length;
      let startPos = rank;
      tieGroup.forEach(r => {
        if (startPos === 0) {
          if (count === 1) r.net = p1Amt - adminPull;
          else if (count === 2) r.net = Math.round((p1Amt + p2Amt) / 2) - adminPull;
          else r.net = Math.round((p1Amt + p2Amt + adminPull) / count) - adminPull;
        } else if (startPos === 1) {
          if (count === 1) r.net = p2Amt - adminPull;
          else r.net = Math.round((p2Amt + adminPull) / count) - adminPull;
        } else if (startPos === 2) {
          r.net = count === 1 ? 0 : -adminPull;
        } else {
          r.net = -adminPull;
        }
      });
      rank += count;
    }
    return results;
  };

  const finalRankings = calculateFinalPoints();

  const submitToSeason = async () => {
    if (user.email !== ADMIN_EMAIL || !selectedMatch?.scores || selectedMatch?.settled) return;
    if (!window.confirm(`Submit results? Match will be LOCKED after this.`)) return;
    for (let r of finalRankings) {
      await setDoc(doc(db, "users", r.userId), { name: r.userName, totalPoints: increment(r.net) }, { merge: true });
    }
    await setDoc(doc(db, "active_matches", selectedMatch.id), { settled: true, finalPull: adminPull }, { merge: true });
    setSelectedMatch(prev => ({...prev, settled: true}));
    alert("Season Updated & Match Locked!");
    loadLeaderboard();
  };

  const nuclearReset = async () => {
    if (user.email !== ADMIN_EMAIL) return;
    if (!window.confirm("☢️ NUCLEAR RESET: Clear EVERYTHING?")) return;
    const collectionsToDelete = ['match_picks', 'active_matches', 'users'];
    try {
      for (const colName of collectionsToDelete) {
        const querySnapshot = await getDocs(collection(db, colName));
        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      alert("Database Wiped!");
      window.location.reload();
    } catch (e) { alert("Reset Failed"); }
  };

  const handleSelectMatch = async (m) => {
    const matchRef = doc(db, "active_matches", m.id);
    let snap = await getDoc(matchRef);
    if (!snap.exists()) {
      const deck = { inn1Deck: [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5), inn2Deck: [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5) };
      await setDoc(matchRef, deck);
      setMatchDeck(deck);
      setSelectedMatch({ ...m, ...deck });
    } else {
      const data = snap.data();
      setMatchDeck(data);
      if (data.finalPull) setAdminPull(data.finalPull);
      setSelectedMatch({ ...m, ...data });
    }
    setTab('play');
  };

  const lockCard = async (inn, idx) => {
    if (selectedMatch?.settled) return alert("Match Finished.");
    const effectiveUID = testName ? `test_${testName.replace(/\s/g, '_')}` : user.uid;
    const effectiveName = testName || user.displayName;
    const myExisting = allPicks.find(p => p.userId === effectiveUID);
    if (myExisting && myExisting[`inn${inn}Card`] !== undefined) return;
    if (allPicks.some(p => p[`inn${inn}Card`] === idx)) return alert("Taken!");
    
    const num = matchDeck[`inn${inn}Deck`][idx];
    await setDoc(doc(db, "match_picks", `${selectedMatch.id}_${effectiveUID}`), {
      userId: effectiveUID, userName: effectiveName, matchId: selectedMatch.id,
      [`inn${inn}Card`]: idx, [`inn${inn}Num`]: num, timestamp: serverTimestamp()
    }, { merge: true });
  };

  if (loading) return <div style={styles.center}>🏏 Loading...</div>;

  return (
    <div style={styles.container}>
      {/* IMPORT FONTS */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; background: #07080f; }
        .gold-glow { text-shadow: 0 0 10px rgba(240, 192, 64, 0.4); }
        .glass { background: rgba(19, 20, 31, 0.8); backdrop-filter: blur(10px); }
      `}</style>

      {!user ? (
        <div style={styles.authPage}>
            <h1 style={styles.heroTitle}>ટ્રાફિકવાળાનો સટ્ટો</h1>
            <button onClick={loginWithGoogle} style={styles.btnPrimary}>Sign in with Google</button>
        </div>
      ) : (
        <>
          <nav style={styles.tabs}>
            {['matches', 'play', 'results', 'season'].map(t => (
              <button key={t} onClick={() => setTab(t)} 
                style={tab === t ? styles.tabOn : styles.tabOff} 
                disabled={!selectedMatch && (t === 'play' || t === 'results')}>
                {t.toUpperCase()}
              </button>
            ))}
          </nav>

          {tab === 'matches' && (
            <section style={{padding: '0 10px'}}>
              {user.email === ADMIN_EMAIL && <button onClick={adminFetchMatches} style={styles.btnAdmin}>ADMIN: SYNC FIXTURES</button>}
              {matches.slice(0,12).map(m => (
                <div key={m.id} onClick={() => handleSelectMatch(m)} style={styles.matchCard}>
                  <div style={{color: '#7a7b98', fontSize: '11px', marginBottom: '4px'}}>🏆 IPL 2026</div>
                  <b style={{fontSize: '16px'}}>{m.name}</b>
                  <div style={{color: '#ff5f1f', fontSize: '12px', marginTop: '6px', fontWeight: 'bold'}}>
                    🕒 {formatIST(m.dateTimeGMT)}
                  </div>
                </div>
              ))}
            </section>
          )}

          {tab === 'play' && selectedMatch && (
            <section style={{padding: '0 10px'}}>
              {user.email === ADMIN_EMAIL && !selectedMatch.settled && (
                <div style={styles.testPanel}>
                  <input placeholder="Enter Test Friend Name" value={testName} onChange={e => setTestName(e.target.value)} style={styles.testInput}/>
                  <button onClick={() => setTestName("")} style={styles.testBtn}>CLEAR</button>
                </div>
              )}
              <h3 style={styles.matchHeader}>{selectedMatch.name}</h3>
              {selectedMatch.settled && <div style={styles.lockBadge}>LOCK STATE: FINALIZED</div>}
              
              <div style={styles.grid}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn1Card === i);
                  return (
                    <div key={i} onClick={() => !p && lockCard(1, i)} 
                      style={{...styles.cardComplex, background: p ? '#1fd18a' : '#13141f', border: p ? '1px solid #1fd18a' : '1px solid #32334a', boxShadow: p ? '0 0 15px rgba(31,209,138,0.2)' : 'none'}}>
                      {p ? (
                        <>
                          <div style={styles.cardNumber}>#{p.inn1Num}</div>
                          <div style={styles.cardFriend}>{p.userName.split(' ')[0]}</div>
                        </>
                      ) : <div style={{fontSize: '20px'}}>🟢</div>}
                    </div>
                  );
                })}
              </div>

              <div style={{...styles.grid, marginTop:'15px'}}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn2Card === i);
                  return (
                    <div key={i} onClick={() => !p && lockCard(2, i)} 
                      style={{...styles.cardComplex, background: p ? '#ff3d5a' : '#13141f', border: p ? '1px solid #ff3d5a' : '1px solid #32334a', boxShadow: p ? '0 0 15px rgba(255,61,90,0.2)' : 'none'}}>
                      {p ? (
                        <>
                          <div style={styles.cardNumber}>#{p.inn2Num}</div>
                          <div style={styles.cardFriend}>{p.userName.split(' ')[0]}</div>
                        </>
                      ) : <div style={{fontSize: '20px'}}>🔴</div>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {tab === 'results' && selectedMatch && (
            <section style={{padding: '0 10px'}}>
              {user.email === ADMIN_EMAIL && (
                <div style={styles.adminPanel}>
                  {selectedMatch.settled ? <div style={{color:'#1fd18a', textAlign:'center', fontWeight:'bold'}}>MATCH ARCHIVED</div> : 
                  <div style={{display:'flex', gap:'8px'}}>
                    <input type="number" value={adminPull} onChange={(e) => setAdminPull(parseInt(e.target.value))} style={styles.adminInput}/>
                    <button onClick={adminFetchScorecard} style={styles.btnAction}>FETCH API</button>
                    <button onClick={submitToSeason} style={{...styles.btnAction, background:'#1fd18a'}}>SUBMIT</button>
                  </div>}
                </div>
              )}
              
              <div style={styles.podiumContainer}>
                {finalRankings.slice(0, 3).map((r, i) => (
                  <div key={i} style={{...styles.pod, order: i === 0 ? 2 : i === 1 ? 1 : 3, height: i === 0 ? '160px' : '140px', borderColor: i === 0 ? '#f0c040' : '#252638'}}>
                    <div style={{fontSize:'30px'}}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
                    <div style={styles.podName}>{r.userName}</div>
                    <div style={styles.podScore}>{r.total}</div>
                    <div style={{color: r.net >= 0 ? '#1fd18a' : '#ff3d5a', fontSize: '13px', fontWeight:'bold'}}>{r.net > 0 ? '+' : ''}{r.net}</div>
                  </div>
                ))}
              </div>

              <div style={styles.table}>
                <div style={styles.tableHeader}>
                  <div style={styles.colF}>FRIEND</div>
                  <div style={styles.colInn}>BATSMAN 1</div>
                  <div style={styles.colR}>RUNS</div>
                  <div style={styles.colInn}>BATSMAN 2</div>
                  <div style={styles.colR}>RUNS</div>
                  <div style={styles.colTot}>TOT</div>
                </div>
                {finalRankings.map((p, i) => (
                  <div key={i} style={styles.tableRow}>
                    <div style={styles.colF}>{p.userName.split(' ')[0]}</div>
                    <div style={styles.colInn}><span style={{color:'#1fd18a', fontWeight:'bold'}}>#{p.inn1Num}</span> <span style={{fontSize:'9px', marginLeft:'4px'}}>{p.p1Name}</span></div>
                    <div style={styles.colR}>{p.r1}</div>
                    <div style={styles.colInn}><span style={{color:'#ff3d5a', fontWeight:'bold'}}>#{p.inn2Num}</span> <span style={{fontSize:'9px', marginLeft:'4px'}}>{p.p2Name}</span></div>
                    <div style={styles.colR}>{p.r2}</div>
                    <div style={{...styles.colTot, color:'#f0c040', fontWeight:'bold'}}>{p.total}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'season' && (
            <section style={{padding: '0 10px'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                <h2 style={{color: '#f0c040', fontFamily: 'Bebas Neue', letterSpacing: '2px'}}>LEADERBOARD</h2>
                {user.email === ADMIN_EMAIL && <button onClick={nuclearReset} style={styles.btnReset}>RESET ALL</button>}
              </div>
              <div style={styles.table}>
                <div style={{...styles.tableHeader, background:'#000'}}>
                  <div style={{flex:1, paddingLeft:'15px'}}>RANK</div>
                  <div style={{flex:3}}>NAME</div>
                  <div style={{flex:2, textAlign:'right', paddingRight:'15px'}}>POINTS</div>
                </div>
                {leaderboard.map((u, i) => (
                  <div key={i} style={{...styles.tableRow, background: i === 0 ? 'rgba(240,192,64,0.05)' : 'transparent'}}>
                    <div style={{flex:1, paddingLeft:'15px', fontWeight:'bold', color:'#7a7b98'}}>{i+1}</div>
                    <div style={{flex:3, fontWeight:'bold', color: i === 0 ? '#f0c040' : '#eee'}}>{u.name}</div>
                    <div style={{flex:2, textAlign:'right', paddingRight:'15px', color: u.totalPoints >= 0 ? '#1fd18a' : '#ff3d5a', fontWeight:'bold', fontSize:'16px', fontFamily:'Bebas Neue'}}>
                      {u.totalPoints > 0 ? '+' : ''}{u.totalPoints}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  container: { background: '#07080f', minHeight: '100vh', color: '#eee', paddingBottom: '50px' },
  center: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#07080f', color: '#f0c040', fontSize: '24px', fontFamily: 'Bebas Neue' },
  heroTitle: { fontSize: '48px', fontFamily: 'Bebas Neue', background: 'linear-gradient(135deg, #f0c040, #ff5f1f)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '20px' },
  authPage: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
  tabs: { display: 'flex', background: '#0e0f1a', padding: '5px', borderBottom: '1px solid #252638', marginBottom: '20px', position: 'sticky', top: 0, zIndex: 100 },
  tabOn: { flex: 1, padding: '12px', background: '#ff5f1f', border: 'none', color: '#fff', fontWeight: 'bold', borderRadius: '4px', fontSize: '11px', letterSpacing: '1px' },
  tabOff: { flex: 1, padding: '12px', background: 'transparent', border: 'none', color: '#52536e', fontSize: '11px', letterSpacing: '1px' },
  matchCard: { background: '#13141f', padding: '18px', margin: '10px 0', borderRadius: '12px', border: '1px solid #252638', cursor: 'pointer', transition: '0.2s' },
  matchHeader: { fontSize: '18px', textAlign: 'center', marginBottom: '20px', color: '#f0c040', fontFamily: 'Bebas Neue', letterSpacing: '1px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' },
  cardComplex: { height: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '12px', cursor: 'pointer' },
  cardNumber: { fontSize: '28px', fontFamily: 'Bebas Neue', color: '#000' },
  cardFriend: { fontSize: '11px', fontWeight: 'bold', color: '#000', textTransform: 'uppercase' },
  lockBadge: { background: 'rgba(255,61,90,0.1)', color: '#ff3d5a', fontSize: '10px', textAlign: 'center', padding: '6px', borderRadius: '100px', border: '1px solid #ff3d5a', marginBottom: '15px', fontWeight: 'bold', letterSpacing: '1px' },
  adminPanel: { background:'#13141f', padding:'15px', borderRadius:'12px', border:'1px solid #f0c040', marginBottom:'20px' },
  adminInput: { background:'#000', color:'#fff', border:'1px solid #333', width:'60px', padding:'8px', borderRadius:'6px', textAlign:'center', fontWeight:'bold' },
  btnAction: { flex: 1, background:'#f0c040', color:'#000', padding:'10px', border:'none', borderRadius:'6px', fontWeight:'bold', fontSize:'11px' },
  btnPrimary: { background: 'linear-gradient(135deg, #ff5f1f, #d44a0f)', color: 'white', padding: '15px 40px', border: 'none', borderRadius: '100px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', boxShadow: '0 10px 20px rgba(255,95,31,0.3)' },
  podiumContainer: { display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '10px', margin: '30px 0', height: '180px' },
  pod: { flex: 1, background: '#13141f', border: '1px solid #252638', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px' },
  podName: { fontWeight: 'bold', fontSize: '13px', marginTop: '10px' },
  podScore: { fontSize: '36px', color: '#f0c040', fontFamily: 'Bebas Neue', margin: '2px 0' },
  table: { background: '#13141f', borderRadius: '16px', overflow: 'hidden', border: '1px solid #252638' },
  tableHeader: { display: 'flex', background: '#1a1b28', padding: '12px 10px', fontSize: '10px', color: '#7a7b98', fontWeight: 'bold', letterSpacing: '1px' },
  tableRow: { display: 'flex', padding: '15px 10px', fontSize: '13px', borderBottom: '1px solid #252638', alignItems: 'center' },
  colF: { flex: 1.5, fontWeight: 'bold' },
  colInn: { flex: 3 },
  colR: { width: '40px', textAlign: 'center', fontWeight: 'bold' },
  colTot: { width: '50px', textAlign: 'center', fontSize: '16px', fontFamily: 'Bebas Neue' },
  btnReset: { background:'transparent', color:'#ff3d5a', border:'1px solid #ff3d5a', padding:'4px 10px', borderRadius:'4px', fontSize:'10px', fontWeight:'bold' },
  testPanel: { background:'rgba(240,192,64,0.05)', padding:'10px', borderRadius:'8px', border:'1px dashed #f0c040', marginBottom:'15px', display:'flex', gap:'10px' },
  testInput: { flex:1, background:'#000', color:'#fff', border:'1px solid #333', padding:'6px', borderRadius:'4px', fontSize:'12px' },
  testBtn: { background:'#333', color:'#999', border:'none', padding:'0 10px', borderRadius:'4px', fontSize:'10px' }
};

export default App;