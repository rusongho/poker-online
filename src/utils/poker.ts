import { Card, Rank, Suit } from '../types';

const RANK_VALUES: Record<Rank, number> = {
  [Rank.TWO]: 2, [Rank.THREE]: 3, [Rank.FOUR]: 4, [Rank.FIVE]: 5,
  [Rank.SIX]: 6, [Rank.SEVEN]: 7, [Rank.EIGHT]: 8, [Rank.NINE]: 9,
  [Rank.TEN]: 10, [Rank.JACK]: 11, [Rank.QUEEN]: 12, [Rank.KING]: 13, [Rank.ACE]: 14,
};

export const createDeck = (): Card[] => {
  const suits = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
  const ranks = Object.values(Rank);
  const deck: Card[] = [];
  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      deck.push({ suit, rank, value: RANK_VALUES[rank] });
    });
  });
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

// --- Simplified Hand Evaluator ---
// Returns a numeric score. Higher is better.
// Format: Type (1-9) * 1,000,000 + TieBreakers

export const evaluateHand = (holeCards: Card[], communityCards: Card[]): { score: number; name: string } => {
  const cards = [...holeCards, ...communityCards].sort((a, b) => b.value - a.value);
  
  const isFlush = (cs: Card[]) => {
    const suits: Record<string, number> = {};
    cs.forEach(c => suits[c.suit] = (suits[c.suit] || 0) + 1);
    const flushSuit = Object.keys(suits).find(s => suits[s] >= 5);
    if (!flushSuit) return null;
    return cs.filter(c => c.suit === flushSuit).slice(0, 5);
  };

  const isStraight = (cs: Card[]) => {
    const uniqueValues = Array.from(new Set(cs.map(c => c.value))).sort((a, b) => b - a);
    for (let i = 0; i <= uniqueValues.length - 5; i++) {
      if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
        return uniqueValues[i]; // High card of straight
      }
    }
    // Ace low straight (5,4,3,2,A)
    if (uniqueValues.includes(14) && uniqueValues.includes(5) && uniqueValues.includes(4) && uniqueValues.includes(3) && uniqueValues.includes(2)) {
      return 5;
    }
    return null;
  };

  const countRanks = (cs: Card[]) => {
    const counts: Record<number, number> = {};
    cs.forEach(c => counts[c.value] = (counts[c.value] || 0) + 1);
    return counts;
  };

  const flushCards = isFlush(cards);
  const straightHigh = isStraight(cards);
  const rankCounts = countRanks(cards);
  
  const quads = Object.keys(rankCounts).find(r => rankCounts[parseInt(r)] === 4);
  const trips = Object.keys(rankCounts).filter(r => rankCounts[parseInt(r)] === 3).sort((a,b) => parseInt(b)-parseInt(a));
  const pairs = Object.keys(rankCounts).filter(r => rankCounts[parseInt(r)] === 2).sort((a,b) => parseInt(b)-parseInt(a));

  // 1. Straight Flush
  if (flushCards) {
    const sfHigh = isStraight(flushCards);
    if (sfHigh) return { score: 9000000 + sfHigh, name: 'Straight Flush' };
  }

  // 2. Four of a Kind
  if (quads) {
    const kicker = cards.find(c => c.value !== parseInt(quads))?.value || 0;
    return { score: 8000000 + (parseInt(quads) * 100) + kicker, name: 'Four of a Kind' };
  }

  // 3. Full House
  if (trips.length > 0 && (trips.length >= 2 || pairs.length > 0)) {
    const t = parseInt(trips[0]);
    const p = trips.length >= 2 ? parseInt(trips[1]) : parseInt(pairs[0]);
    return { score: 7000000 + (t * 100) + p, name: 'Full House' };
  }

  // 4. Flush
  if (flushCards) {
    return { score: 6000000 + flushCards[0].value, name: 'Flush' };
  }

  // 5. Straight
  if (straightHigh) {
    return { score: 5000000 + straightHigh, name: 'Straight' };
  }

  // 6. Three of a Kind
  if (trips.length > 0) {
    const t = parseInt(trips[0]);
    const kickers = cards.filter(c => c.value !== t).slice(0, 2);
    const kScore = (kickers[0]?.value || 0) * 10 + (kickers[1]?.value || 0);
    return { score: 4000000 + (t * 1000) + kScore, name: 'Three of a Kind' };
  }

  // 7. Two Pair
  if (pairs.length >= 2) {
    const p1 = parseInt(pairs[0]);
    const p2 = parseInt(pairs[1]);
    const kicker = cards.find(c => c.value !== p1 && c.value !== p2)?.value || 0;
    return { score: 3000000 + (p1 * 1000) + (p2 * 10) + kicker, name: 'Two Pair' };
  }

  // 8. One Pair
  if (pairs.length > 0) {
    const p = parseInt(pairs[0]);
    const kickers = cards.filter(c => c.value !== p).slice(0, 3);
    const kScore = kickers.reduce((acc, c, i) => acc + c.value * Math.pow(0.1, i), 0);
    return { score: 2000000 + (p * 100) + kScore, name: 'One Pair' };
  }

  // 9. High Card
  return { score: 1000000 + cards[0].value, name: 'High Card' };
};