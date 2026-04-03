import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, getDocs, where, serverTimestamp, onSnapshot } from 'firebase/firestore';

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
    if (user.email !== ADMIN_EMAIL) return;
    for (let key of CRIC_KEYS) {
      try {
        const res = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${key}&id=${selectedMatch.id}`);
        const data = await res.json();
        if (data.status === 'success' && data.data.scorecard) {
          const sc = data.data.scorecard;
          // Extract short names or full names of teams
          const t1Info = data.data.teamInfo?.find(t => t.name === data.data.teams[0]) || { shortname: data.data.teams[0] };
          const t2Info = data.data.teamInfo?.find(t => t.name === data.data.teams[1]) || { shortname: data.data.teams[1] };
          
          const parse = (inn, team) => (inn?.batting || []).slice(0, 9).map((b, i) => ({ 
            pos: i + 1, 
            team: team.shortname || team.name, 
            name: b.batsman?.name || b.name || "Not Played", 
            runs: b.r || 0 
          }));

          const scores = { inn1: parse(sc[0], t1Info), inn2: parse(sc[1], t2Info), updatedAt: new Date() };
          await setDoc(doc(db, "active_matches", selectedMatch.id), { scores }, { merge: true });
          setSelectedMatch({ ...selectedMatch, scores });
          alert("Scorecard Fetched with Teams");
          return;
        }
      } catch (e) { console.error(e); }
    }
  };

  const handleSelectMatch = async (m) => {
    const matchRef = doc(db, "active_matches", m.id);
    let snap = await getDoc(matchRef);
    if (!snap.exists()) {
      const deck = { inn1Deck: [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5), inn2Deck: [1,2,3,4,5,6,7,8,9].sort(() => Math.random()-0.5) };
      await setDoc(matchRef, deck);
      setMatchDeck(deck);
    } else {
      setMatchDeck(snap.data());
    }
    setSelectedMatch({ ...m, ...snap.data() });
    setTab('play');
  };

  const lockCard = async (inn, idx) => {
    if (allPicks.some(p => p.userId === user.uid && p[`inn${inn}Card`] !== undefined)) return;
    if (allPicks.some(p => p[`inn${inn}Card`] === idx)) return alert("Taken!");
    const num = matchDeck[`inn${inn}Deck`][idx];
    await setDoc(doc(db, "match_picks", `${selectedMatch.id}_${user.uid}`), {
      userId: user.uid, userName: user.displayName, matchId: selectedMatch.id,
      [`inn${inn}Card`]: idx, [`inn${inn}Num`]: num, timestamp: serverTimestamp()
    }, { merge: true });
  };

  if (loading) return <div style={styles.center}>Loading...</div>;

  return (
    <div style={styles.container}>
      {!user ? (
        <div style={styles.authPage}><button onClick={loginWithGoogle} style={styles.btnPrimary}>Login</button></div>
      ) : (
        <>
          <nav style={styles.tabs}>
            <button onClick={() => setTab('matches')} style={tab === 'matches' ? styles.tabOn : styles.tabOff}>Matches</button>
            <button onClick={() => setTab('play')} style={tab === 'play' ? styles.tabOn : styles.tabOff} disabled={!selectedMatch}>Play</button>
            <button onClick={() => setTab('my-satto')} style={tab === 'my-satto' ? styles.tabOn : styles.tabOff} disabled={!selectedMatch}>My Satto</button>
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
              <h3 style={{marginBottom:'10px'}}>{selectedMatch.name}</h3>
              <div style={styles.grid}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn1Card === i);
                  return <div key={i} onClick={() => !p && lockCard(1, i)} style={{...styles.cardBox, background: p?.userId === user.uid ? '#1fd18a' : p ? '#333' : '#13141f'}}>{p?.userId === user.uid ? `#${p.inn1Num}` : p ? "✖" : "🟢"}</div>
                })}
              </div>
              <div style={{...styles.grid, marginTop:'10px'}}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn2Card === i);
                  return <div key={i} onClick={() => !p && lockCard(2, i)} style={{...styles.cardBox, background: p?.userId === user.uid ? '#ff3d5a' : p ? '#333' : '#13141f'}}>{p?.userId === user.uid ? `#${p.inn2Num}` : p ? "✖" : "🔴"}</div>
                })}
              </div>
            </section>
          )}

          {tab === 'my-satto' && selectedMatch && (
            <section>
              {user.email === ADMIN_EMAIL && <button onClick={adminFetchScorecard} style={styles.btnAdmin}>Admin: Fetch Scorecard (API Hit)</button>}
              <div style={styles.table}>
                <div style={styles.tableHeader}>
                  <div style={styles.colF}>Friend</div>
                  <div style={styles.colT}>Team</div>
                  <div style={styles.colN}>NO.</div>
                  <div style={styles.colP}>Player</div>
                  <div style={styles.colR}>Run</div>
                  <div style={styles.colTot}>Total</div>
                </div>
                {allPicks.map(p => {
                  const s1 = selectedMatch.scores?.inn1?.find(s => s.pos === p.inn1Num);
                  const s2 = selectedMatch.scores?.inn2?.find(s => s.pos === p.inn2Num);
                  const total = (s1?.runs || 0) + (s2?.runs || 0);
                  return (
                    <div key={p.userId} style={styles.tableRowGroup}>
                      <div style={styles.colF}>{p.userName.split(' ')[0]}</div>
                      <div style={styles.multiRowCol}>
                        <div style={styles.subRow}><div style={styles.colT}>{s1?.team || '-'}</div><div style={styles.colN}>{p.inn1Num}</div><div style={styles.colP}>{s1?.name || 'Not Played'}</div><div style={styles.colR}>{s1?.runs || 0}</div></div>
                        <div style={styles.subRow}><div style={styles.colT}>{s2?.team || '-'}</div><div style={styles.colN}>{p.inn2Num}</div><div style={styles.colP}>{s2?.name || 'Not Played'}</div><div style={styles.colR}>{s2?.runs || 0}</div></div>
                      </div>
                      <div style={styles.colTot}><b>{total}</b></div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {tab === 'season' && (
            <section><h3>Leaderboard</h3>{leaderboard.map((u, i) => <div key={i} style={styles.friendRow}><span>{u.name}</span><b>{u.totalPoints || 0}</b></div>)}</section>
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '3px' },
  cardBox: { height: '35px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '2px', border: '1px solid #333', fontSize: '10px' },
  btnPrimary: { background: '#ff5f1f', color: 'white', padding: '12px 25px', border: 'none', borderRadius: '4px' },
  btnAdmin: { width: '100%', background: '#f0c040', color: '#000', padding: '8px', border: 'none', borderRadius: '4px', fontWeight: 'bold', marginBottom: '10px' },
  table: { border: '1px solid #000', background: '#fff', color: '#000', fontSize: '10px' },
  tableHeader: { display: 'flex', background: '#000', color: '#fff', fontWeight: 'bold', textAlign: 'center', padding: '4px 0' },
  tableRowGroup: { display: 'flex', borderBottom: '1px solid #000', alignItems: 'stretch' },
  multiRowCol: { flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #000', borderRight: '1px solid #000' },
  subRow: { display: 'flex', borderBottom: '1px solid #000' },
  colF: { width: '35px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', borderRight: '1px solid #000' },
  colT: { width: '35px', borderRight: '1px solid #000', textAlign: 'center', padding: '3px 0' },
  colN: { width: '25px', borderRight: '1px solid #000', textAlign: 'center', padding: '3px 0' },
  colP: { flex: 1, borderRight: '1px solid #000', padding: '3px 5px', overflow: 'hidden', whiteSpace: 'nowrap' },
  colR: { width: '25px', textAlign: 'center', padding: '3px 0' },
  colTot: { width: '35px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' },
  friendRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #222' }
};

export default App;