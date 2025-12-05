import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from "socket.io-client";
import { 
  Player, GameState, GamePhase, PlayerStatus, Card as PokerCard 
} from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/poker';
import { getHandAnalysis, getStrategicAdvice } from './services/geminiService';
import Seat from './components/Seat';
import Card from './components/Card';
import Chips from './components/Chips';

const BIG_BLIND = 20;
const SMALL_BLIND = 10;

// Determine Server URL:
// If running on localhost (dev), assume backend is on port 4000.
// If running in production (e.g. deployed to a domain), use relative path (same origin).
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const SERVER_URL = isLocal ? "http://localhost:4000" : window.location.origin;

const App: React.FC = () => {
  // --- UI/Lobby State ---
  const [playerName, setPlayerName] = useState("Player");
  const [gameMode, setGameMode] = useState<'offline' | 'online' | null>(null);
  const [mySeatIndex, setMySeatIndex] = useState<number>(-1); // -1 means spectator or not seated
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // --- Game State ---
  const [players, setPlayers] = useState<(Player | null)[]>(new Array(9).fill(null));
  const [buyInAmount, setBuyInAmount] = useState(1000);
  const [gameState, setGameState] = useState<GameState>({
    pot: 0,
    communityCards: [],
    deck: [],
    phase: GamePhase.IDLE,
    currentPlayerIndex: -1,
    dealerIndex: -1,
    minBet: BIG_BLIND,
    currentBet: 0,
    lastRaiserIndex: null,
    winners: [],
    logs: ['Welcome! Please select a mode to start.'],
  });
  
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAdvice, setAiAdvice] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---
  const addLog = (msg: string) => {
    setGameState(prev => ({ ...prev, logs: [...prev.logs, msg] }));
  };

  const getNextActivePlayerIndex = (startIndex: number, currentPlayers: (Player | null)[]) => {
    let i = (startIndex + 1) % 9;
    let count = 0;
    while (count < 9) {
      const p = currentPlayers[i];
      if (p && p.status === PlayerStatus.PLAYING && p.chips > 0) { 
        return i;
      }
      i = (i + 1) % 9;
      count++;
    }
    return -1;
  };

  const getChipSummary = (currentPlayers: (Player | null)[]) => {
    return currentPlayers
      .filter(p => p !== null)
      .map(p => `${p!.name}: $${p!.chips}`)
      .join(' | ');
  };

  // --- Multiplayer Connection ---
  useEffect(() => {
    if (gameMode === 'online') {
        // Initialize Socket
        const newSocket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
        });

        newSocket.on('connect', () => {
            setIsConnected(true);
            addLog("Connected to server!");
            newSocket.emit('joinGame', { name: playerName });
        });

        newSocket.on('disconnect', () => {
            setIsConnected(false);
            addLog("Disconnected from server.");
        });

        // Server pushes full state updates
        newSocket.on('gameStateUpdate', (serverState: { players: (Player|null)[], gameState: GameState }) => {
            setPlayers(serverState.players);
            setGameState(serverState.gameState);
            
            // Auto-detect my seat if I'm playing (simple name match, robust enough for casual)
            const myIdx = serverState.players.findIndex(p => p && p.name === playerName);
            if (myIdx !== -1) setMySeatIndex(myIdx);
        });

        socketRef.current = newSocket;

        return () => {
            newSocket.disconnect();
        };
    }
  }, [gameMode, playerName]);


  // --- Actions (Hybrid: Online emits, Offline runs logic) ---

  const handleSit = (index: number) => {
    if (gameMode === 'online') {
        socketRef.current?.emit('sit', { seatIndex: index, buyIn: buyInAmount, name: playerName });
        return;
    }

    // Offline Logic
    setPlayers(prev => {
      const newPlayers = [...prev];
      newPlayers[index] = {
        id: Date.now() + index,
        name: gameMode === 'offline' && index === 0 ? playerName : `Player ${index + 1}`, // In offline, seat 0 is 'me' usually
        chips: buyInAmount,
        bet: 0,
        status: PlayerStatus.SITTING_OUT,
        cards: [],
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: false,
        hasActed: false,
      };
      return newPlayers;
    });
    
    // In offline mode, if I sit at seat 0, I am seat 0.
    if (index === 0) setMySeatIndex(0);
    
    addLog(`Player ${index + 1} sat at seat ${index + 1}.`);
  };

  const handleLeave = (index: number) => {
    // Only allow leaving my own seat or if offline
    if (gameMode === 'online' && index !== mySeatIndex) return;

    if (gameMode === 'online') {
        socketRef.current?.emit('standUp', { seatIndex: index });
        setMySeatIndex(-1);
        return;
    }

    // Offline Logic
    setPlayers(prev => {
      const newPlayers = [...prev];
      newPlayers[index] = null;
      return newPlayers;
    });
    if (index === mySeatIndex) setMySeatIndex(-1);
    addLog(`Seat ${index + 1} is now empty.`);
  };

  const updateBuyIn = (amount: number) => {
      setBuyInAmount(amount);
      if (gameState.phase === GamePhase.IDLE && gameMode === 'offline') {
          setPlayers(prev => prev.map(p => {
              if (!p) return null;
              return { ...p, chips: amount };
          }));
      }
  };

  const startGame = () => {
    if (gameMode === 'online') {
        socketRef.current?.emit('startGame');
        return;
    }

    // Offline Logic
    const activeCount = players.filter(p => p !== null).length;
    if (activeCount < 2) {
      addLog("Need at least 2 players to start.");
      return;
    }
    const firstDealer = players.findIndex(p => p !== null);
    setGameState(prev => ({ ...prev, dealerIndex: firstDealer }));
    startNewHand(firstDealer);
  };

  // --- Offline Game Logic (Only runs if gameMode === 'offline') ---

  const startNewHand = (dealerIdx: number) => {
    setAiAnalysis(null);
    setAiAdvice("");
    const deck = shuffleDeck(createDeck());
    
    const activePlayersIndices: number[] = [];
    const newPlayers = players.map((p, idx) => {
      if (!p) return null;
      if (p.chips <= 0) return { ...p, status: PlayerStatus.BUSTED, bet: 0, cards: [], hasActed: false };
      activePlayersIndices.push(idx);
      return { 
        ...p, 
        status: PlayerStatus.PLAYING, 
        bet: 0, 
        cards: [], 
        isDealer: idx === dealerIdx,
        isSmallBlind: false, 
        isBigBlind: false,
        hasActed: false,
      };
    });

    if (activePlayersIndices.length < 2) {
        addLog("Not enough players with chips!");
        setGameState(prev => ({...prev, phase: GamePhase.IDLE}));
        setPlayers(newPlayers);
        return;
    }

    let sbIdx = -1;
    let bbIdx = -1;

    if (activePlayersIndices.length === 2) {
       sbIdx = dealerIdx; 
       bbIdx = activePlayersIndices.find(i => i !== dealerIdx) || -1;
    } else {
       let ptr = (dealerIdx + 1) % 9;
       while(!newPlayers[ptr] || newPlayers[ptr]?.status !== PlayerStatus.PLAYING) ptr = (ptr + 1) % 9;
       sbIdx = ptr;
       
       ptr = (ptr + 1) % 9;
       while(!newPlayers[ptr] || newPlayers[ptr]?.status !== PlayerStatus.PLAYING) ptr = (ptr + 1) % 9;
       bbIdx = ptr;
    }

    if (newPlayers[sbIdx]) {
      const sbAmt = Math.min(SMALL_BLIND, newPlayers[sbIdx]!.chips);
      newPlayers[sbIdx]!.chips -= sbAmt;
      newPlayers[sbIdx]!.bet = sbAmt;
      newPlayers[sbIdx]!.isSmallBlind = true;
      if (newPlayers[sbIdx]!.chips === 0) newPlayers[sbIdx]!.status = PlayerStatus.ALL_IN;
    }

    if (newPlayers[bbIdx]) {
      const bbAmt = Math.min(BIG_BLIND, newPlayers[bbIdx]!.chips);
      newPlayers[bbIdx]!.chips -= bbAmt;
      newPlayers[bbIdx]!.bet = bbAmt;
      newPlayers[bbIdx]!.isBigBlind = true;
      if (newPlayers[bbIdx]!.chips === 0) newPlayers[bbIdx]!.status = PlayerStatus.ALL_IN;
    }

    newPlayers.forEach(p => {
      if (p && p.status === PlayerStatus.PLAYING) {
        p.cards = [deck.pop()!, deck.pop()!];
      }
    });

    let nextToAct = (bbIdx + 1) % 9;
    while(!newPlayers[nextToAct] || newPlayers[nextToAct]?.status !== PlayerStatus.PLAYING) {
        nextToAct = (nextToAct + 1) % 9;
    }

    setPlayers(newPlayers);
    setGameState({
      pot: 0,
      communityCards: [],
      deck,
      phase: GamePhase.PREFLOP,
      currentPlayerIndex: nextToAct,
      dealerIndex: dealerIdx,
      minBet: BIG_BLIND,
      currentBet: BIG_BLIND,
      lastRaiserIndex: bbIdx,
      winners: [],
      logs: [`New hand dealt. Blinds ${SMALL_BLIND}/${BIG_BLIND}.`],
    });
  };

  const collectBetsToPot = (currentPlayers: (Player|null)[]) => {
     let roundPot = 0;
     const updatedPlayers = currentPlayers.map(p => {
         if (!p) return null;
         roundPot += p.bet;
         return { ...p, bet: 0, hasActed: false };
     });
     return { updatedPlayers, roundPot };
  };

  const nextPhase = () => {
    setGameState(prev => {
        const { updatedPlayers, roundPot } = collectBetsToPot(players);
        const newPot = prev.pot + roundPot;
        
        // CRITICAL FIX: Use 'any[]' to bypass strict TypeScript checks that cause build failures
        const newDeck = [...prev.deck] as any[];
        let newCommunityCards = [...prev.communityCards] as any[];
        
        let nextPhase = prev.phase;
        let logMsg = "";

        const activeCount = updatedPlayers.filter(p => p && p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED).length;
        if (activeCount === 1) {
            handleShowdown(updatedPlayers, newCommunityCards, newPot, true);
            return prev; 
        }

        switch (prev.phase) {
            case GamePhase.PREFLOP:
                if (newDeck.length >= 3) {
                    newCommunityCards.push(newDeck.pop()!, newDeck.pop()!, newDeck.pop()!);
                    nextPhase = GamePhase.FLOP;
                    logMsg = "Flop dealt.";
                }
                break;
            case GamePhase.FLOP:
                if (newDeck.length >= 1) {
                    newCommunityCards.push(newDeck.pop()!);
                    nextPhase = GamePhase.TURN;
                    logMsg = "Turn dealt.";
                }
                break;
            case GamePhase.TURN:
                if (newDeck.length >= 1) {
                    newCommunityCards.push(newDeck.pop()!);
                    nextPhase = GamePhase.RIVER;
                    logMsg = "River dealt.";
                }
                break;
            case GamePhase.RIVER:
                nextPhase = GamePhase.SHOWDOWN;
                logMsg = "Showdown!";
                break;
        }

        if (nextPhase === GamePhase.SHOWDOWN) {
            const winners = computeWinners(updatedPlayers, newCommunityCards, newPot);
            const chipSummary = getChipSummary(updatedPlayers);
            setPlayers(updatedPlayers);
            return {
                ...prev,
                pot: 0,
                communityCards: newCommunityCards,
                deck: newDeck,
                phase: GamePhase.SHOWDOWN,
                currentPlayerIndex: -1,
                winners: winners,
                logs: [...prev.logs, logMsg, `End of Hand Stats: ${chipSummary}`]
            };
        }

        let nextIdx = (prev.dealerIndex + 1) % 9;
        let safety = 0;
        while ((!updatedPlayers[nextIdx] || updatedPlayers[nextIdx]!.status !== PlayerStatus.PLAYING) && safety < 10) {
             nextIdx = (nextIdx + 1) % 9;
             safety++;
        }
        
        setPlayers(updatedPlayers);
        return {
            ...prev,
            pot: newPot,
            communityCards: newCommunityCards,
            deck: newDeck,
            phase: nextPhase,
            currentPlayerIndex: nextIdx,
            minBet: 0,
            currentBet: 0,
            lastRaiserIndex: null,
            logs: [...prev.logs, logMsg]
        };
    });
  };

  const computeWinners = (currentPlayers: (Player|null)[], board: PokerCard[], totalPot: number) => {
      const candidates = currentPlayers.filter(p => p && p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
      
      const evaluations = candidates.map(p => {
          if (!p) return null;
          const ev = evaluateHand(p.cards, board);
          return { playerId: p.id, score: ev.score, name: ev.name, playerIndex: currentPlayers.indexOf(p) };
      }).filter(e => e !== null);

      if (evaluations.length === 0) return [];

      evaluations.sort((a, b) => b!.score - a!.score);
      const highScore = evaluations[0]!.score;
      
      const winningEvals = evaluations.filter(e => e!.score === highScore);
      const splitAmount = Math.floor(totalPot / winningEvals.length);

      const updatedPlayers = [...currentPlayers];
      
      const resultWinners = winningEvals.map(w => {
           const pIdx = w!.playerIndex;
           updatedPlayers[pIdx]!.chips += splitAmount;
           return { playerId: w!.playerId, handName: w!.name, amount: splitAmount };
      });

      setPlayers(updatedPlayers);

      const primaryWinner = updatedPlayers[winningEvals[0]!.playerIndex];
      if (primaryWinner) {
         getHandAnalysis(board, primaryWinner.name, winningEvals[0]!.name, totalPot).then(setAiAnalysis);
      }

      return resultWinners;
  };

  const handleShowdown = (currentPlayers: (Player|null)[], board: PokerCard[], totalPot: number, foldedWin: boolean = false) => {
      if (foldedWin) {
          const winner = currentPlayers.find(p => p && p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
          if (winner) {
              const uPlayers = [...currentPlayers];
              const wIdx = uPlayers.indexOf(winner);
              uPlayers[wIdx]!.chips += totalPot;
              setPlayers(uPlayers);
              const chipSummary = getChipSummary(uPlayers);
              setGameState(prev => ({
                  ...prev,
                  pot: 0,
                  phase: GamePhase.SHOWDOWN,
                  winners: [{ playerId: winner.id, handName: 'Opponents Folded', amount: totalPot }],
                  currentPlayerIndex: -1,
                  logs: [...prev.logs, `${winner.name} wins $${totalPot} (opponents folded).`, `End of Hand Stats: ${chipSummary}`]
              }));
          }
      }
  };

  const handleAction = (action: 'fold' | 'check' | 'call' | 'raise', amount: number = 0) => {
      if (gameMode === 'online') {
          socketRef.current?.emit('action', { action, amount });
          return;
      }

      // Offline Logic
      const idx = gameState.currentPlayerIndex;
      if (idx === -1) return;
      
      const player = players[idx];
      if (!player) return;

      let newPlayers = [...players];
      let p = { ...player };
      let newLog = "";
      
      const callAmount = gameState.currentBet - p.bet;

      if (action === 'fold') {
          p.status = PlayerStatus.FOLDED;
          newLog = `${p.name} folds.`;
      } else if (action === 'check') {
          if (callAmount > 0) return;
          newLog = `${p.name} checks.`;
      } else if (action === 'call') {
          const actualCall = Math.min(callAmount, p.chips);
          p.chips -= actualCall;
          p.bet += actualCall;
          if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
          newLog = `${p.name} calls ${actualCall}.`;
      } else if (action === 'raise') {
          const totalBet = gameState.currentBet + amount;
          const addedChips = totalBet - p.bet;
          if (addedChips >= p.chips) {
              p.bet += p.chips;
              p.chips = 0;
              p.status = PlayerStatus.ALL_IN;
              newLog = `${p.name} goes All-In!`;
          } else {
              p.chips -= addedChips;
              p.bet += addedChips;
              newLog = `${p.name} raises to ${p.bet}.`;
          }
      }

      p.hasActed = true;
      newPlayers[idx] = p;
      addLog(newLog);

      setPlayers(newPlayers);
      setGameState(prev => {
          let newCurrentBet = prev.currentBet;
          let newLastRaiser = prev.lastRaiserIndex;

          if (action === 'raise' || (action === 'call' && p.bet > prev.currentBet)) {
              newCurrentBet = p.bet;
              newLastRaiser = idx;
          }

          return {
              ...prev,
              currentBet: newCurrentBet,
              lastRaiserIndex: newLastRaiser,
              logs: [...prev.logs, newLog]
          };
      });
  };

  // Turn Management Effect (Only Offline)
  useEffect(() => {
      if (gameMode !== 'offline') return;
      if (gameState.phase === GamePhase.IDLE || gameState.phase === GamePhase.SHOWDOWN) return;

      const activePlayers = players.filter(p => p && p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
      
      if (activePlayers.length === 1) {
          handleShowdown(players, gameState.communityCards, gameState.pot + players.reduce((a,b)=>a+(b?.bet||0),0), true);
          return;
      }

      const relevantPlayers = players.filter(p => p && p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
      const allMatched = relevantPlayers.every(p => {
          if (p!.status === PlayerStatus.ALL_IN) return true; 
          return p!.bet === gameState.currentBet && p!.hasActed;
      });

      if (allMatched && relevantPlayers.length > 0) {
          const timer = setTimeout(() => {
              nextPhase();
          }, 600);
          return () => clearTimeout(timer);
      }

      const currIdx = gameState.currentPlayerIndex;
      const currPlayer = players[currIdx];

      if (!currPlayer || currPlayer.status !== PlayerStatus.PLAYING) {
           const next = getNextActivePlayerIndex(currIdx, players);
           if (next !== -1 && next !== currIdx) {
               setGameState(prev => ({ ...prev, currentPlayerIndex: next }));
           }
      }

  }, [players, gameState.currentPlayerIndex, gameState.currentBet, gameState.phase, gameMode]);


  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.logs]);


  // --- UI Renders ---

  // 1. Lobby Screen
  if (!gameMode) {
      return (
          <div className="w-full h-full bg-gray-900 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] opacity-20"></div>
              <div className="z-10 bg-gray-800 p-8 rounded-2xl border-4 border-yellow-600 shadow-2xl max-w-md w-full text-center">
                  <h1 className="text-4xl font-bold text-yellow-500 mb-2">TEXAS HOLD'EM</h1>
                  <p className="text-gray-400 mb-8 tracking-widest text-xs uppercase">AI Arena & Online Multiplayer</p>
                  
                  <div className="mb-6 text-left">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Your Name</label>
                      <input 
                        type="text" 
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white focus:border-yellow-500 focus:outline-none transition-colors"
                        maxLength={12}
                      />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => { setGameMode('offline'); setMySeatIndex(0); handleSit(0); }} // Auto sit seat 0 in offline
                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 rounded border-2 border-gray-600 hover:border-white transition-all"
                      >
                          Offline Practice
                          <span className="block text-[10px] font-normal text-gray-400 mt-1">vs Local Logic</span>
                      </button>
                      <button 
                        onClick={() => setGameMode('online')}
                        className="bg-blue-900 hover:bg-blue-800 text-white font-bold py-4 rounded border-2 border-blue-600 hover:border-blue-400 transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)]"
                      >
                          Join Online
                          <span className="block text-[10px] font-normal text-blue-300 mt-1">Connect to Server</span>
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  // 2. Main Game Table
  const currentPlayer = gameState.currentPlayerIndex !== -1 ? players[gameState.currentPlayerIndex] : null;
  // In Online mode, it is my turn ONLY if the current player index matches my seat index
  const isMyTurn = gameState.currentPlayerIndex === mySeatIndex; 
  // In Offline mode, I control everyone (Hotseat) OR just seat 0? Let's keep hotseat for offline for now or seat 0.
  // Actually, user requested "Multiplayer". So Offline should probably be "Hotseat" (debug mode) or AI.
  // For simplicity: Offline = I control whoever is active. Online = I only control my seat.
  const canAct = gameMode === 'online' ? isMyTurn : true;

  const callAmount = currentPlayer ? gameState.currentBet - currentPlayer.bet : 0;
  const minRaise = BIG_BLIND; 

  const requestAdvice = async () => {
      // Logic to get advice for "Me"
      const p = players[mySeatIndex];
      if (!p) return;
      
      setIsProcessing(true);
      const advice = await getStrategicAdvice(
          p.cards, 
          gameState.communityCards, 
          gameState.phase, 
          gameState.pot + players.reduce((a, b) => a + (b?.bet || 0), 0),
          gameState.currentBet - p.bet
      );
      setAiAdvice(advice);
      setIsProcessing(false);
  };

  return (
    <div className="relative w-full h-full bg-gray-900 overflow-hidden flex flex-col font-sans">
      
      {/* Header */}
      <div className="absolute top-4 left-4 z-50 pointer-events-none">
        <h1 className="text-2xl font-bold text-yellow-500 tracking-wider" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
            TEXAS HOLD'EM <span className="text-xs text-white inline-block opacity-70 ml-2 border-l pl-2 border-white/30">{gameMode === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
        </h1>
        {gameMode === 'online' && (
            <div className={`text-xs mt-1 font-bold ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
                {isConnected ? '● Connected' : '○ Disconnected (Start Server)'}
            </div>
        )}
      </div>

      {/* Main Table Area */}
      <div className="flex-1 relative flex items-center justify-center bg-gray-900 perspective-1000">
        
        {/* The Felt */}
        <div className="relative w-[90%] max-w-[1000px] aspect-[1.8/1] bg-felt rounded-[300px] border-[16px] border-[#3a2a1a] shadow-[0_0_50px_rgba(0,0,0,0.8),inset_0_0_100px_rgba(0,0,0,0.6)] flex items-center justify-center">
            
            {/* Community Cards */}
            <div className="flex space-x-2 z-10 mb-8">
                {gameState.communityCards.map((c, i) => (
                    <Card key={i} card={c} className="shadow-2xl" />
                ))}
                {Array(5 - gameState.communityCards.length).fill(0).map((_, i) => (
                    <div key={`placeholder-${i}`} className="w-12 h-16 border-2 border-white/10 rounded-md" />
                ))}
            </div>

            {/* Pot Display */}
            <div className="absolute top-[60%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <div className="text-white/50 text-xs font-bold uppercase tracking-widest mb-1">Total Pot</div>
                <div className="flex items-center space-x-1 bg-black/40 px-4 py-1 rounded-full border border-white/10">
                    <span className="text-yellow-400 font-mono text-lg">${gameState.pot + players.reduce((a, b) => a + (b?.bet || 0), 0)}</span>
                </div>
                <div className="h-4"></div>
                {gameState.phase === GamePhase.SHOWDOWN && gameState.winners.length > 0 && (
                     <div className="bg-yellow-500 text-black px-3 py-1 rounded font-bold animate-pulse shadow-lg whitespace-nowrap z-50">
                        {gameState.winners.map(w => `${players[players.findIndex(p => p?.id === w.playerId)]?.name} wins $${w.amount} (${w.handName})`).join(', ')}
                     </div>
                )}
            </div>
            
            {/* Seats */}
            {players.map((p, i) => (
                <Seat 
                    key={i} 
                    index={i} 
                    player={p} 
                    isActive={gameState.currentPlayerIndex === i}
                    isDealer={gameState.dealerIndex === i}
                    onSit={handleSit} 
                    onLeave={handleLeave}
                    // Show cards if: Showdown OR It's ME OR Offline Mode (Hotseat)
                    showCards={gameState.phase === GamePhase.SHOWDOWN || (p?.status === PlayerStatus.PLAYING && (i === mySeatIndex || gameMode === 'offline'))}
                />
            ))}
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className="h-24 bg-gray-950 border-t border-gray-800 flex items-center justify-between px-6 z-50">
        
        {/* Left: Game State Info */}
        <div className="text-gray-400 text-sm w-1/4">
            <div>Blinds: <span className="text-white">${SMALL_BLIND}/${BIG_BLIND}</span></div>
            <div>Phase: <span className="text-yellow-500">{gameState.phase}</span></div>
            
            {gameState.phase === GamePhase.IDLE && (
                <div className="flex flex-col space-y-2 mt-2">
                    <div className="flex items-center space-x-2">
                        <label className="text-xs text-gray-500">Buy-in:</label>
                        <input 
                            type="number" 
                            min="100"
                            step="100"
                            value={buyInAmount}
                            onChange={(e) => updateBuyIn(parseInt(e.target.value) || 0)}
                            className="w-20 bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1 rounded focus:outline-none focus:border-yellow-500"
                        />
                    </div>
                    {/* Only show Start Game if Offline OR if Online and I am sitting (simplified host logic) */}
                    {(gameMode === 'offline' || (gameMode === 'online' && mySeatIndex !== -1)) && (
                        <button 
                            onClick={startGame}
                            className="bg-green-600 hover:bg-green-500 text-white font-bold py-1 px-4 rounded shadow-lg transition-colors w-max"
                        >
                            START GAME
                        </button>
                    )}
                </div>
            )}
        </div>

        {/* Center: Log */}
        <div className="flex-1 mx-4 h-20 bg-black/50 rounded p-2 overflow-y-auto scrollbar-hide text-xs font-mono text-gray-300 border border-gray-800">
            {gameState.logs.map((log, i) => (
                <div key={i} className="mb-0.5 opacity-80">{`> ${log}`}</div>
            ))}
            <div ref={logsEndRef} />
        </div>

        {/* Right: Actions */}
        <div className="w-1/3 flex items-center justify-end space-x-2">
            
            {/* AI Advisor Area */}
            {gameState.phase !== GamePhase.IDLE && gameState.phase !== GamePhase.SHOWDOWN && mySeatIndex !== -1 && (
                <div className="mr-4 flex flex-col items-end">
                     {aiAdvice && <div className="text-[10px] text-cyan-300 mb-1 max-w-[200px] text-right bg-black/60 p-1 rounded border border-cyan-900">{aiAdvice}</div>}
                     <button 
                        onClick={requestAdvice}
                        disabled={isProcessing}
                        className="text-xs text-cyan-500 hover:text-cyan-300 underline disabled:opacity-50"
                     >
                         {isProcessing ? 'Thinking...' : 'Ask AI Advisor'}
                     </button>
                </div>
            )}

            {gameState.currentPlayerIndex !== -1 && (
                <div className={`flex space-x-2 transition-opacity ${canAct ? 'opacity-100' : 'opacity-30 pointer-events-none grayscale'}`}>
                    <button onClick={() => handleAction('fold')} className="bg-red-900/80 hover:bg-red-700 text-red-200 border border-red-800 font-bold py-2 px-4 rounded transition-all">
                        Fold
                    </button>
                    <button onClick={() => handleAction(callAmount === 0 ? 'check' : 'call')} className="bg-blue-900/80 hover:bg-blue-700 text-blue-200 border border-blue-800 font-bold py-2 px-4 rounded transition-all">
                        {callAmount === 0 ? 'Check' : `Call $${callAmount}`}
                    </button>
                    <button onClick={() => handleAction('raise', BIG_BLIND)} className="bg-yellow-700/80 hover:bg-yellow-600 text-yellow-100 border border-yellow-600 font-bold py-2 px-4 rounded transition-all">
                        Raise ${minRaise}
                    </button>
                </div>
            )}

            {gameState.phase === GamePhase.SHOWDOWN && (gameMode === 'offline' || mySeatIndex !== -1) && (
                 <button 
                    onClick={() => gameMode === 'online' ? socketRef.current?.emit('startGame') : startNewHand((gameState.dealerIndex + 1) % 9)}
                    className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded shadow-[0_0_15px_rgba(22,163,74,0.5)] animate-pulse"
                >
                    Next Hand
                </button>
            )}
        </div>
      </div>

      {/* Gemini Commentary Overlay */}
      {aiAnalysis && (
          <div className="absolute top-20 right-10 w-64 bg-black/90 border border-purple-500 text-white p-4 rounded-lg shadow-2xl z-50 animate-fade-in-up">
              <div className="flex items-center mb-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-ping mr-2"></div>
                  <h3 className="text-purple-400 font-bold text-sm uppercase">AI Commentary</h3>
              </div>
              <p className="text-sm italic text-gray-300 leading-relaxed">"{aiAnalysis}"</p>
          </div>
      )}

    </div>
  );
};

export default App;