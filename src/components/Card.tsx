import React from 'react';
import { Card as CardType, Suit } from '../types';

interface CardProps {
  card?: CardType;
  hidden?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const Card: React.FC<CardProps> = ({ card, hidden = false, className = '', size = 'md' }) => {
  const isRed = card && (card.suit === Suit.HEARTS || card.suit === Suit.DIAMONDS);
  
  const sizeClasses = {
    sm: 'w-8 h-12 text-xs',
    md: 'w-12 h-16 text-sm',
    lg: 'w-16 h-24 text-lg',
  };

  const baseClasses = `relative rounded-md flex items-center justify-center font-bold shadow-card select-none border border-gray-300 ${sizeClasses[size]} ${className}`;

  if (hidden || !card) {
    return (
      <div className={`${baseClasses} bg-blue-800 border-white`}>
        <div className="w-full h-full opacity-50 bg-[repeating-linear-gradient(45deg,#60a5fa_0px,#60a5fa_2px,#1e3a8a_2px,#1e3a8a_4px)] rounded-md" />
      </div>
    );
  }

  return (
    <div className={`${baseClasses} bg-white ${isRed ? 'text-red-600' : 'text-black'}`}>
      <span className="absolute top-0.5 left-1 leading-none">{card.rank}</span>
      <span className="text-xl leading-none">{card.suit}</span>
      <span className="absolute bottom-0.5 right-1 leading-none rotate-180">{card.rank}</span>
    </div>
  );
};

export default React.memo(Card);