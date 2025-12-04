import React from 'react';
import { Player, PlayerStatus, SEAT_POSITIONS } from '../types';
import Card from './Card';
import Chips from './Chips';

interface SeatProps {
  index: number;
  player: Player | null;
  isActive: boolean;
  isDealer: boolean;
  onSit: (index: number) => void;
  onLeave: (index: number) => void;
  showCards: boolean; // For showdown or user's own cards
}

const Seat: React.FC<SeatProps> = ({ index, player, isActive, isDealer, onSit, onLeave, showCards }) => {
  const position = SEAT_POSITIONS[index];
  
  if (!player || player.status === PlayerStatus.EMPTY) {
    return (
      <div 
        className="absolute w-24 h-24 flex flex-col items-center justify-center cursor-pointer opacity-50 hover:opacity-100 transition-opacity group"
        style={{ ...position }}
        onClick={() => onSit(index)}
      >
        <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-400 flex items-center justify-center bg-black/20 group-hover:bg-white/10">
          <span className="text-2xl text-gray-400">+</span>
        </div>
        <span className="text-xs text-gray-400 mt-1 font-bold tracking-wider">SIT</span>
      </div>
    );
  }

  const isFolded = player.status === PlayerStatus.FOLDED;
  const isAllIn = player.status === PlayerStatus.ALL_IN;
  const isBusted = player.status === PlayerStatus.BUSTED;

  return (
    <div 
      className={`absolute flex flex-col items-center transition-all duration-300 ${isActive ? 'scale-110 z-20' : 'z-10'} ${isFolded ? 'opacity-50 grayscale' : ''}`}
      style={{ ...position }}
    >
      {/* Cards */}
      <div className="flex space-x-1 mb-1 relative h-14">
        {player.cards.length > 0 && !isBusted && (
            <>
                <div className={`transform transition-transform ${isFolded ? 'translate-y-2' : ''}`}>
                    <Card card={player.cards[0]} hidden={!showCards} size="sm" />
                </div>
                <div className={`transform transition-transform ${isFolded ? 'translate-y-2' : ''} -ml-4`}>
                    <Card card={player.cards[1]} hidden={!showCards} size="sm" />
                </div>
            </>
        )}
      </div>

      {/* Avatar Circle */}
      <div className={`relative w-16 h-16 rounded-full border-4 flex items-center justify-center bg-gray-800 shadow-xl
        ${isActive ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]' : 'border-gray-600'}
        ${isAllIn ? 'border-red-500' : ''}
      `}>
         <div className="text-xl font-bold">{player.name.charAt(0)}</div>
         
         {/* Dealer Button */}
         {isDealer && (
             <div className="absolute -top-2 -right-2 w-6 h-6 bg-white text-black rounded-full flex items-center justify-center text-xs font-bold border border-gray-400 shadow-md">
                 D
             </div>
         )}
         
         {/* Status Badge */}
         {isAllIn && <div className="absolute -bottom-3 bg-red-600 text-[10px] px-1.5 py-0.5 rounded text-white font-bold">ALL IN</div>}
         {isBusted && <div className="absolute inset-0 bg-black/80 rounded-full flex items-center justify-center text-[10px] text-red-500 font-bold uppercase rotate-12">Bust</div>}
      </div>

      {/* Name & Stack */}
      <div className="bg-black/80 px-3 py-1 rounded-full mt-[-8px] z-10 border border-gray-700 text-center min-w-[80px]">
        <div className="text-xs font-bold truncate max-w-[80px] text-gray-200">{player.name}</div>
        <div className="text-xs text-yellow-400 font-mono">${player.chips}</div>
      </div>

      {/* Current Round Bet */}
      {player.bet > 0 && (
          <div className="absolute top-[-30px] animate-bounce">
              <Chips amount={player.bet} />
          </div>
      )}

      {/* Leave Button (Hover only for simplicity, usually needs a menu) */}
      {!isActive && player.status !== PlayerStatus.PLAYING && (
          <button 
            onClick={(e) => { e.stopPropagation(); onLeave(index); }}
            className="absolute -right-8 top-0 text-red-500 hover:text-red-300 text-xs bg-black/50 rounded-full w-5 h-5 flex items-center justify-center"
            title="Stand Up"
          >
              ✕
          </button>
      )}

    </div>
  );
};

export default React.memo(Seat);