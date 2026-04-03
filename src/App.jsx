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
  const [matchData, setMatchData] = useState(null); // Stores the shuffled numbers for this match
  const [myPick, setMyPick] = useState(null);
  const [otherPicks, setOtherPicks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) loadMatches();
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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

  const shuffle = () => {
    let arr = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    return arr.sort(() => Math.random() - 0.5);
  };

  const handleSelectMatch = async (match) => {
    setSelectedMatch(match);
    
    // 1. Get or Create the "Deck" for this match so numbers are same for all friends
    const matchRef = doc(db, "active_matches", match.id);
    let mSnap = await getDoc(matchRef);
    
    if (!mSnap.exists()) {
      const newDeck = { inn1Deck: shuffle(), inn2Deck: shuffle() };
      await setDoc(matchRef, newDeck);
      setMatchData(newDeck);
    } else {
      setMatchData(mSnap.data());
    }

    // 2. Load My Pick
    const pickRef = doc(db, "match_picks", `${match.id}_${user.uid}`);
    const pSnap = await getDoc(pickRef);
    if (pSnap.exists()) setMyPick(pSnap.data());
    else setMyPick(null);

    // 3. Load Others
    const q = query(collection(db, "match_picks"), where("matchId", "==", match.id));
    const qSnap = await getDocs(q);
    setOtherPicks(qSnap.docs.map(d => d.data()).filter(p => p.userId !== user.uid));
  };

  const lockCard = async (inn, cardIndex) => {
    if (myPick && myPick[`inn${inn}`] !== undefined) return;
    
    const revealedNumber = matchData[`inn${inn}Deck`][cardIndex];
    
    const newPick = {
      ...myPick,
      userId: user.uid,
      userName: user.displayName,
      matchId: selectedMatch.id,
      [`inn${inn}Card`]: cardIndex,
      [`inn${inn}Num`]: revealedNumber,
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
              {matches.slice(0, 15).map(m => {
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
                <p style={styles.label}>INN 1: Click to Reveal Number</p>
                <div style={styles.grid}>
                  {[...Array(9)].map((_, i) => {
                    const isSelected = myPick?.inn1Card === i;
                    return (
                      <div key={i} onClick={() => lockCard(1, i)} 
                        style={{...styles.card, background: isSelected ? '#1fd18a' : '#13141f', color: isSelected ? '#000' : '#fff'}}>
                        {isSelected ? `#${myPick.inn1Num}` : "🏏"}
                      </div>
                    );
                  })}
                </div>

                <p style={{...styles.label, marginTop: '20px'}}>INN 2: Click to Reveal Number</p>
                <div style={styles.grid}>
                  {[...Array(9)].map((_, i) => {
                    const isSelected = myPick?.inn2Card === i;
                    return (
                      <div key={i} onClick={() => lockCard(2, i)} 
                        style={{...styles.card, background: isSelected ? '#ff3d5a' : '#13141f', color: isSelected ? '#fff' : '#fff'}}>
                        {isSelected ? `#${myPick.inn2Num}` : "🏏"}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={styles.friendsSection}>
                <h4 style={styles.sectionTitle}>Friends in this Match</h4>
                {otherPicks.length === 0 ? <p style={{fontSize:'12px', color:'#555'}}>No other picks yet.</p> : 
                  otherPicks.map((p, idx) => (
                    <div key={idx} style={styles.friendRow}>
                      <span style={{fontWeight:'bold'}}>{p.userName}</span>
                      <span>
                        <span style={{color:'#1fd18a'}}>#{p.inn1Num || '?'}</span> | 
                        <span style={{color:'#ff3d5a'}}> #{p.inn2Num || '?'}</span>
                      </span>
                    </div>
                  ))
                }
              </div>
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
  arena: { marginTop: '20px', background: '#1a1b28', padding: '15px', borderRadius: '12px', border: '1px solid #32334a' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' },
  card: { height: '60px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '8px', cursor: 'pointer', border: '1px solid #32334a', fontSize: '22px', fontWeight: 'bold', transition: 'all 0.3s' },
  label: { fontSize: '11px', color: '#7a7b98', marginBottom: '8px', letterSpacing: '1px' },
  btnPrimary: { background: '#ff5f1f', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  btnSmall: { background: 'none', color: '#7a7b98', border: '1px solid #7a7b98', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', marginBottom: '10px' },
  friendsSection: { marginTop: '30px', padding: '15px', background: '#13141f', borderRadius: '12px' },
  friendRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #252638', fontSize: '14px' }
};

export default App;