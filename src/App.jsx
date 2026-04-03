import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, getDocs, where, serverTimestamp, onSnapshot } from 'firebase/firestore';

const CRIC_KEYS = ["c3c5ad69-4ca5-44b0-8313-1fc4362ed806", "eb4fcb6b-a26b-4594-9893-28412197c556", "64dcc6e7-c783-414b-9047-6abb463edec0", "d009046b-65c7-4ff3-abad-3e0a7f0574ca"];
const IPL_SERIES_ID = "87c62aac-bc3c-4738-ab93-19da0690488f";
const ADMIN_EMAIL = "dhavalranavasiya@gmail.com";
const PULL = 20;

function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('matches'); // matches, play, my-satto, season
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

  // Real-time listener for current match picks
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

  // ADMIN ONLY: Trigger API Call
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
          alert("API Hit Success: Match List Updated");
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
          const parse = (inn) => (inn?.batting || []).slice(0, 9).map((b, i) => ({ pos: i + 1, runs: b.r || 0 }));
          const scores = { inn1: parse(sc[0]), inn2: parse(sc[1]), status: data.data.status, updatedAt: new Date() };
          await setDoc(doc(db, "active_matches", selectedMatch.id), { scores }, { merge: true });
          setSelectedMatch({ ...selectedMatch, scores });
          alert("API Hit Success: Scorecard Updated");
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

  if (loading) return <div style={styles.center}>Loading IST...</div>;

  return (
    <div style={styles.container}>
      {!user ? (
        <div style={styles.authPage}><button onClick={loginWithGoogle} style={styles.btnPrimary}>Login with Google</button></div>
      ) : (
        <>
          <nav style={styles.tabs}>
            <button onClick={() => setTab('matches')} style={tab === 'matches' ? styles.tabOn : styles.tabOff}>Matches</button>
            <button onClick={() => setTab('play')} style={tab === 'play' ? styles.tabOn : styles.tabOff} disabled={!selectedMatch}>Play</button>
            <button onClick={() => setTab('my-satto')} style={tab === 'my-satto' ? styles.tabOn : styles.tabOff}>My Satto</button>
            <button onClick={() => setTab('season')} style={tab === 'season' ? styles.tabOn : styles.tabOff}>Season</button>
          </nav>

          {/* TAB 1: MATCH LIST */}
          {tab === 'matches' && (
            <section>
              {user.email === ADMIN_EMAIL && <button onClick={adminFetchMatches} style={styles.btnAdmin}>ADMIN: Refresh Match List (API Hit)</button>}
              {matches.slice(0,10).map(m => (
                <div key={m.id} onClick={() => handleSelectMatch(m)} style={styles.matchCard}>
                  <b>{m.name}</b><br/><small>{formatIST(m.dateTimeGMT)}</small>
                </div>
              ))}
            </section>
          )}

          {/* TAB 2: PLAY (CARDS) */}
          {tab === 'play' && selectedMatch && (
            <section>
              <h3>{selectedMatch.name}</h3>
              <div style={styles.grid}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn1Card === i);
                  return <div key={i} onClick={() => !p && lockCard(1, i)} style={{...styles.card, background: p?.userId === user.uid ? '#1fd18a' : p ? '#333' : '#13141f'}}>{p?.userId === user.uid ? `#${p.inn1Num}` : p ? "✖" : "🟢"}</div>
                })}
              </div>
              <div style={{...styles.grid, marginTop:'10px'}}>
                {[...Array(9)].map((_, i) => {
                  const p = allPicks.find(x => x.inn2Card === i);
                  return <div key={i} onClick={() => !p && lockCard(2, i)} style={{...styles.card, background: p?.userId === user.uid ? '#ff3d5a' : p ? '#333' : '#13141f'}}>{p?.userId === user.uid ? `#${p.inn2Num}` : p ? "✖" : "🔴"}</div>
                })}
              </div>
            </section>
          )}

          {/* TAB 3: MY SATTO (CALCULATE) */}
          {tab === 'my-satto' && selectedMatch && (
            <section style={styles.cardBox}>
              <h3>Results: {selectedMatch.name}</h3>
              {user.email === ADMIN_EMAIL && <button onClick={adminFetchScorecard} style={styles.btnAdmin}>ADMIN: Fetch Live Scores (API Hit)</button>}
              <div style={{marginTop:'20px'}}>
                {allPicks.sort((a,b) => (b.net || 0) - (a.net || 0)).map((p, i) => {
                  const s1 = selectedMatch.scores?.inn1?.find(s => s.pos === p.inn1Num)?.runs || 0;
                  const s2 = selectedMatch.scores?.inn2?.find(s => s.pos === p.inn2Num)?.runs || 0;
                  return <div key={i} style={styles.friendRow}><span>{p.userName}</span><span>{s1+s2} runs</span></div>
                })}
              </div>
            </section>
          )}

          {/* TAB 4: SEASON */}
          {tab === 'season' && (
            <section>
              <h3>Leaderboard</h3>
              {leaderboard.map((u, i) => <div key={i} style={styles.friendRow}><span>{u.name}</span><b>{u.totalPoints || 0}</b></div>)}
            </section>
          )}

          <button onClick={logout} style={{marginTop:'40px', color:'#ff3d5a', background:'none', border:'none'}}>Logout</button>
        </>
      )}
    </div>
  );
}

const styles = {
  container: { background: '#07080f', minHeight: '100vh', color: '#eee', padding: '15px', fontFamily: 'sans-serif' },
  center: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#07080f', color: 'white' },
  authPage: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  tabs: { display: 'flex', gap: '5px', marginBottom: '20px', borderBottom: '1px solid #252638' },
  tabOn: { flex: 1, padding: '10px', background: '#ff5f1f', border: 'none', color: 'white', fontWeight: 'bold' },
  tabOff: { flex: 1, padding: '10px', background: '#13141f', border: 'none', color: '#777' },
  matchCard: { background: '#13141f', padding: '15px', margin: '10px 0', borderRadius: '8px', border: '1px solid #252638' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '5px' },
  card: { height: '35px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '4px', border: '1px solid #333', fontSize: '12px' },
  btnPrimary: { background: '#ff5f1f', color: 'white', padding: '15px 30px', border: 'none', borderRadius: '8px', fontWeight: 'bold' },
  btnAdmin: { width: '100%', background: '#f0c040', color: '#000', padding: '10px', border: 'none', borderRadius: '5px', fontWeight: 'bold', marginBottom: '15px' },
  friendRow: { display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #222' },
  cardBox: { background: '#13141f', padding: '15px', borderRadius: '12px' }
};

export default App;