import React, { useState, useEffect } from 'react';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, getDocs, where } from 'firebase/firestore';

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

  const fetchIPLMatches = async () => {
    for (let key of CRIC_KEYS) {
      try {
        const res = await fetch(`https://api.cricapi.com/v1/series_info?apikey=${key}&id=${IPL_SERIES_ID}`);
        const data = await res.json();
        if (data.status === 'success') {
          const now = new Date();
          const limit = new Date(); limit.setDate(now.getDate() + 3);
          setMatches((data.data.matchList || []).filter(m => new Date(m.dateTimeGMT) <= limit));
          return;
        }
      } catch (e) { console.error(e); }
    }
  };

  const handleSelectMatch = async (match) => {
    setSelectedMatch(match);
    const myDoc = await getDoc(doc(db, "match_picks", `${match.id}_${user.uid}`));
    setMyPicks(myDoc.exists() ? { ...myDoc.data(), locked: true } : { inn1: '', inn2: '', locked: false });

    const q = query(collection(db, "match_picks"), where("matchId", "==", match.id));
    const snap = await getDocs(q);
    setOtherPicks(snap.docs.map(d => d.data()).filter(p => p.userId !== user.uid));
  };

  const savePicks = async () => {
    if (!myPicks.inn1 || !myPicks.inn2) return alert("Select both!");
    await setDoc(doc(db, "match_picks", `${selectedMatch.id}_${user.uid}`), {
      userId: user.uid, userName: user.displayName, matchId: selectedMatch.id,
      inn1: parseInt(myPicks.inn1), inn2: parseInt(myPicks.inn2), timestamp: new Date()
    });
    setMyPicks(p => ({ ...p, locked: true }));
    alert("Picks locked!");
  };

  if (loading) return <div style={{color:'white', padding:'20px'}}>Loading...</div>;

  return (
    <div style={{background:'#07080f', minHeight:'100vh', color:'#eee', padding:'20px', fontFamily:'sans-serif'}}>
      {!user ? (
        <div style={{textAlign:'center', marginTop:'100px'}}>
          <h1 style={{color:'#f0c040'}}>ટ્રાફિકવાળાનો સટ્ટો</h1>
          <button onClick={loginWithGoogle} style={{padding:'15px 30px', background:'#ff5f1f', color:'white', border:'none', borderRadius:'8px', cursor:'pointer'}}>Login with Google</button>
        </div>
      ) : (
        <>
          <div style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid #333', paddingBottom:'10px'}}>
            <span>👤 {user.displayName}</span>
            <button onClick={logout} style={{color:'#ff3d5a', background:'none', border:'none', cursor:'pointer'}}>Logout</button>
          </div>
          {!selectedMatch ? (
            <div style={{marginTop:'20px'}}>
              <h3>Available Matches (Past & Next 3 Days)</h3>
              {matches.map(m => (
                <div key={m.id} onClick={() => handleSelectMatch(m)} style={{background:'#13141f', padding:'15px', margin:'10px 0', borderRadius:'8px', cursor:'pointer', border:'1px solid #252638'}}>
                  {m.name}
                </div>
              ))}
            </div>
          ) : (
            <div style={{background:'#13141f', padding:'20px', borderRadius:'12px', marginTop:'20px'}}>
              <button onClick={() => setSelectedMatch(null)} style={{color:'#777', background:'none', border:'none', cursor:'pointer'}}>← Back</button>
              <h2>{selectedMatch.name}</h2>
              <div style={{marginTop:'20px'}}>
                <label>Inn1 Player #</label>
                <input type="number" disabled={myPicks.locked} value={myPicks.inn1} onChange={e => setMyPicks({...myPicks, inn1: e.target.value})} style={{width:'100%', padding:'10px', margin:'10px 0', background:'#000', color:'#fff', border:'1px solid #444'}}/>
                <label>Inn2 Player #</label>
                <input type="number" disabled={myPicks.locked} value={myPicks.inn2} onChange={e => setMyPicks({...myPicks, inn2: e.target.value})} style={{width:'100%', padding:'10px', margin:'10px 0', background:'#000', color:'#fff', border:'1px solid #444'}}/>
                {!myPicks.locked && <button onClick={savePicks} style={{width:'100%', padding:'12px', background:'#ff5f1f', color:'white', border:'none', borderRadius:'5px', cursor:'pointer'}}>Lock Picks</button>}
              </div>
              <div style={{marginTop:'30px'}}>
                <h4>Friends' Picks</h4>
                {otherPicks.map((p, i) => <div key={i} style={{padding:'8px 0', borderBottom:'1px solid #222'}}>{p.userName}: Inn1:#{p.inn1} | Inn2:#{p.inn2}</div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;