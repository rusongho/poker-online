export enum Suit {
  HEARTS = '♥',
  DIAMONDS = '♦',
  CLUBS = '♣',
  SPADES = '♠',
}

export enum Rank {
  TWO = '2', THREE = '3', FOUR = '4', FIVE = '5', SIX = '6', SEVEN = '7',
  EIGHT = '8', NINE = '9', TEN = '10', JACK = 'J', QUEEN = 'Q', KING = 'K', ACE = 'A',
}

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // 2-14 for comparison
}

export enum PlayerStatus {
  EMPTY = 'EMPTY',
  SITTING_OUT = 'SITTING_OUT',
  PLAYING = 'PLAYING',
  FOLDED = 'FOLDED',
  ALL_IN = 'ALL_IN',
  BUSTED = 'BUSTED',
}

export interface Player {
  id: number;
  name: string;
  chips: number;
  bet: number; // Current round bet
  status: PlayerStatus;
  cards: Card[];
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  hasActed: boolean; // For current round logic
}

export enum GamePhase {
  IDLE = 'IDLE',
  PREFLOP = 'PREFLOP',
  FLOP = 'FLOP',
  TURN = 'TURN',
  RIVER = 'RIVER',
  SHOWDOWN = 'SHOWDOWN',
}

export interface GameState {
  pot: number;
  communityCards: Card[];
  deck: Card[];
  phase: GamePhase;
  currentPlayerIndex: number;
  dealerIndex: number;
  minBet: number; // Big Blind amount
  currentBet: number; // Highest bet in current round to match
  lastRaiserIndex: number | null;
  winners: { playerId: number; handName: string; amount: number }[];
  logs: string[];
}

export const SEAT_POSITIONS = [
  { top: '85%', left: '50%', transform: 'translate(-50%, -50%)' }, // User (Seat 0)
  { top: '80%', left: '20%', transform: 'translate(-50%, -50%)' }, // Seat 1
  { top: '50%', left: '5%', transform: 'translate(-50%, -50%)' },  // Seat 2
  { top: '20%', left: '20%', transform: 'translate(-50%, -50%)' }, // Seat 3
  { top: '10%', left: '40%', transform: 'translate(-50%, -50%)' }, // Seat 4
  { top: '10%', left: '60%', transform: 'translate(-50%, -50%)' }, // Seat 5
  { top: '20%', left: '80%', transform: 'translate(-50%, -50%)' }, // Seat 6
  { top: '50%', left: '95%', transform: 'translate(-50%, -50%)' }, // Seat 7
  { top: '80%', left: '80%', transform: 'translate(-50%, -50%)' }, // Seat 8
];