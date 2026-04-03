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

  const formatIST = (gmtStr) => {
    return new Date(gmtStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
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
        } else if (startPos === 2) r.net = count === 1 ? 0 : -adminPull;
        else r.net = -adminPull;
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

  // NUCLEAR RESET: Admin only
  const nuclearReset = async () => {
    if (user.email !== ADMIN_EMAIL) return;
    if (!window.confirm("☢️ NUCLEAR RESET: This will delete ALL match data, picks, and the leaderboard. Are you 100% sure?")) return;

    const collectionsToDelete = ['match_picks', 'active_matches', 'users'];
    
    try {
      for (const colName of collectionsToDelete) {
        const querySnapshot = await getDocs(collection(db, colName));
        const batch = writeBatch(db);
        querySnapshot.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      alert("✅ Database Wiped. Starting Fresh!");
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("Error wiping database. Check Firebase Console.");
    }
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
    if (selectedMatch?.settled) return alert("This match is already finished.");
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

  if (loading) return <div style={styles.center}>Loading IST...</div>;

  return (
    <div style={styles.container}>
      {!user ? (
        <div style={styles.authPage}><button onClick={loginWithGoogle} style={styles.btnPrimary}>Login</button></div>
      ) : (
        <>
          <nav style={styles.tabs}>
            <button onClick={() => setTab('matches')} style={tab === 'matches' ? styles.tabOn : styles.tabOff}>Matches</button>
            <button onClick={() => setTab('play')} style={tab === 'play' ? styles.tabOn : styles.tabOff} disabled={!selectedMatch}>Play</button>
            <button onClick={() => setTab('results')} style={tab === 'results' ? styles.tabOn : styles.tabOff} disabled={!selectedMatch}>Results</button>
            <button onClick={() => setTab('season')} style={tab === 'season' ? styles.tabOn : styles.tabOff}>Season</button>
          </nav>

          {tab === 'matches' && (
            <section>
              {user.email === ADMIN_EMAIL && <button onClick={adminFetchMatches} style={styles.btnAdmin}>Refresh Match List (API)</button>}
              {matches.slice(0,15).map(m => (
                <div key={m.id} onClick={() => handleSelectMatch(m)} style={styles.matchCard}><b>{m.name}</b><br/><small>{formatIST(m.dateTimeGMT)}</small></div>
              ))}
            </section>
          )}

          {tab === 'play' && selectedMatch && (
            <section>
              {user.email === ADMIN_EMAIL && !selectedMatch.settled && (
                <div style={styles.testPanel}>
                  <span style={{fontSize:'11px', color:'#f0c040'}}>🧪 TEST MODE: Pick as:</span>
                  <input placeholder="Friend Name" value={testName} onChange={e => setTestName(e.target.value)} style={styles.testInput}/>
                  <button onClick={() => setTestName("")} style={styles.testBtn}>Reset to Me</button>
                </div>
              )}

              <h3 style={{marginBottom:'15px', fontSize:'14px'}}>{selectedMatch.name}</h3>
              {selectedMatch.settled && <div style={styles.lockBadge}>🔒 Match Locked & Settled</div>}
              
              <div style={styles.grid}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn1Card === i);
                  return (
                    <div key={i} onClick={() => !p && lockCard(1, i)} 
                      style={{...styles.cardComplex, background: p ? '#1fd18a' : '#13141f', border: p ? '1px solid #1fd18a' : '1px solid #333'}}>
                      {p ? (
                        <>
                          <div style={styles.cardNumber}>#{p.inn1Num}</div>
                          <div style={styles.cardFriend}>{p.userName.split(' ')[0]}</div>
                        </>
                      ) : <div style={styles.cardIcon}>🟢</div>}
                    </div>
                  );
                })}
              </div>

              <div style={{...styles.grid, marginTop:'15px'}}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn2Card === i);
                  return (
                    <div key={i} onClick={() => !p && lockCard(2, i)} 
                      style={{...styles.cardComplex, background: p ? '#ff3d5a' : '#13141f', border: p ? '1px solid #ff3d5a' : '1px solid #333'}}>
                      {p ? (
                        <>
                          <div style={styles.cardNumber}>#{p.inn2Num}</div>
                          <div style={styles.cardFriend}>{p.userName.split(' ')[0]}</div>
                        </>
                      ) : <div style={styles.cardIcon}>🔴</div>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {tab === 'results' && selectedMatch && (
            <section>
              {user.email === ADMIN_EMAIL && (
                <div style={styles.adminPanel}>
                  {selectedMatch.settled ? (
                    <div style={{color:'#1fd18a', fontWeight:'bold', textAlign:'center'}}>✅ POINTS SUBMITTED TO SEASON</div>
                  ) : (
                    <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                      <label style={{fontSize:'12px'}}>Pull:</label>
                      <input type="number" value={adminPull} onChange={(e) => setAdminPull(parseInt(e.target.value) || 0)} style={styles.adminInput}/>
                      <button onClick={adminFetchScorecard} style={styles.btnAction}>Fetch Scorecard</button>
                      <button onClick={submitToSeason} style={{...styles.btnAction, background:'#1fd18a'}}>Final Submit</button>
                    </div>
                  )}
                </div>
              )}
              
              <div style={styles.podiumContainer}>
                {finalRankings.slice(0, 3).map((r, i) => (
                  <div key={i} style={{...styles.pod, order: i === 0 ? 2 : i === 1 ? 1 : 3, height: i === 0 ? '160px' : '140px'}}>
                    <div style={styles.podMedal}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
                    <div style={styles.podName}>{r.userName.split(' ')[0]}</div>
                    <div style={styles.podScore}>{r.total}</div>
                    <div style={{color: r.net >= 0 ? '#1fd18a' : '#ff3d5a', fontSize: '11px'}}>{r.net > 0 ? '+' : ''}{r.net} pts</div>
                  </div>
                ))}
              </div>

              <div style={styles.table}>
                <div style={styles.tableHeader}>
                  <div style={styles.colF}>FRIEND</div>
                  <div style={styles.colInn}>{selectedMatch.scores?.inn1?.[0]?.team || "TEAM 1"}</div>
                  <div style={styles.colR}>RUNS</div>
                  <div style={styles.colInn}>{selectedMatch.scores?.inn2?.[0]?.team || "TEAM 2"}</div>
                  <div style={styles.colR}>RUNS</div>
                  <div style={styles.colTot}>TOTAL</div>
                  <div style={styles.colNet}>NET</div>
                </div>
                {finalRankings.map((p, i) => (
                  <div key={i} style={styles.tableRow}>
                    <div style={styles.colF}>{p.userName.split(' ')[0]}</div>
                    <div style={styles.colInn}><span style={{color:'#1fd18a', fontWeight:'bold'}}>#{p.inn1Num}</span> {p.p1Name}</div>
                    <div style={styles.colR}>{p.r1}</div>
                    <div style={styles.colInn}><span style={{color:'#ff3d5a', fontWeight:'bold'}}>#{p.inn2Num}</span> {p.p2Name}</div>
                    <div style={styles.colR}>{p.r2}</div>
                    <div style={{...styles.colTot, color:'#f0c040'}}>{p.total}</div>
                    <div style={{...styles.colNet, color: p.net > 0 ? '#1fd18a' : p.net === 0 ? '#777' : '#ff3d5a'}}>{p.net > 0 ? '+' : ''}{p.net}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'season' && (
            <section>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                <h3 style={{margin:0}}>Season Leaderboard</h3>
                {user.email === ADMIN_EMAIL && <button onClick={nuclearReset} style={styles.btnReset}>☢️ Reset Season</button>}
              </div>
              <div style={styles.table}>
                <div style={{...styles.tableHeader, background:'#000'}}>
                  <div style={{flex:1, paddingLeft:'15px'}}>RANK</div>
                  <div style={{flex:3}}>FRIEND</div>
                  <div style={{flex:2, textAlign:'right', paddingRight:'15px'}}>TOTAL POINTS</div>
                </div>
                {leaderboard.map((u, i) => (
                  <div key={i} style={{...styles.tableRow, background: i % 2 === 0 ? '#13141f' : '#1a1b28'}}>
                    <div style={{flex:1, paddingLeft:'15px'}}>{i+1}</div>
                    <div style={{flex:3, fontWeight:'bold'}}>{u.name}</div>
                    <div style={{flex:2, textAlign:'right', paddingRight:'15px', color: u.totalPoints >= 0 ? '#1fd18a' : '#ff3d5a'}}>
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
  container: { background: '#07080f', minHeight: '100vh', color: '#eee', padding: '10px', fontFamily: 'sans-serif' },
  center: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#07080f', color: 'white' },
  authPage: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  tabs: { display: 'flex', gap: '2px', marginBottom: '15px' },
  tabOn: { flex: 1, padding: '10px', background: '#ff5f1f', border: 'none', color: 'white', fontWeight: 'bold' },
  tabOff: { flex: 1, padding: '10px', background: '#13141f', border: 'none', color: '#777' },
  matchCard: { background: '#13141f', padding: '12px', margin: '5px 0', borderRadius: '4px', border: '1px solid #252638' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '6px' },
  cardComplex: { height: '55px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRadius: '6px', cursor: 'pointer' },
  cardNumber: { fontSize: '16px', fontWeight: 'bold', color: '#000' },
  cardFriend: { fontSize: '9px', fontWeight: '600', color: '#000', textTransform: 'uppercase', width: '90%', textAlign: 'center' },
  cardIcon: { fontSize: '18px' },
  lockBadge: { background: '#ff3d5a', color: '#fff', fontSize: '11px', textAlign: 'center', padding: '5px', borderRadius: '4px', marginBottom: '10px', fontWeight: 'bold' },
  testPanel: { background:'#1a1b28', padding:'10px', borderRadius:'8px', border:'1px dashed #f0c040', marginBottom:'15px', display:'flex', alignItems:'center', gap:'10px' },
  testInput: { background:'#000', color:'#fff', border:'1px solid #333', padding:'5px', fontSize:'12px', flex:1 },
  testBtn: { background:'#333', color:'#777', border:'none', fontSize:'10px', padding:'5px', borderRadius:'4px' },
  adminPanel: { background:'#13141f', padding:'10px', borderRadius:'8px', border:'1px solid #f0c040', marginBottom:'15px' },
  adminInput: { background:'#000', color:'#fff', border:'1px solid #444', width:'50px', padding:'5px', borderRadius:'4px' },
  btnAction: { background:'#f0c040', color:'#000', padding:'5px 12px', border:'none', borderRadius:'4px', fontWeight:'bold', cursor:'pointer' },
  btnReset: { background:'rgba(255,61,90,0.1)', color:'#ff3d5a', border:'1px solid #ff3d5a', padding:'5px 10px', borderRadius:'4px', fontSize:'11px', fontWeight:'bold', cursor:'pointer' },
  podiumContainer: { display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '8px', margin: '15px 0', height: '170px' },
  pod: { flex: 1, background: '#13141f', border: '1px solid #252638', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5px' },
  podMedal: { fontSize: '20px' },
  podName: { fontWeight: 'bold', fontSize: '12px' },
  podScore: { fontSize: '24px', color: '#f0c040', margin: '3px 0' },
  table: { background: '#13141f', borderRadius: '8px', overflow: 'hidden' },
  tableHeader: { display: 'flex', background: '#1a1b28', padding: '8px 5px', fontSize: '9px', color: '#52536e' },
  tableRow: { display: 'flex', padding: '10px 5px', fontSize: '11px', borderBottom: '1px solid #252638', alignItems: 'center' },
  colF: { flex: 1.5, fontWeight: 'bold' },
  colInn: { flex: 3.5, fontSize: '10px' },
  colR: { flex: 1, textAlign: 'center' },
  colTot: { flex: 1, textAlign: 'center', fontWeight: 'bold' },
  colNet: { flex: 1, textAlign: 'center', fontWeight: 'bold' }
};

export default App;