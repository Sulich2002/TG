export function bodyShape(level) {
  const trained=Math.min(1,Math.max(0,(level-1)/19));
  return {trained,belly: .39-trained*.14,chest:.40+trained*.11,shoulders:.44+trained*.13,arm:.115+trained*.065,leg:.145+trained*.04,stage:level<5?'Начало пути':level<10?'Входишь в ритм':level<20?'Набираешь форму':'Новый облик'};
}
