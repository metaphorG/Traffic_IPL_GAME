import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, getDocs, where } from 'firebase/firestore';

// YOUR 4 CRIC DATA API KEYS
const CRIC_KEYS = [
  "c3c5ad69-4ca5-44b0-8313-1fc4362ed806",
  "eb4fcb6b-a26b-4594-9893-28412197c556",
  "64dcc6e7-c783-414b-9047-6abb463edec0",
  "d009046b-65c7-4ff3-abad-3e0a7f0574ca"
];

const IPL_SERIES_ID = "87c62aac-bc3c-4738-ab93-19da0690488f";

function App() {
  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [otherPicks, setOtherPicks] = useState([]);
  const [myPicks, setMyPicks] = useState({ inn1: '', inn2: '', locked: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) fetchIPLMatches();
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // API ROTATOR LOGIC
  const fetchIPLMatches = async () => {
    for (let i = 0; i < CRIC_KEYS.length; i++) {
      try {
        const res = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${CRIC_KEYS[i]}&id=${IPL_SERIES_ID}`);
        const data = await res.json();
        
        if (data.status === 'success') {
          const list = data.data.matchList || [];
          const now = new Date();
          const threeDaysAhead = new Date();
          threeDaysAhead.setDate(now.getDate() + 3);

          // SHOW ONLY PAST MATCHES AND 3 DAYS ADVANCE
          const filtered = list.filter(m => {
            const mDate = new Date(m.dateTimeGMT);
            return mDate <= threeDaysAhead;
          });

          setMatches(filtered);
          return; 
        }
      } catch (e) { console.error(`Key ${i+1} failed`, e); }
    }
    alert("All API keys exhausted.");
  };

  const handleSelectMatch = async (match) => {
    setSelectedMatch(match);
    
    // 1. Fetch My Picks
    const myDocRef = doc(db, "match_picks", `${match.id}_${user.uid}`);
    const mySnap = await getDoc(myDocRef);
    if (mySnap.exists()) {
      setMyPicks({ ...mySnap.data(), locked: true });
    } else {
      setMyPicks({ inn1: '', inn2: '', locked: false });
    }

    // 2. Fetch All Friends' Picks for this match
    const q = query(collection(db, "match_picks"), where("matchId", "==", match.id));
    const querySnapshot = await getDocs(q);
    const allPicks = [];
    querySnapshot.forEach((doc) => {
      if (doc.id !== `${match.id}_${user.uid}`) {
        allPicks.push(doc.data());
      }
    });
    setOtherPicks(allPicks);
  };

  const savePicks = async () => {
    if (!myPicks.inn1 || !myPicks.inn2) return alert("Please select both player numbers!");
    
    const i1 = parseInt(myPicks.inn1);
    const i2 = parseInt(myPicks.inn2);
    
    if (i1 < 1 || i1 > 9 || i2 < 1 || i2 > 9) return alert("Numbers must be between 1 and 9");

    try {
      await setDoc(doc(db, "match_picks", `${selectedMatch.id}_${user.uid}`), {
        userId: user.uid,
        userName: user.displayName,
        matchId: selectedMatch.id,
        matchName: selectedMatch.name,
        inn1: i1,
        inn2: i2,
        timestamp: new Date()
      });
      setMyPicks(prev => ({ ...prev, locked: true }));
      alert("Picks locked! You cannot change them now.");
    } catch (e) { 
      console.error(e);
      alert("Database error. Check your Firebase rules."); 
    }
  };

  if (loading) return <div style={styles.center}>Loading Satto Online...</div>;

  if (!user) {
    return (
      <div style={styles.authPage}>
        <h1 style={styles.goldText}>ટ્રાફિકવાળાનો સટ્ટો</h1>
        <p style={{color: '#52536e'}}>IPL 2026 Season</p>
        <button onClick={loginWithGoogle} style={styles.btnPrimary}>Login with Google</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <span style={styles.goldText}>🏏 {user.displayName}</span>
        <button onClick={logout} style={styles.btnSmall}>Logout</button>
      </header>

      {!selectedMatch ? (
        <section style={{marginTop: '20px'}}>
          <h3 style={styles.sectionTitle}>Available Matches</h3>
          {matches.map(m => (
            <div key={m.id} onClick={() => handleSelectMatch(m)} style={styles.matchCard}>
              <div style={{fontWeight: 'bold', color: '#1fd18a'}}>{m.name}</div>
              <div style={{fontSize: '12px', color: '#7a7b98'}}>{new Date(m.dateTimeGMT).toLocaleString()}</div>
            </div>
          ))}
        </section>
      ) : (
        <section style={styles.card}>
          <button onClick={() => setSelectedMatch(null)} style={styles.btnSmall}>← Back to List</button>
          <h2 style={{color: '#f0c040', margin: '15px 0'}}>{selectedMatch.name}</h2>
          
          <div style={styles.pickZone}>
            <h4>Your Selections</h4>
            <div style={styles.row}>
              <div style={{flex: 1}}>
                <label style={styles.label}>Innings 1 (#)</label>
                <input type="number" min="1" max="9" disabled={myPicks.locked}
                  value={myPicks.inn1} onChange={e => setMyPicks({...myPicks, inn1: e.target.value})} style={styles.input}/>
              </div>
              <div style={{flex: 1}}>
                <label style={styles.label}>Innings 2 (#)</label>
                <input type="number" min="1" max="9" disabled={myPicks.locked}
                  value={myPicks.inn2} onChange={e => setMyPicks({...myPicks, inn2: e.target.value})} style={styles.input}/>
              </div>
            </div>
            {!myPicks.locked && <button onClick={savePicks} style={styles.btnPrimary}>Lock My Numbers</button>}
            {myPicks.locked && <p style={{color: '#1fd18a', textAlign: 'center'}}>Selection Locked ✔</p>}
          </div>

          <div style={{marginTop: '30px'}}>
            <h4 style={styles.label}>Friends' Picks</h4>
            {otherPicks.length === 0 ? <p style={{fontSize: '12px', color: '#52536e'}}>No other picks yet.</p> : 
              otherPicks.map((p, idx) => (
                <div key={idx} style={styles.friendRow}>
                  <span style={{fontWeight: 'bold'}}>{p.userName}</span>
                  <span>Inn1: <b style={{color:'#1fd18a'}}>#{p.inn1}</b> | Inn2: <b style={{color:'#ff3d5a'}}>#{p.inn2}</b></span>
                </div>
              ))
            }
          </div>
        </section>
      )}
    </div>
  );
}

const styles = {
  center: { display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: '#07080f', color: 'white' },
  authPage: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#07080f' },
  goldText: { color: '#f0c040', fontFamily: 'serif' },
  container: { background: '#07080f', minHeight: '100vh', color: '#eeeef8', padding: '20px', fontFamily: 'sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #252638', paddingBottom: '15px' },
  sectionTitle: { fontSize: '14px', letterSpacing: '1px', color: '#7a7b98', textTransform: 'uppercase' },
  matchCard: { background: '#13141f', padding: '15px', margin: '10px 0', borderRadius: '10px', cursor: 'pointer', border: '1px solid #252638' },
  card: { background: '#13141f', padding: '20px', borderRadius: '15px', border: '1px solid #32334a' },
  pickZone: { background: '#07080f', padding: '15px', borderRadius: '10px', border: '1px solid #252638' },
  row: { display: 'flex', gap: '15px', marginBottom: '15px' },
  label: { display: 'block', fontSize: '11px', color: '#7a7b98', marginBottom: '5px' },
  input: { width: '100%', padding: '12px', background: '#1a1b28', color: 'white', border: '1px solid #32334a', borderRadius: '5px' },
  btnPrimary: { background: 'linear-gradient(135deg, #ff5f1f, #d44a0f)', color: 'white', border: 'none', padding: '15px', borderRadius: '8px', cursor: 'pointer', width: '100%', fontWeight: 'bold' },
  btnSmall: { background: 'none', color: '#ff3d5a', border: '1px solid #ff3d5a', padding: '5px 12px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' },
  friendRow: { display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #252638', fontSize: '13px' }
};

export default App;
