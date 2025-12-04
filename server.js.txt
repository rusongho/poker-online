import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve static files from the dist directory (Vite build output)
app.use(express.static(path.join(__dirname, 'dist')));

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- Constants ---
const BIG_BLIND = 20;
const SMALL_BLIND = 10;
const Suit = { HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣', SPADES: '♠' };
const Rank = { TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9', TEN: '10', JACK: 'J', QUEEN: 'Q', KING: 'K', ACE: 'A' };
const RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// --- Game State ---
let players = new Array(9).fill(null);
let gameState = {
    pot: 0,
    communityCards: [],
    deck: [],
    phase: 'IDLE',
    currentPlayerIndex: -1,
    dealerIndex: -1,
    minBet: BIG_BLIND,
    currentBet: 0,
    lastRaiserIndex: null,
    winners: [],
    logs: ['Waiting for players...'],
};

// --- Poker Logic (Simplified Helpers) ---
function createDeck() {
    const deck = [];
    Object.values(Suit).forEach(suit => {
        Object.values(Rank).forEach(rank => {
            deck.push({ suit, rank, value: RANK_VALUES[rank] });
        });
    });
    return deck;
}

function shuffleDeck(deck) {
    const newDeck = [...deck];
    for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    return newDeck;
}

function evaluateHand(holeCards, communityCards) {
    const cards = [...holeCards, ...communityCards].sort((a, b) => b.value - a.value);
    
    const isFlush = (cs) => {
        const suits = {};
        cs.forEach(c => suits[c.suit] = (suits[c.suit] || 0) + 1);
        const flushSuit = Object.keys(suits).find(s => suits[s] >= 5);
        return flushSuit ? cs.filter(c => c.suit === flushSuit).slice(0, 5) : null;
    };
    
    const isStraight = (cs) => {
        const unique = Array.from(new Set(cs.map(c => c.value))).sort((a, b) => b - a);
        for (let i = 0; i <= unique.length - 5; i++) {
            if (unique[i] - unique[i + 4] === 4) return unique[i];
        }
        if (unique.includes(14) && unique.includes(5) && unique.includes(2)) return 5; 
        return null;
    };

    const counts = {};
    cards.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);
    const quads = Object.keys(counts).find(r => counts[r] === 4);
    const trips = Object.keys(counts).filter(r => counts[r] === 3).sort((a,b) => b-a);
    const pairs = Object.keys(counts).filter(r => counts[r] === 2).sort((a,b) => b-a);
    const flush = isFlush(cards);
    const straight = isStraight(cards);

    if (flush && isStraight(flush)) return { score: 9000000 + isStraight(flush), name: 'Straight Flush' };
    if (quads) return { score: 8000000 + parseInt(quads), name: 'Four of a Kind' };
    if (trips.length > 0 && (trips.length >= 2 || pairs.length > 0)) return { score: 7000000 + parseInt(trips[0]), name: 'Full House' };
    if (flush) return { score: 6000000 + flush[0].value, name: 'Flush' };
    if (straight) return { score: 5000000 + straight, name: 'Straight' };
    if (trips.length > 0) return { score: 4000000 + parseInt(trips[0]), name: 'Three of a Kind' };
    if (pairs.length >= 2) return { score: 3000000 + parseInt(pairs[0]), name: 'Two Pair' };
    if (pairs.length > 0) return { score: 2000000 + parseInt(pairs[0]), name: 'One Pair' };
    return { score: 1000000 + cards[0].value, name: 'High Card' };
}

function addLog(msg) {
    gameState.logs.push(msg);
    if (gameState.logs.length > 50) gameState.logs.shift();
}

function broadcastState() {
    const publicPlayers = players.map(p => {
        if (!p) return null;
        // In a real app, hide cards here unless showdown or it's the specific user
        return p; 
    });
    io.emit('gameStateUpdate', { players: publicPlayers, gameState });
}

function nextPhase() {
    let roundPot = 0;
    players.forEach(p => {
        if (p) {
            roundPot += p.bet;
            p.bet = 0;
            p.hasActed = false;
        }
    });
    gameState.pot += roundPot;

    const activePlayers = players.filter(p => p && p.status !== 'FOLDED' && p.status !== 'BUSTED');
    if (activePlayers.length === 1) {
        handleShowdown(true);
        return;
    }

    if (gameState.phase === 'PREFLOP') {
        gameState.communityCards.push(gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop());
        gameState.phase = 'FLOP';
        addLog("Flop dealt.");
    } else if (gameState.phase === 'FLOP') {
        gameState.communityCards.push(gameState.deck.pop());
        gameState.phase = 'TURN';
        addLog("Turn dealt.");
    } else if (gameState.phase === 'TURN') {
        gameState.communityCards.push(gameState.deck.pop());
        gameState.phase = 'RIVER';
        addLog("River dealt.");
    } else if (gameState.phase === 'RIVER') {
        gameState.phase = 'SHOWDOWN';
        addLog("Showdown!");
        computeWinners();
        return;
    } else if (gameState.phase === 'SHOWDOWN') {
        return;
    }

    gameState.currentBet = 0;
    gameState.lastRaiserIndex = null;
    gameState.minBet = 0;
    
    let nextIdx = (gameState.dealerIndex + 1) % 9;
    while (!players[nextIdx] || players[nextIdx].status !== 'PLAYING') {
        nextIdx = (nextIdx + 1) % 9;
    }
    gameState.currentPlayerIndex = nextIdx;
    broadcastState();
}

function computeWinners() {
    const candidates = players.filter(p => p && p.status !== 'FOLDED' && p.status !== 'BUSTED');
    const evals = candidates.map(p => {
        const ev = evaluateHand(p.cards, gameState.communityCards);
        return { playerId: p.id, score: ev.score, name: ev.name, index: players.indexOf(p) };
    });
    
    if (evals.length === 0) return;

    evals.sort((a,b) => b.score - a.score);
    const bestScore = evals[0].score;
    const winners = evals.filter(e => e.score === bestScore);
    const splitAmt = Math.floor(gameState.pot / winners.length);

    winners.forEach(w => {
        players[w.index].chips += splitAmt;
        gameState.winners.push({ playerId: w.playerId, handName: w.name, amount: splitAmt });
    });
    
    gameState.pot = 0;
    gameState.currentPlayerIndex = -1;
    
    const chipSummary = players.filter(p=>p).map(p=>`${p.name}: $${p.chips}`).join(" | ");
    addLog(`End of Hand. Stats: ${chipSummary}`);
    
    broadcastState();
}

function handleShowdown(foldedWin) {
    if (foldedWin) {
        const winner = players.find(p => p && p.status !== 'FOLDED' && p.status !== 'BUSTED');
        if (winner) {
            winner.chips += gameState.pot;
            gameState.winners = [{ playerId: winner.id, handName: 'Opponents Folded', amount: gameState.pot }];
            addLog(`${winner.name} wins $${gameState.pot} (opponents folded).`);
            gameState.pot = 0;
            gameState.phase = 'SHOWDOWN';
            gameState.currentPlayerIndex = -1;
            broadcastState();
        }
    }
}

io.on('connection', (socket) => {
    socket.emit('gameStateUpdate', { players, gameState });

    socket.on('sit', ({ seatIndex, buyIn, name }) => {
        if (players[seatIndex]) return;
        players[seatIndex] = {
            id: socket.id, 
            name: name || `Player ${seatIndex + 1}`,
            chips: buyIn,
            bet: 0,
            status: 'SITTING_OUT',
            cards: [],
            isDealer: false,
            isSmallBlind: false,
            isBigBlind: false,
            hasActed: false
        };
        addLog(`${name} sat at Seat ${seatIndex + 1}.`);
        broadcastState();
    });

    socket.on('standUp', ({ seatIndex }) => {
        // Allow anyone to kick a seat if it's debug, or check socket id
        if (players[seatIndex] && players[seatIndex].id === socket.id) {
            addLog(`${players[seatIndex].name} stood up.`);
            players[seatIndex] = null;
            broadcastState();
        }
    });

    socket.on('startGame', () => {
        const activeIdxs = [];
        players.forEach((p, i) => {
            if (p && p.chips > 0) {
                p.status = 'PLAYING';
                p.cards = [];
                p.bet = 0;
                p.hasActed = false;
                p.isDealer = false;
                p.isSmallBlind = false;
                p.isBigBlind = false;
                activeIdxs.push(i);
            }
        });

        if (activeIdxs.length < 2) {
            addLog("Need at least 2 active players to start.");
            broadcastState();
            return;
        }

        gameState.deck = shuffleDeck(createDeck());
        gameState.communityCards = [];
        gameState.pot = 0;
        gameState.winners = [];
        gameState.logs = [];

        let nextDealer = -1;
        if (gameState.dealerIndex === -1) {
            nextDealer = activeIdxs[0];
        } else {
            let currPtr = activeIdxs.indexOf(gameState.dealerIndex);
            if (currPtr === -1) currPtr = 0;
            nextDealer = activeIdxs[(currPtr + 1) % activeIdxs.length];
        }
        gameState.dealerIndex = nextDealer;
        players[nextDealer].isDealer = true;

        let sbPtr = (activeIdxs.indexOf(nextDealer) + 1) % activeIdxs.length;
        let bbPtr = (activeIdxs.indexOf(nextDealer) + 2) % activeIdxs.length;
        if (activeIdxs.length === 2) {
            sbPtr = activeIdxs.indexOf(nextDealer);
            bbPtr = (sbPtr + 1) % 2;
        }

        const sbIdx = activeIdxs[sbPtr];
        const bbIdx = activeIdxs[bbPtr];

        players[sbIdx].chips -= SMALL_BLIND;
        players[sbIdx].bet = SMALL_BLIND;
        players[sbIdx].isSmallBlind = true;

        players[bbIdx].chips -= BIG_BLIND;
        players[bbIdx].bet = BIG_BLIND;
        players[bbIdx].isBigBlind = true;

        activeIdxs.forEach(i => {
            players[i].cards = [gameState.deck.pop(), gameState.deck.pop()];
        });

        let firstActPtr = (bbPtr + 1) % activeIdxs.length;
        gameState.currentPlayerIndex = activeIdxs[firstActPtr];
        
        gameState.phase = 'PREFLOP';
        gameState.minBet = BIG_BLIND;
        gameState.currentBet = BIG_BLIND;
        gameState.lastRaiserIndex = bbIdx;
        
        addLog(`New Hand. Blinds ${SMALL_BLIND}/${BIG_BLIND}.`);
        broadcastState();
    });

    socket.on('action', ({ action, amount }) => {
        const idx = gameState.currentPlayerIndex;
        if (idx === -1 || !players[idx]) return;
        
        const p = players[idx];
        const callAmount = gameState.currentBet - p.bet;

        let log = "";
        if (action === 'fold') {
            p.status = 'FOLDED';
            log = `${p.name} folds.`;
        } else if (action === 'check') {
            log = `${p.name} checks.`;
        } else if (action === 'call') {
            const amt = Math.min(callAmount, p.chips);
            p.chips -= amt;
            p.bet += amt;
            if (p.chips === 0) p.status = 'ALL_IN';
            log = `${p.name} calls.`;
        } else if (action === 'raise') {
            const totalBet = gameState.currentBet + amount; 
            const needed = totalBet - p.bet;
            if (needed >= p.chips) {
                 p.bet += p.chips;
                 p.chips = 0;
                 p.status = 'ALL_IN';
                 log = `${p.name} goes All-in!`;
            } else {
                 p.chips -= needed;
                 p.bet += needed;
                 log = `${p.name} raises to ${p.bet}.`;
            }
            gameState.currentBet = p.bet;
            gameState.lastRaiserIndex = idx;
        }

        p.hasActed = true;
        addLog(log);

        const active = players.filter(pl => pl && pl.status !== 'FOLDED' && pl.status !== 'BUSTED');
        const allActed = active.every(pl => pl.status === 'ALL_IN' || (pl.bet === gameState.currentBet && pl.hasActed));

        if (allActed && active.length > 0) {
            setTimeout(nextPhase, 500);
        } else {
            let next = (idx + 1) % 9;
            while (!players[next] || players[next].status !== 'PLAYING' || players[next].status === 'ALL_IN') {
                next = (next + 1) % 9;
                if (next === idx) break; 
            }
            gameState.currentPlayerIndex = next;
        }

        broadcastState();
    });
});

// Serve frontend in production (catch-all)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});