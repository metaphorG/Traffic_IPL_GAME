import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, getDocs, where, serverTimestamp } from 'firebase/firestore';

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
  const [myPick, setMyPick] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) loadMatches();
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- API & DATABASE CACHING ---
  const loadMatches = async () => {
    const cacheRef = doc(db, "system", "match_cache");
    const cacheSnap = await getDoc(cacheRef);
    const now = new Date();

    if (cacheSnap.exists() && (now - cacheSnap.data().updatedAt.toDate() < 3600000)) {
      setMatches(cacheSnap.data().list);
    } else {
      for (let key of CRIC_KEYS) {
        try {
          const res = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${key}&id=${IPL_SERIES_ID}`);
          const data = await res.json();
          if (data.status === 'success') {
            const list = (data.data.matchList || []).sort((a,b) => new Date(a.dateTimeGMT) - new Date(b.dateTimeGMT));
            await setDoc(cacheRef, { list, updatedAt: serverTimestamp() });
            setMatches(list);
            return;
          }
        } catch (e) { console.error(e); }
      }
    }
  };

  const handleSelectMatch = async (match) => {
    setSelectedMatch(match);
    const pickRef = doc(db, "match_picks", `${match.id}_${user.uid}`);
    const snap = await getDoc(pickRef);
    if (snap.exists()) setMyPick(snap.data());
    else setMyPick(null);
  };

  const lockCard = async (inn, cardIndex) => {
    if (myPick && myPick[`inn${inn}`] !== undefined) return;
    
    const newPick = {
      ...myPick,
      userId: user.uid,
      userName: user.displayName,
      matchId: selectedMatch.id,
      [`inn${inn}`]: cardIndex,
      [`inn${inn}Locked`]: true,
      timestamp: new Date()
    };
    
    await setDoc(doc(db, "match_picks", `${selectedMatch.id}_${user.uid}`), newPick, { merge: true });
    setMyPick(newPick);
  };

  if (loading) return <div style={styles.center}>🏏 Loading Satto...</div>;

  return (
    <div style={styles.container}>
      {!user ? (
        <div style={styles.authPage}>
          <h1 style={styles.goldText}>ટ્રાફિકવાળાનો સટ્ટો</h1>
          <button onClick={loginWithGoogle} style={styles.btnPrimary}>Sign in with Google</button>
        </div>
      ) : (
        <>
          <header style={styles.header}>
            <span style={styles.goldText}>👤 {user.displayName}</span>
            <button onClick={logout} style={styles.btnSmall}>Logout</button>
          </header>

          {!selectedMatch ? (
            <section style={{marginTop: '20px'}}>
              <h3 style={styles.sectionTitle}>IPL Match List</h3>
              {matches.slice(0, 10).map(m => {
                const isPast = new Date(m.dateTimeGMT) < new Date();
                return (
                  <div key={m.id} onClick={() => handleSelectMatch(m)} 
                    style={{...styles.matchCard, borderColor: isPast ? '#ff3d5a' : '#252638'}}>
                    <div style={{fontWeight: 'bold', color: isPast ? '#ff3d5a' : '#1fd18a'}}>{m.name}</div>
                    <div style={{fontSize: '11px', color: '#7a7b98'}}>📅 {new Date(m.dateTimeGMT).toLocaleString()}</div>
                  </div>
                );
              })}
            </section>
          ) : (
            <section>
              <button onClick={() => setSelectedMatch(null)} style={styles.btnSmall}>← Back</button>
              <h2 style={styles.goldText}>{selectedMatch.name}</h2>
              
              <div style={styles.arena}>
                <p style={styles.label}>INN 1: Pick 1 Card</p>
                <div style={styles.grid}>
                  {[...Array(9)].map((_, i) => (
                    <div key={i} onClick={() => lockCard(1, i)} 
                      style={{...styles.card, background: myPick?.inn1 === i ? '#1fd18a' : '#13141f'}}>
                      {myPick?.inn1 === i ? "✔" : "🏏"}
                    </div>
                  ))}
                </div>

                <p style={{...styles.label, marginTop: '20px'}}>INN 2: Pick 1 Card</p>
                <div style={styles.grid}>
                  {[...Array(9)].map((_, i) => (
                    <div key={i} onClick={() => lockCard(2, i)} 
                      style={{...styles.card, background: myPick?.inn2 === i ? '#ff3d5a' : '#13141f'}}>
                      {myPick?.inn2 === i ? "✔" : "🏏"}
                    </div>
                  ))}
                </div>
              </div>
              {myPick?.inn1 !== undefined && myPick?.inn2 !== undefined && (
                <div style={styles.statusBox}>✅ Your picks are locked for this match!</div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  center: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#07080f', color: 'white' },
  container: { background: '#07080f', minHeight: '100vh', color: '#eeeef8', padding: '15px', fontFamily: 'sans-serif' },
  authPage: { height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
  header: { display: 'flex', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid #252638' },
  goldText: { color: '#f0c040' },
  sectionTitle: { fontSize: '12px', color: '#7a7b98', textTransform: 'uppercase', marginBottom: '10px' },
  matchCard: { background: '#13141f', padding: '12px', margin: '8px 0', borderRadius: '8px', cursor: 'pointer', border: '2px solid' },
  arena: { marginTop: '20px', background: '#1a1b28', padding: '15px', borderRadius: '12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' },
  card: { height: '60px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '8px', cursor: 'pointer', border: '1px solid #32334a', fontSize: '20px' },
  label: { fontSize: '12px', color: '#7a7b98', marginBottom: '8px' },
  btnPrimary: { background: '#ff5f1f', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  btnSmall: { background: 'none', color: '#7a7b98', border: '1px solid #7a7b98', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', marginBottom: '10px' },
  statusBox: { marginTop: '20px', textAlign: 'center', color: '#1fd18a', fontWeight: 'bold', padding: '10px', border: '1px dashed #1fd18a' }
};

export default App;