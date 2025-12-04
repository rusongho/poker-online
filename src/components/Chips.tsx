import React from 'react';

interface ChipsProps {
  amount: number;
}

const Chips: React.FC<ChipsProps> = ({ amount }) => {
  if (amount === 0) return null;
  return (
    <div className="flex items-center justify-center space-x-[-4px]">
      <div className="bg-yellow-400 border-2 border-dashed border-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg text-[10px] font-bold text-black z-10">
        $
      </div>
      <div className="bg-black/50 px-2 py-0.5 rounded-r-md text-xs text-yellow-300 font-mono ml-2">
        {amount}
      </div>
    </div>
  );
};

export default Chips;